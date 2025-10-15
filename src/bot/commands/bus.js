const { getTusRealTimeEstimates, formatRealTimeSchedule } = require('../utils/tusRealTime');
const { getTusSchedule, formatSchedule } = require('../utils/tusSchedule');

module.exports = (app) => {
  app.command('/bus', async ({ ack, respond, command }) => {
    await ack();
    const args = command.text.split(' ');
    const stopId = args[0];
    const routeId = args[1] || '1';
    if (!stopId) {
      await respond({
        response_type: 'ephemeral',
        text: 'Por favor proporciona el ID de la parada. Ejemplo: `/bus 338` (línea 1) o `/bus 338 2` (línea 2)'
      });
      return;
    }
    await respond({ response_type: 'ephemeral', text: '🔍 Consultando estimaciones en tiempo real y horarios programados...' });
    const realTimeData = await getTusRealTimeEstimates(stopId, routeId);
    if (realTimeData && !realTimeData.noBusesActive) {
      const messageText = `🚌 holaa hola*TIEMPO REALLLLLLLL - Línea ${routeId} - Parada ${stopId}:*\n${formatRealTimeSchedule(realTimeData)}`;
      
      // DEBUG: Log del mensaje que se va a enviar
      console.log('📤 Enviando mensaje:', messageText);
      
      await respond({
        response_type: 'in_channel',
        text: messageText
      });
      
      console.log('✅ Mensaje enviado correctamente');
      return;
    }
    const scheduleData = await getTusSchedule(stopId, routeId);
    if (!scheduleData) {
      await respond({
        response_type: 'ephemeral',
        text: `❌ No encontré información para la parada ${stopId} en la línea ${routeId}. Verifica los datos.`
      });
      return;
    }
    await respond({
      response_type: 'in_channel',
      text: `🚌 *HORARIOS PROGRAMADOS - Línea ${routeId} - Parada ${stopId}:*\n${formatSchedule(scheduleData)}\n\n⚠️ _No hay buses activos actualmente. Mostrando horarios programados._`
    });
  });
};
