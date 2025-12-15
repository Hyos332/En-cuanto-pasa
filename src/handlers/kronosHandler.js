const db = require('../db');
const kronosService = require('../services/kronosService');
const schedule = require('node-schedule');
const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');
const fs = require('fs').promises;
const path = require('path');

// Cliente sin token inicial (se lo pasaremos en cada llamada)
const slackClient = new WebClient();

const jobs = {};

// Helper para obtener el token de la instalación
async function getSlackToken() {
    try {
        const dataDir = path.join(__dirname, '../../data');
        const files = await fs.readdir(dataDir);
        // Buscamos el primer archivo JSON que parezca un Team ID (empieza por T) o Enterprise (E)
        const installFile = files.find(f => (f.startsWith('T') || f.startsWith('E')) && f.endsWith('.json'));

        if (!installFile) return null;

        const content = await fs.readFile(path.join(dataDir, installFile), 'utf8');
        const data = JSON.parse(content);
        return data.bot?.token;
    } catch (e) {
        console.error('Error leyendo token de Slack:', e);
        return null;
    }
}

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
    const EXPIRATION_MS = 15 * 60 * 1000;
    tokenStore.set(token, {
        slackId,
        username,
        expiresAt: Date.now() + EXPIRATION_MS
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

const sendScheduleConfirmation = async (slackId, slots) => {
    try {
        const token = await getSlackToken();
        if (!token) return;

        // Agrupar por días
        const daysMap = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 0: 'Domingo' };
        let summary = '';

        // Ordenar slots (Manejo robusto de nulos)
        slots.sort((a, b) => {
            const dayDiff = a.day_of_week - b.day_of_week;
            if (dayDiff !== 0) return dayDiff;

            const timeA = a.start_time || '';
            const timeB = b.start_time || '';
            return timeA.localeCompare(timeB);
        });

        const groups = {};
        slots.forEach(s => {
            if (!groups[s.day_of_week]) groups[s.day_of_week] = [];
            // Si falta alguna hora, mostrar ??:??
            const start = s.start_time || '??:??';
            const end = s.end_time || '??:??';
            groups[s.day_of_week].push(`${start} - ${end}`);
        });

        if (Object.keys(groups).length === 0) {
            summary = '_Sin horarios activos (Días libres)_';
        } else {
            for (const [dayCode, times] of Object.entries(groups)) {
                summary += `• *${daysMap[dayCode]}:* ${times.join(', ')}\n`;
            }
        }

        await slackClient.chat.postMessage({
            token: token,
            channel: slackId,
            text: `✅ **Horario Guardado Correctamente**\n\nAsí ha quedado tu configuración semanal:\n\n${summary}\n\n¿Te equivocaste? Genera un nuevo panel con \`/panel\``
        });

    } catch (e) {
        console.error('Error enviando confirmación:', e);
    }
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
function scheduleJob(slackId, time, type, dayOfWeek = null) {
    // Validar tiempo
    if (!time || typeof time !== 'string' || !time.includes(':')) {
        console.warn(`⚠️ Invalid time format for ${slackId}: ${time}`);
        return;
    }

    // ID único para el trabajo: slackId + tipo + dia + HORA (para evitar sobrescribir turnos múltiples)
    const jobKey = `${slackId}_${type}${dayOfWeek !== null ? '_' + dayOfWeek : ''}_${time}`;

    if (jobs[jobKey]) jobs[jobKey].cancel(); // Cancelar si por alguna razón exacta ya existía (ej. recarga doble)

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
                const token = await getSlackToken();
                if (!token) throw new Error('No se pudo obtener el token del bot para enviar notificaciones.');

                let result;
                if (type === 'START') {
                    result = await kronosService.startTimer(user.kronos_user, user.kronos_password);
                } else {
                    result = await kronosService.stopTimer(user.kronos_user, user.kronos_password);
                }

                await slackClient.chat.postMessage({
                    token: token,
                    channel: slackId,
                    text: `🤖 **Kronos ${type === 'START' ? 'Inicio' : 'Fin'}**: ${result.message}`
                });
            } catch (e) {
                console.error(e);
                const token = await getSlackToken(); // Intentar obtener token de nuevo para log de error
                if (token) {
                    await slackClient.chat.postMessage({
                        token: token,
                        channel: slackId,
                        text: `❌ Error Kronos (${type}): ${e.message}`
                    });
                }
            }
        } else {
            console.log(`No credentials found for ${slackId}`);
        }
    });
}

// Cargar y reprogramar TODO el horario de un usuario (Hot Reload)
const reloadUserSchedule = async (slackId) => {
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
            if (s.start_time) scheduleJob(slackId, s.start_time, 'START', s.day_of_week);
            if (s.end_time) scheduleJob(slackId, s.end_time, 'STOP', s.day_of_week);
        }
    });

    console.log(`✅ Schedules reloaded for ${slackId}.`);
};


const initSchedules = async (app) => {
    try {
        // 1. Cargar Legacy (Solo STOP diario)
        const oldSchedules = await db.getAllSchedules();
        oldSchedules.forEach(s => {
            scheduleJob(s.slack_id, s.time, 'STOP');
        });

        // 2. Cargar Sistema Nuevo (Semanal START/STOP)
        const weekly = await db.getAllWeeklySchedules();
        weekly.forEach(s => {
            // Evitar duplicados si ya existe legacy (el sistema nuevo manda sobre el viejo)
            // Pero por simplicidad, cargamos todo. Lo ideal es que el usuario migre.
            if (s.start_time) scheduleJob(s.slack_id, s.start_time, 'START', s.day_of_week);
            if (s.end_time) scheduleJob(s.slack_id, s.end_time, 'STOP', s.day_of_week);
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
    reloadUserSchedule,
    sendScheduleConfirmation, // Exportado para usar en API
    tokenStore
};
