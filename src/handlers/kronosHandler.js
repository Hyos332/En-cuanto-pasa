const db = require('../db');
const kronosService = require('../services/kronosService');
const schedule = require('node-schedule');

const jobs = {};

const handleLoginCommand = async ({ ack, body, client }) => {
    await ack();
    try {
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'kronos_login_modal',
                title: { type: 'plain_text', text: 'Login Kronos' },
                blocks: [
                    {
                        type: 'input',
                        block_id: 'user_block',
                        element: { type: 'plain_text_input', action_id: 'username' },
                        label: { type: 'plain_text', text: 'Usuario' }
                    },
                    {
                        type: 'input',
                        block_id: 'pass_block',
                        element: { type: 'plain_text_input', action_id: 'password' },
                        label: { type: 'plain_text', text: 'Contraseña' }
                    }
                ],
                submit: { type: 'plain_text', text: 'Guardar' }
            }
        });
    } catch (error) {
        console.error(error);
    }
};

const handleLoginSubmission = async ({ ack, view, body, client }) => {
    await ack();
    const username = view.state.values.user_block.username.value;
    const password = view.state.values.pass_block.password.value;
    const slackId = body.user.id;

    await db.saveUser(slackId, username, password);

    try {
        await client.chat.postMessage({
            channel: slackId,
            text: '✅ Credenciales de Kronos guardadas correctamente.'
        });
    } catch (e) {
        console.error('Could not send DM', e);
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
    handleLoginSubmission,
    handleScheduleCommand,
    initSchedules
};
