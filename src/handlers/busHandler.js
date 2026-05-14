const tusService = require('../services/tusService');
const { buildScheduleBlocks, buildRealTimeBlocks } = require('../utils/blockBuilder');

async function runBusLookup({ respond, command }) {
    const args = (command.text || '').trim().split(/\s+/).filter(Boolean);
    const stopId = args[0];
    const routeId = args[1] || '1';

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

async function runRealTimeLookup({ respond, command }) {
    const args = (command.text || '').trim().split(/\s+/).filter(Boolean);
    const stopId = args[0];
    const routeId = args[1] || '1';

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

async function handleBusCommand({ ack, respond, command }) {
    const args = (command.text || '').trim().split(/\s+/).filter(Boolean);

    if (!args[0]) {
        await ack({
            response_type: 'ephemeral',
            text: '❌ Por favor proporciona el ID de la parada. Ejemplo: `/bus 338`'
        });
        return;
    }

    await ack({
        response_type: 'ephemeral',
        text: '🔍 Consultando estimaciones en tiempo real y horarios programados...'
    });

    runBusLookup({ respond, command }).catch(async (error) => {
        console.error('❌ Error en /bus:', error);
        await respond({
            response_type: 'ephemeral',
            text: `❌ Error consultando buses: ${error.message}`
        });
    });
}

async function handleRealTimeBusCommand({ ack, respond, command }) {
    const args = (command.text || '').trim().split(/\s+/).filter(Boolean);

    if (!args[0]) {
        await ack({
            response_type: 'ephemeral',
            text: '❌ Por favor proporciona el ID de la parada. Ejemplo: `/realTimeBus 338`'
        });
        return;
    }

    await ack({
        response_type: 'ephemeral',
        text: '🔍 Consultando estimaciones en tiempo real...'
    });

    runRealTimeLookup({ respond, command }).catch(async (error) => {
        console.error('❌ Error en /realTimeBus:', error);
        await respond({
            response_type: 'ephemeral',
            text: `❌ Error consultando tiempo real: ${error.message}`
        });
    });
}

module.exports = { handleBusCommand, handleRealTimeBusCommand };
