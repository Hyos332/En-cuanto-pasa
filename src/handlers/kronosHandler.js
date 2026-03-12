const db = require('../db');
const kronosService = require('../services/kronosService');
const schedule = require('node-schedule');
const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');
const fs = require('fs').promises;
const path = require('path');
const {
    getSemanalTargets,
    normalizeIdentity,
    parseHoursToMinutes,
    formatMinutesClock,
    buildSemanalMatrix
} = require('../utils/semanalReport');
const { buildSemanalWorkbookBuffer } = require('../utils/semanalExcel');


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

const SEMANAL_TARGETS = getSemanalTargets();
const SEMANAL_TARGET_PEOPLE = SEMANAL_TARGETS.map(target => target.name);

function formatDateParts(dateUtc) {
    const day = String(dateUtc.getUTCDate()).padStart(2, '0');
    const month = String(dateUtc.getUTCMonth() + 1).padStart(2, '0');
    const year = dateUtc.getUTCFullYear();

    return {
        displayDate: `${day}/${month}/${year}`,
        isoDate: `${year}-${month}-${day}`
    };
}

function getCurrentMadridDateUtc() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);

    const values = {};
    parts.forEach(part => {
        if (part.type !== 'literal') {
            values[part.type] = part.value;
        }
    });

    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 12, 0, 0));
}

function getFridayOfCurrentMadridWeek() {
    const madridDate = getCurrentMadridDateUtc();
    const weekday = madridDate.getUTCDay(); // 0=domingo
    const weekdayIso = weekday === 0 ? 7 : weekday; // 1=lunes..7=domingo
    const diffToFriday = 5 - weekdayIso; // viernes=5

    const friday = new Date(madridDate);
    friday.setUTCDate(friday.getUTCDate() + diffToFriday);

    return formatDateParts(friday);
}

function parseSemanalDate(rawText) {
    const value = (rawText || '').trim();
    if (!value) {
        return { ok: true, date: getFridayOfCurrentMadridWeek() };
    }

    const matchDisplay = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (matchDisplay) {
        const day = Number(matchDisplay[1]);
        const month = Number(matchDisplay[2]);
        const year = Number(matchDisplay[3]);
        const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        if (date.getUTCFullYear() === year && (date.getUTCMonth() + 1) === month && date.getUTCDate() === day) {
            return { ok: true, date: formatDateParts(date) };
        }
    }

    const matchIso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (matchIso) {
        const year = Number(matchIso[1]);
        const month = Number(matchIso[2]);
        const day = Number(matchIso[3]);
        const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        if (date.getUTCFullYear() === year && (date.getUTCMonth() + 1) === month && date.getUTCDate() === day) {
            return { ok: true, date: formatDateParts(date) };
        }
    }

    return {
        ok: false,
        error: 'Formato de fecha inválido. Usa `/semanal` o `/semanal DD/MM/AAAA`.'
    };
}

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
        await db.clearLegacySchedule(slackId);

        
        
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

