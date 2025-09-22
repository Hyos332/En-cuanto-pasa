const axios = require('axios');

function convertirHora(horaString) {
  const totalSegundos = parseInt(horaString);
  const horas = Math.floor(totalSegundos / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
}

function formatSchedule(schedule) {
  if (schedule.noMoreToday) {
    return '⏰ No hay más horarios para hoy. Consulta mañana.';
  }
  if (schedule && schedule.next_departures && schedule.next_departures.length > 0) {
    const formattedList = schedule.next_departures
      .map(departure => {
        const minutesText = departure.minutesFromNow === 1 ? 'minuto' : 'minutos';
        return `🕐 ${departure.time} (en ${departure.minutesFromNow} ${minutesText}) → ${departure.destination}`;
      })
      .join('\n');
    return `${formattedList}\n\n⏰ _Hora actual: ${schedule.currentTime} | Horarios programados de TUS Santander_`;
  }
  return 'No hay información de horarios disponible.';
}

async function getTusSchedule(stopId, routeId) {
  try {
    const response = await axios.get('http://datos.santander.es/api/rest/datasets/programacionTUS_horariosLineas.json');
    const stopIdStr = stopId.toString();
    const routeIdStr = routeId.toString();
    const schedules = response.data.resources.filter(item => {
      const itemLinea = item['ayto:linea']?.toString();
      const itemParada = item['ayto:idParada']?.toString();
      return itemLinea === routeIdStr && itemParada === stopIdStr;
    });
    if (schedules.length === 0) {
      return null;
    }
    const now = new Date();
    const currentTimeInSeconds = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds();
    const departures = schedules
      .map(schedule => {
        const hora = schedule['ayto:hora'];
        const horaSegundos = parseInt(hora);
        const timeFormatted = convertirHora(hora);
        const diffInSeconds = horaSegundos - currentTimeInSeconds;
        const diffInMinutes = Math.round(diffInSeconds / 60);
        return {
          time: timeFormatted,
          timeInSeconds: horaSegundos,
          destination: schedule['ayto:nombreParada'],
          trip: schedule['ayto:numViaje'],
          service: schedule['ayto:servicio'],
          minutesFromNow: diffInMinutes,
          isFuture: diffInSeconds > 0
        };
      })
      .filter(departure => departure.isFuture)
      .sort((a, b) => a.timeInSeconds - b.timeInSeconds);
    if (departures.length === 0) {
      return { next_departures: [], noMoreToday: true };
    }
    return {
      next_departures: departures.slice(0, 5),
      currentTime: `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`
    };
  } catch (error) {
    console.error('❌ Error en getTusSchedule:', error.message);
    return null;
  }
}

module.exports = { getTusSchedule, formatSchedule };
