const tusService = require('../services/tusService');
const { buildScheduleBlocks, buildRealTimeBlocks } = require('../utils/blockBuilder');

async function handleBusCommand({ ack, respond, command }) {
    await ack();

    const args = command.text.split(' ');
    const stopId = args[0];
    const routeId = args[1] || '1';

    if (!stopId) {
        await respond({
            response_type: 'ephemeral',
            text: '❌ Por favor proporciona el ID de la parada. Ejemplo: `/bus 338`'
        });
        return;
    }

    // 1. Intentar Tiempo Real
    const realTimeData = await tusService.getRealTimeEstimates(stopId, routeId);

    if (realTimeData && !realTimeData.noBusesActive) {
        await respond({
            response_type: 'in_channel',
            blocks: buildRealTimeBlocks(realTimeData, stopId, routeId),
            text: `Tiempo real parada ${stopId}` // Fallback text
        });
        return;
    }

    // 2. Si no hay tiempo real, ir a Horarios Programados
    const scheduleData = await tusService.getSchedule(stopId, routeId);

    if (!scheduleData) {
        await respond({
            response_type: 'ephemeral',
            text: `❌ No encontré información para la parada ${stopId} en la línea ${routeId}.`
        });
        return;
    }

    await respond({
        response_type: 'in_channel',
        blocks: buildScheduleBlocks(scheduleData, stopId, routeId),
        text: `Horarios parada ${stopId}` // Fallback text
    });
}

async function handleRealTimeBusCommand({ ack, respond, command }) {
    await ack();

    const args = command.text.split(' ');
    const stopId = args[0];
    const routeId = args[1] || '1';

    if (!stopId) {
        await respond({
            response_type: 'ephemeral',
            text: '❌ Por favor proporciona el ID de la parada. Ejemplo: `/realTimeBus 338`'
        });
        return;
    }

    const estimates = await tusService.getRealTimeEstimates(stopId, routeId);

    if (!estimates) {
        await respond({
            response_type: 'ephemeral',
            text: '❌ Error consultando el servicio de tiempo real.'
        });
        return;
    }

    await respond({
        response_type: 'in_channel',
        blocks: buildRealTimeBlocks(estimates, stopId, routeId),
        text: `Tiempo real parada ${stopId}`
    });
}

module.exports = { handleBusCommand, handleRealTimeBusCommand };
