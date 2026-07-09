const config = require('../config');
const serverMonitorService = require('../services/serverMonitorService');

function parseList(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function isAllowed(command) {
    const allowedUsernames = parseList(config.SERVER_MONITOR.ALLOWED_USERNAMES).map(item => item.toLowerCase());
    const allowedUserIds = parseList(config.SERVER_MONITOR.ALLOWED_USER_IDS);

    if (allowedUsernames.length === 0 && allowedUserIds.length === 0) {
        return true;
    }

    const username = (command.user_name || '').trim().toLowerCase();

    return allowedUsernames.includes(username) || allowedUserIds.includes(command.user_id);
}

function buildHelpText() {
    return [
        '🖥️ *Monitor del servidor*',
        '',
        'Comandos:',
        '• `/server` o `/servidor` - Estado general del servidor.',
        '• `/server procesos` - Estado con foco en procesos por RAM/CPU.',
        '• `/server ayuda` - Muestra esta ayuda.',
        '',
        'Configura las alertas con `SERVER_MONITOR_ENABLED=true` y `SERVER_MONITOR_ALERT_CHANNEL_ID`.'
    ].join('\n');
}

async function handleServerCommand({ ack, command, respond }) {
    await ack();

    if (!isAllowed(command)) {
        await respond({
            response_type: 'ephemeral',
            text: '⛔ No tienes permisos para consultar el estado del servidor.'
        });
        return;
    }

    const arg = (command.text || '').trim().toLowerCase();

    if (['ayuda', 'help', '-h', '--help'].includes(arg)) {
        await respond({
            response_type: 'ephemeral',
            text: buildHelpText()
        });
        return;
    }

    await respond({
        response_type: 'ephemeral',
        text: `🖥️ Revisando \`${config.SERVER_MONITOR.HOST}\` por SSH...`
    });

    try {
        const report = await serverMonitorService.collectServerMetrics();
        const maxProcesses = arg === 'procesos' || arg === 'processes' ? 8 : 5;

        await respond({
            response_type: 'ephemeral',
            text: serverMonitorService.formatServerStatusText(report, { maxProcesses })
        });
    } catch (error) {
        console.error('Error in /server command:', error);
        await respond({
            response_type: 'ephemeral',
            text: `❌ No pude revisar el servidor: ${error.message}`
        });
    }
}

module.exports = {
    handleServerCommand,
    isAllowed
};
