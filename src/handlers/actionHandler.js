const tusService = require('../services/tusService');
const { buildScheduleBlocks, buildRealTimeBlocks } = require('../utils/blockBuilder');

async function handleRefreshSchedule({ ack, body, respond }) {
    await ack();

    // El valor del botón viene como string JSON
    const actionValue = JSON.parse(body.actions[0].value);
    const { stopId, routeId } = actionValue;

    const scheduleData = await tusService.getSchedule(stopId, routeId);

    if (!scheduleData) {
        await respond({
            replace_original: true,
            text: '❌ No se pudo actualizar la información.'
        });
        return;
    }

    await respond({
        replace_original: true,
        blocks: buildScheduleBlocks(scheduleData, stopId, routeId),
        text: `Horarios actualizados parada ${stopId}`
    });
}

async function handleRefreshRealTime({ ack, body, respond }) {
    await ack();

    const actionValue = JSON.parse(body.actions[0].value);
    const { stopId, routeId } = actionValue;

    const estimates = await tusService.getRealTimeEstimates(stopId, routeId);

    if (!estimates) {
        await respond({
            replace_original: true,
            text: '❌ No se pudo actualizar la información de tiempo real.'
        });
        return;
    }

    await respond({
        replace_original: true,
        blocks: buildRealTimeBlocks(estimates, stopId, routeId),
        text: `Tiempo real actualizado parada ${stopId}`
    });
}

module.exports = { handleRefreshSchedule, handleRefreshRealTime };
