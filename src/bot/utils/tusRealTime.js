const axios = require('axios');
const config = require('../../config');

function formatRealTimeSchedule(schedule) {
  if (schedule.noBusesActive) {
    return '🚌 No hay buses activos en este momento para esta parada y línea.\n\n⏰ _Consulta en tiempo real de TUS Santander_';
  }
  if (schedule && schedule.buses && schedule.buses.length > 0) {
    const formattedList = schedule.buses
      .map(bus => {
        const minutesText = bus.timeInMinutes === 1 ? 'minuto' : 'minutos';
        const distanceKm = (bus.distanceInMeters / 1000).toFixed(1);
        if (bus.timeInMinutes < 1) {
          return `🚌 **LLEGANDO AHORA** → ${bus.destination}\n   📍 Distancia: ${distanceKm} km | Bus ID: ${bus.busId}`;
        } else if (bus.timeInMinutes === 1) {
          return `🚌 **1 MINUTO** → ${bus.destination}\n   📍 Distancia: ${distanceKm} km | Bus ID: ${bus.busId}`;
        } else {
          return `🚌 **${bus.timeInMinutes} minutos** → ${bus.destination}\n   📍 Distancia: ${distanceKm} km | Bus ID: ${bus.busId}`;
        }
      })
      .join('\n\n');
    return `${formattedList}\n\n⏰ _Hora actual: ${schedule.currentTime} | 🔴 Estimaciones ajustadas (-3 min) - TUS Santander_`;
  }
  return 'No hay información de buses en tiempo real disponible.';
}

async function getTusRealTimeEstimates(stopId, routeId) {
  try {
    const response = await axios.get(config.API.TUS_ESTIMATES, {
      timeout: config.SETTINGS.TUS_REQUEST_TIMEOUT_MS
    });
    const stopIdStr = stopId.toString();
    const routeIdStr = routeId.toString();
    const estimates = response.data.resources.filter(item => {
      const itemLinea = item['ayto:etiqLinea']?.toString();
      const itemParada = item['ayto:paradaId']?.toString();
      return itemLinea === routeIdStr && itemParada === stopIdStr;
    });
    const now = new Date();
    const buses = [];
    estimates.forEach(estimate => {
      if (estimate['ayto:tiempo1'] && parseInt(estimate['ayto:tiempo1']) > 0) {
        const timeInSecondsOriginal = parseInt(estimate['ayto:tiempo1']);
        const timeInSecondsAdjusted = Math.max(0, timeInSecondsOriginal - 180);
        const timeInMinutes = Math.round(timeInSecondsAdjusted / 60);
        if (timeInSecondsAdjusted > 0) {
          buses.push({
            destination: estimate['ayto:destino1'],
            timeInSeconds: timeInSecondsAdjusted,
            timeInMinutes: timeInMinutes,
            distanceInMeters: parseInt(estimate['ayto:distancia1'] || 0),
            busId: estimate['dc:identifier'],
            lastUpdate: estimate['ayto:fechActual'],
            originalTimeInMinutes: Math.round(timeInSecondsOriginal / 60)
          });
        }
      }
      if (estimate['ayto:tiempo2'] && 
          parseInt(estimate['ayto:tiempo2']) > 0 && 
          estimate['ayto:destino2'] !== estimate['ayto:destino1']) {
        const timeInSecondsOriginal = parseInt(estimate['ayto:tiempo2']);
        const timeInSecondsAdjusted = Math.max(0, timeInSecondsOriginal - 180);
        const timeInMinutes = Math.round(timeInSecondsAdjusted / 60);
        if (timeInSecondsAdjusted > 0) {
          buses.push({
            destination: estimate['ayto:destino2'],
            timeInSeconds: timeInSecondsAdjusted,
            timeInMinutes: timeInMinutes,
            distanceInMeters: parseInt(estimate['ayto:distancia2'] || 0),
            busId: estimate['dc:identifier'],
            lastUpdate: estimate['ayto:fechActual'],
            originalTimeInMinutes: Math.round(timeInSecondsOriginal / 60)
          });
        }
      }
    });
    buses.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
    if (buses.length === 0) {
      return { buses: [], noBusesActive: true };
    }
    return {
      buses: buses.slice(0, 5),
      currentTime: `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`,
      isRealTime: true
    };
  } catch (error) {
    console.error('❌ Error en getTusRealTimeEstimates:', error.message);
    return null;
  }
}

module.exports = { getTusRealTimeEstimates, formatRealTimeSchedule };
