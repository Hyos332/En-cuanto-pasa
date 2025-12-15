const db = require('../db');
const kronosService = require('../services/kronosService');
const schedule = require('node-schedule');
const crypto = require('crypto');

const jobs = {};

// Almacén temporal de tokens de acceso al panel
// Map<token, { slackId: string, username: string, expiresAt: number }>
const tokenStore = new Map();

const handleLoginCommand = async ({ ack, command, client }) => {
    // IMPORTANTE: Responder inmediatamente para evitar timeout
    await ack();

    console.log('🔐 [KRONOS] Comando /login recibido (Modo Texto Directo)');

    const args = command.text.trim().split(/\s+/);

    // Validar argumentos
    if (args.length < 2) {
        await client.chat.postMessage({
            channel: command.user_id,
            text: '⚠️ **Formato incorrecto.**\n\nUso correcto:\n`/login [usuario] [contraseña]`\n\nEjemplo: `/login pepe.perez miClave123`'
        });
        return;
    }

    const username = args[0];
    const password = args[1]; // Tomamos el segundo argumento (o el resto si fuera necesario unirlo)
    const slackId = command.user_id;

    try {
        console.log(`💾 [KRONOS] Guardando credenciales para ${slackId}`);
        await db.saveUser(slackId, username, password);

        await client.chat.postMessage({
            channel: slackId,
            text: `✅ **¡Login Exitoso!**\n\nUsuario guardado: \`${username}\`\nAhora puedes usar \`/panel\` para configurar tu horario semanal de forma visual.`
        });
        console.log('💾 [KRONOS] Guardado exitoso');

    } catch (error) {
        console.error('❌ [KRONOS] Error guardando credenciales:', error);
        await client.chat.postMessage({
            channel: slackId,
            text: '❌ Hubo un error guardando tus datos. Inténtalo de nuevo.'
        });
    }
};

const handlePanelCommand = async ({ ack, command, client }) => {
    await ack();
    const slackId = command.user_id;
    const username = command.user_name;

    // Generar token único seguro
    const token = crypto.randomBytes(16).toString('hex');

    // Guardar token (validez: 15 minutos)
    tokenStore.set(token, {
        slackId,
        username,
        expiresAt: Date.now() + 15 * 60 * 1000
    });

    // Limpiar tokens expirados (mantenimiento básico)
    for (const [t, data] of tokenStore.entries()) {
        if (Date.now() > data.expiresAt) tokenStore.delete(t);
    }

    // Construir URL
    const baseUrl = 'https://en-cuanto-pasa.ctdesarrollo-sdr.org';
    const dashboardUrl = `${baseUrl}/dashboard?token=${token}&user=${encodeURIComponent(username)}`;

    await client.chat.postMessage({
        channel: slackId,
        text: `🎛️ **Panel de Control Kronos**\n\nAccede aquí para configurar tu horario semanal:\n👉 <${dashboardUrl}|Abrir Dashboard>\n\n_(Este enlace expira en 15 minutos)_`
    });
};

const handleScheduleCommand = async ({ ack, command, client }) => {
    await ack();
    const time = command.text.trim();
    const slackId = command.user_id;

    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
        await client.chat.postMessage({
            channel: slackId,
            text: '❌ Formato inválido. Usa HH:MM (ej: 18:30)'
        });
        return;
    }

    await db.saveSchedule(slackId, time);

    scheduleJob(slackId, time, client);

    await client.chat.postMessage({
        channel: slackId,
        text: `⏰ Apagado automático programado a las ${time}`
    });
};

function scheduleJob(slackId, time, client) {
    if (jobs[slackId]) jobs[slackId].cancel();

    const [hour, minute] = time.split(':');
    const rule = new schedule.RecurrenceRule();
    rule.hour = parseInt(hour);
    rule.minute = parseInt(minute);
    rule.tz = 'Europe/Madrid';

    console.log(`Scheduling job for ${slackId} at ${time} Europe/Madrid`);

    jobs[slackId] = schedule.scheduleJob(rule, async () => {
        console.log(`Running Kronos job for ${slackId}`);
        const user = await db.getUser(slackId);
        if (user) {
            try {
                const result = await kronosService.stopTimer(user.kronos_user, user.kronos_password);
                await client.chat.postMessage({
                    channel: slackId,
                    text: `🤖 Ejecución Kronos: ${result.message}`
                });
            } catch (e) {
                console.error(e);
                await client.chat.postMessage({
                    channel: slackId,
                    text: `❌ Error ejecutando Kronos: ${e.message}`
                });
            }
        } else {
            console.log(`No credentials found for ${slackId}`);
            await client.chat.postMessage({
                channel: slackId,
                text: '❌ No se encontraron credenciales para ejecutar el apagado. Usa /login primero.'
            });
        }
    });
}

const initSchedules = async (app) => {
    try {
        const schedules = await db.getAllSchedules();
        schedules.forEach(s => {
            scheduleJob(s.slack_id, s.time, app.client);
        });
        console.log(`Loaded ${schedules.length} schedules.`);
    } catch (e) {
        console.error('Error loading schedules', e);
    }
};

module.exports = {
    handleLoginCommand,
    handlePanelCommand,
    handleScheduleCommand,
    initSchedules,
    tokenStore
};
