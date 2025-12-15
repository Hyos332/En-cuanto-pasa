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

    // Legacy support: Single shot schedule
    scheduleJob(slackId, time, 'STOP', client);

    await client.chat.postMessage({
        channel: slackId,
        text: `⏰ Apagado automático programado a las ${time}`
    });
};

// Función genérica para programar un trabajo con node-schedule
function scheduleJob(slackId, time, type, client, dayOfWeek = null) {
    // ID único para el trabajo: slackId + tipo + dia (si aplica)
    const jobKey = `${slackId}_${type}${dayOfWeek !== null ? '_' + dayOfWeek : ''}`;

    if (jobs[jobKey]) jobs[jobKey].cancel();

    const [hour, minute] = time.split(':');
    const rule = new schedule.RecurrenceRule();
    rule.hour = parseInt(hour);
    rule.minute = parseInt(minute);
    if (dayOfWeek !== null) rule.dayOfWeek = dayOfWeek; // 0-6 (Dom-Sab) en node-schedule
    rule.tz = 'Europe/Madrid';

    console.log(`📅 Scheduling ${type} for ${slackId} at ${time} (Day: ${dayOfWeek ?? 'Everyday'})`);

    jobs[jobKey] = schedule.scheduleJob(rule, async () => {
        console.log(`🚀 Running Kronos ${type} job for ${slackId}`);
        const user = await db.getUser(slackId);

        if (user) {
            try {
                let result;
                if (type === 'START') {
                    result = await kronosService.startTimer(user.kronos_user, user.kronos_password);
                } else {
                    result = await kronosService.stopTimer(user.kronos_user, user.kronos_password);
                }

                await client.chat.postMessage({
                    channel: slackId,
                    text: `🤖 **Kronos ${type === 'START' ? 'Inicio' : 'Fin'}**: ${result.message}`
                });
            } catch (e) {
                console.error(e);
                await client.chat.postMessage({
                    channel: slackId,
                    text: `❌ Error Kronos (${type}): ${e.message}`
                });
            }
        } else {
            console.log(`No credentials found for ${slackId}`);
        }
    });
}

// Cargar y reprogramar TODO el horario de un usuario (Hot Reload)
const reloadUserSchedule = async (slackId, client) => {
    console.log(`🔄 Reloading schedules for ${slackId}...`);

    // 1. Cancelar todos los trabajos existentes de este usuario
    Object.keys(jobs).forEach(key => {
        if (key.startsWith(slackId)) {
            jobs[key].cancel();
            delete jobs[key];
        }
    });

    // 2. Cargar horario semanal nuevo
    const weeklySchedules = await db.getWeeklySchedule(slackId);

    // Mapeo de días: Panel usa 1=Lunes..5=Viernes. Node-schedule usa 0=Domingo..6=Sabado.
    // Panel (Front): 1 (Lun) -> Node: 1 (Lun). Coincide.

    weeklySchedules.forEach(s => {
        if (s.is_active) {
            if (s.start_time) scheduleJob(slackId, s.start_time, 'START', client, s.day_of_week);
            if (s.end_time) scheduleJob(slackId, s.end_time, 'STOP', client, s.day_of_week);
        }
    });

    console.log(`✅ Schedules reloaded for ${slackId}.`);
};


const initSchedules = async (app) => {
    try {
        // 1. Cargar Legacy (Solo STOP diario)
        const oldSchedules = await db.getAllSchedules();
        oldSchedules.forEach(s => {
            scheduleJob(s.slack_id, s.time, 'STOP', app.client);
        });

        // 2. Cargar Sistema Nuevo (Semanal START/STOP)
        const weekly = await db.getAllWeeklySchedules();
        weekly.forEach(s => {
            // Evitar duplicados si ya existe legacy (el sistema nuevo manda sobre el viejo)
            // Pero por simplicidad, cargamos todo. Lo ideal es que el usuario migre.
            if (s.start_time) scheduleJob(s.slack_id, s.start_time, 'START', app.client, s.day_of_week);
            if (s.end_time) scheduleJob(s.slack_id, s.end_time, 'STOP', app.client, s.day_of_week);
        });

        console.log(`📅 System initialized with ${Object.keys(jobs).length} active jobs.`);
    } catch (e) {
        console.error('Error loading schedules', e);
    }
};

module.exports = {
    handleLoginCommand,
    handlePanelCommand,
    handleScheduleCommand,
    initSchedules,
    reloadUserSchedule, // Exportado para usar en API
    tokenStore
};
