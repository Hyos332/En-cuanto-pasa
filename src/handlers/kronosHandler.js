const db = require('../db');
const kronosService = require('../services/kronosService');
const schedule = require('node-schedule');
const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');
const fs = require('fs').promises;
const path = require('path');


const slackClient = new WebClient();

const jobs = {};


async function getSlackToken() {
    if (process.env.SLACK_BOT_TOKEN) {
        return process.env.SLACK_BOT_TOKEN;
    }

    try {
        const dataDir = path.join(__dirname, '../../data');
        const files = await fs.readdir(dataDir);

        const installFiles = files.filter(f => f.endsWith('.json'));
        if (installFiles.length === 0) return null;

        const installations = await Promise.all(installFiles.map(async file => {
            try {
                const fullPath = path.join(dataDir, file);
                const [content, stats] = await Promise.all([
                    fs.readFile(fullPath, 'utf8'),
                    fs.stat(fullPath)
                ]);
                const data = JSON.parse(content);
                const token = data.bot?.token;

                return {
                    token,
                    mtimeMs: stats.mtimeMs
                };
            } catch (error) {
                return null;
            }
        }));

        const withToken = installations
            .filter(Boolean)
            .filter(item => item.token);

        withToken.sort((a, b) => b.mtimeMs - a.mtimeMs);
        return withToken[0]?.token || null;
    } catch (e) {
        console.error('Error leyendo token de Slack:', e);
        return null;
    }
}



const tokenStore = new Map();

const SEMANAL_TARGET_PEOPLE = [
    'Diego Moys',
    'Bryan Baquedano',
    'Carlos Alvarado',
    'Josué Merino',
    'Diego Jimenez',
    'Angel Romero',
    'Marco Figueroa',
    'Luis Felipe Hoyos',
    'Kevin Ponce',
    'Katerine Rafael'
];

function getAllowedSemanalUsernames() {
    const configured = process.env.SEMANAL_ALLOWED_USERNAMES || 'diego.moys';
    return configured
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);
}

function getAllowedSemanalUserIds() {
    const configured = process.env.SEMANAL_ALLOWED_USER_IDS || '';
    return configured
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

function isSemanalAllowed(command) {
    const allowedUsernames = getAllowedSemanalUsernames();
    const allowedUserIds = getAllowedSemanalUserIds();

    const username = (command.user_name || '').trim().toLowerCase();
    const isAllowedByUsername = allowedUsernames.includes(username);
    const isAllowedById = allowedUserIds.includes(command.user_id);

    return isAllowedByUsername || isAllowedById;
}

const handleLoginCommand = async ({ ack, command, client }) => {
    
    await ack();

    console.log('🔐 [KRONOS] Comando /login recibido (Modo Texto Directo)');

    const args = command.text.trim().split(/\s+/);

    
    if (args.length < 2) {
        await client.chat.postMessage({
            channel: command.user_id,
            text: '⚠️ **Formato incorrecto.**\n\nUso correcto:\n`/login [usuario] [contraseña]`\n\nEjemplo: `/login pepe.perez miClave123`'
        });
        return;
    }

    const username = args[0];
    const password = args[1]; 
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
        const missingSecret = error.message && error.message.includes('KRONOS_CREDENTIALS_SECRET');

        await client.chat.postMessage({
            channel: slackId,
            text: missingSecret
                ? '❌ Falta configurar `KRONOS_CREDENTIALS_SECRET` en el servidor. Contacta al administrador.'
                : '❌ Hubo un error guardando tus datos. Inténtalo de nuevo.'
        });
    }
};

const handlePanelCommand = async ({ ack, command, client }) => {
    await ack();
    const slackId = command.user_id;
    const username = command.user_name;

    
    const token = crypto.randomBytes(16).toString('hex');

    
    const EXPIRATION_MS = 15 * 60 * 1000;
    tokenStore.set(token, {
        slackId,
        username,
        expiresAt: Date.now() + EXPIRATION_MS
    });

    
    for (const [t, data] of tokenStore.entries()) {
        if (Date.now() > data.expiresAt) tokenStore.delete(t);
    }

    
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

        const daysMap = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 0: 'Domingo' };

        
        const groups = {};
        slots.forEach(s => {
            if (!groups[s.day_of_week]) groups[s.day_of_week] = [];
            const start = s.start_time || '??:??';
            const end = s.end_time || '??:??';
            groups[s.day_of_week].push(`${start} - ${end}`);
        });

        let summary = '';
        const workWeek = [1, 2, 3, 4, 5]; 

        
        workWeek.forEach(dayCode => {
            const dayName = daysMap[dayCode];
            if (groups[dayCode]) {
                
                groups[dayCode].sort();
                summary += `• *${dayName}:* ${groups[dayCode].join(', ')}\n`;
            } else {
                summary += `• *${dayName}:* _Inactivo_\n`;
            }
        });

        
        [6, 0].forEach(dayCode => {
            if (groups[dayCode]) {
                groups[dayCode].sort();
                summary += `• *${daysMap[dayCode]}:* ${groups[dayCode].join(', ')}\n`;
            }
        });

        await slackClient.chat.postMessage({
            token: token,
            channel: slackId,
            text: `✅ **Horario Actualizado**\n\nTu configuración semanal ha quedado así:\n\n${summary}\n\nSi necesitas pausar todo temporalmente, usa \`/stop\`.`
        });

    } catch (e) {
        console.error('Error enviando confirmación:', e);
    }
};