const handleSemanalCommand = async ({ ack, command, respond, client }) => {
    await ack();

    if (!isSemanalAllowed(command)) {
        await respond({
            response_type: 'ephemeral',
            text: '⛔ No tienes permisos para ejecutar `/semanal`.'
        });
        return;
    }

    try {
        const parsedDate = parseSemanalDate(command.text);
        if (!parsedDate.ok) {
            await respond({
                response_type: 'ephemeral',
                text: `❌ ${parsedDate.error}`
            });
            return;
        }

        const reportDate = parsedDate.date;

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
            text: `👀 Consultando ${SEMANAL_TARGET_PEOPLE.length} personas en Reportes para ${reportDate.displayDate}... (\`semanal-v6\`)`
        });

        const result = await kronosService.getWeeklyReportPeopleHours(
            user.kronos_user,
            user.kronos_password,
            SEMANAL_TARGET_PEOPLE,
            { reportDate }
        );
        if (!result.success) {
            await respond({
                response_type: 'ephemeral',
                text: `❌ No pude leer Reportes: ${result.message}`
            });
            return;
        }

        const targetMap = new Map(SEMANAL_TARGETS.map(target => [target.personKey, target]));
        const semanalRows = result.results.map(entry => {
            const candidateKeys = [
                normalizeIdentity(entry.target),
                normalizeIdentity(entry.name),
                normalizeIdentity(entry.username)
            ].filter(Boolean);

            const target = candidateKeys
                .map(key => targetMap.get(key))
                .find(Boolean) || null;

            const personKey = target?.personKey || candidateKeys[0] || normalizeIdentity(entry.target || entry.name || entry.username || 'desconocido');
            const personName = target?.name || entry.name || entry.target || entry.username || 'Desconocido';
            const workedMinutes = parseHoursToMinutes(entry.totalHours);
            const targetMinutes = target ? target.targetMinutes : null;
            const deltaMinutes = Number.isFinite(workedMinutes) && Number.isFinite(targetMinutes)
                ? workedMinutes - targetMinutes
                : null;

            return {
                personKey,
                personName,
                found: entry.found,
                workedMinutes,
                targetMinutes,
                deltaMinutes,
                rawTotalHours: entry.totalHours || null
            };
        });

        const rowsToPersist = semanalRows
            .filter(row => Number.isFinite(row.workedMinutes))
            .map(row => ({
                person_key: row.personKey,
                person_name: row.personName,
                worked_minutes: row.workedMinutes,
                target_minutes: Number.isFinite(row.targetMinutes) ? row.targetMinutes : null,
                delta_minutes: Number.isFinite(row.deltaMinutes) ? row.deltaMinutes : null
            }));

        await db.saveWeeklyBalances(reportDate.isoDate, rowsToPersist);

        const historyRows = await db.getWeeklyBalancesHistory();
        const matrix = buildSemanalMatrix(historyRows, SEMANAL_TARGETS, {
            extraWeeks: [reportDate.isoDate]
        });
        const totalByPerson = new Map(matrix.people.map(person => [person.personKey, person.totalDeltaMinutes]));

        const lines = semanalRows.map(row => {
            if (!row.found) {
                return `• ${row.personName}: \`No encontrado\``;
            }

            const workedText = Number.isFinite(row.workedMinutes)
                ? formatMinutesClock(row.workedMinutes)
                : (row.rawTotalHours || 'N/D');
            const targetText = Number.isFinite(row.targetMinutes)
                ? formatMinutesClock(row.targetMinutes)
                : 'N/D';
            const weekDeltaText = Number.isFinite(row.deltaMinutes)
                ? formatMinutesClock(row.deltaMinutes, { showPlus: true })
                : 'N/D';
            const totalDelta = totalByPerson.get(row.personKey);
            const totalText = Number.isFinite(totalDelta)
                ? formatMinutesClock(totalDelta, { showPlus: true })
                : 'N/D';

            return `• ${row.personName}: real \`${workedText}\` | obj \`${targetText}\` | semana \`${weekDeltaText}\` | total \`${totalText}\``;
        });

        let excelStatus = '📎 Excel actualizado y enviado por DM.';
        try {
            if (!client || typeof client.files?.uploadV2 !== 'function') {
                throw new Error('No hay cliente Slack disponible para subir el Excel.');
            }

            const workbookBuffer = await buildSemanalWorkbookBuffer({
                matrix,
                title: 'Horas Extra'
            });

            const dm = await client.conversations.open({ users: command.user_id });
            const dmChannelId = dm.channel?.id || command.channel_id;

            await client.files.uploadV2({
                channel_id: dmChannelId,
                filename: `horas-extra-${reportDate.isoDate}.xlsx`,
                title: `Horas Extra ${reportDate.displayDate}`,
                file: Buffer.from(workbookBuffer),
                initial_comment: `📊 Excel semanal actualizado al ${reportDate.displayDate}.`
            });
        } catch (uploadError) {
            console.error('Error subiendo Excel semanal:', uploadError);
            excelStatus = '⚠️ No pude enviar el Excel por Slack, pero los datos sí quedaron guardados.';
        }

        await respond({
            response_type: 'ephemeral',
            text: `✅ Consulta semanal completada (${result.usedDate || reportDate.displayDate}).\n${lines.join('\n')}\n\nRegistros visibles en la tabla: \`${result.visibleRows}\`\n${excelStatus}`
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

    try {
        
        await db.saveUserSlots(slackId, []);
        await db.saveSchedule(slackId, time);

        
        clearUserJobs(slackId);
        scheduleJob(slackId, time, 'STOP');

        await client.chat.postMessage({
            channel: slackId,
            text: `⏰ Apagado automático programado a las ${time}.`
        });
    } catch (e) {
        console.error('Error in /programar command:', e);
        await client.chat.postMessage({
            channel: slackId,
            text: `❌ No pude programar el apagado automático: ${e.message}`
        });
    }
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

function clearUserJobs(slackId) {
    Object.keys(jobs).forEach(key => {
        if (key.startsWith(slackId)) {
            if (jobs[key] && typeof jobs[key].cancel === 'function') {
                jobs[key].cancel();
            }
            delete jobs[key];
        }
    });
}


const reloadUserSchedule = async (slackId) => {
    console.log(`🔄 Reloading schedules for ${slackId}...`);

    clearUserJobs(slackId);

    
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
        const weekly = await db.getAllWeeklySchedules();
        const usersWithWeekly = new Set(weekly.map(s => s.slack_id));

        const oldSchedules = await db.getAllSchedules();
        oldSchedules.forEach(s => {
            if (!usersWithWeekly.has(s.slack_id)) {
                scheduleJob(s.slack_id, s.time, 'STOP');
            }
        });

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