const handleStopCommand = async ({ ack, command, client }) => {
    
    await ack();

    const slackId = command.user_id;
    console.log(`🛑 /stop command received from ${slackId}`);

    try {
        
        await client.chat.postMessage({
            channel: slackId,
            text: '🛑 **Comando Recibido**. Procesando detención...'
        });

        
        await db.saveUserSlots(slackId, []);

        
        
        try {
            await reloadUserSchedule(slackId);
        } catch (reloadError) {
            console.error('Error reloading schedule:', reloadError);
            
        }

        
        await client.chat.postMessage({
            channel: slackId,
            text: '✅ **Automatización Detenida**. ¡Disfruta tu tiempo libre!'
        });

    } catch (e) {
        console.error('Error in /stop command:', e);
    }
};

const handleSemanalCommand = async ({ ack, command, respond }) => {
    await ack();

    if (!isSemanalAllowed(command)) {
        await respond({
            response_type: 'ephemeral',
            text: '⛔ No tienes permisos para ejecutar `/semanal`.'
        });
        return;
    }

    try {
        const user = await db.getUser(command.user_id);
        if (!user || !user.kronos_user || !user.kronos_password) {
            await respond({
                response_type: 'ephemeral',
                text: '⚠️ No encontré credenciales de Kronos. Ejecuta `/login usuario contraseña` primero.'
            });
            return;
        }

        await respond({
            response_type: 'ephemeral',
            text: `👀 Consultando ${SEMANAL_TARGET_PEOPLE.length} personas en Reportes... (\`semanal-v4\`)`
        });

        const result = await kronosService.getWeeklyReportPeopleHours(
            user.kronos_user,
            user.kronos_password,
            SEMANAL_TARGET_PEOPLE
        );
        if (!result.success) {
            await respond({
                response_type: 'ephemeral',
                text: `❌ No pude leer Reportes: ${result.message}`
            });
            return;
        }

        const lines = result.results.map(entry => {
            if (!entry.found) {
                return `• ${entry.target}: \`No encontrado\``;
            }

            return `• ${entry.target}: \`${entry.totalHours || 'N/D'}\``;
        });

        await respond({
            response_type: 'ephemeral',
            text: `✅ Consulta semanal completada.\n${lines.join('\n')}\n\nRegistros visibles en la tabla: \`${result.visibleRows}\``
        });
    } catch (error) {
        console.error('Error in /semanal command:', error);
        await respond({
            response_type: 'ephemeral',
            text: `❌ Error ejecutando /semanal: ${error.message}`
        });
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

    
    scheduleJob(slackId, time, 'STOP');

    await client.chat.postMessage({
        channel: slackId,
        text: `⏰ Apagado automático programado a las ${time}`
    });
};


function scheduleJob(slackId, time, type, dayOfWeek = null) {
    
    if (!time || typeof time !== 'string' || !time.includes(':')) {
        console.warn(`⚠️ Invalid time format for ${slackId}: ${time}`);
        return;
    }

    
    const jobKey = `${slackId}_${type}${dayOfWeek !== null ? '_' + dayOfWeek : ''}_${time}`;

    if (jobs[jobKey]) jobs[jobKey].cancel(); 

    const [hour, minute] = time.split(':');
    const rule = new schedule.RecurrenceRule();
    rule.hour = parseInt(hour);
    rule.minute = parseInt(minute);
    if (dayOfWeek !== null) rule.dayOfWeek = dayOfWeek; 
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
                const token = await getSlackToken(); 
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


const reloadUserSchedule = async (slackId) => {
    console.log(`🔄 Reloading schedules for ${slackId}...`);


    Object.keys(jobs).forEach(key => {
        if (key.startsWith(slackId)) {
            if (jobs[key] && typeof jobs[key].cancel === 'function') {
                jobs[key].cancel();
            }
            delete jobs[key];
        }
    });

    
    const weeklySchedules = await db.getWeeklySchedule(slackId);

    
    

    weeklySchedules.forEach(s => {
        if (s.is_active) {
            if (s.start_time) scheduleJob(slackId, s.start_time, 'START', s.day_of_week);
            if (s.end_time) scheduleJob(slackId, s.end_time, 'STOP', s.day_of_week);
        }
    });

    console.log(`✅ Schedules reloaded for ${slackId}.`);
};


const initSchedules = async () => {
    try {
        
        const oldSchedules = await db.getAllSchedules();
        oldSchedules.forEach(s => {
            scheduleJob(s.slack_id, s.time, 'STOP');
        });

        
        const weekly = await db.getAllWeeklySchedules();
        weekly.forEach(s => {
            
            
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
    handleStopCommand,
    handleSemanalCommand,
    initSchedules,
    reloadUserSchedule,
    sendScheduleConfirmation, 
    tokenStore
};
