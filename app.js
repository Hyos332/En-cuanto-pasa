// app.js
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { App } = require('@slack/bolt');
const axios = require('axios'); // Necesitarás instalar: npm install axios

// carpeta donde guardaremos la "instalación" (dev only)
const DATA_DIR = path.join(__dirname, 'data');

// Función para obtener horarios de TUS
async function getTusSchedule(stopId, routeId) {
  try {
    console.log(`🌐 Haciendo llamada a API para parada ${stopId}, línea ${routeId}`);
    const response = await axios.get('http://datos.santander.es/api/rest/datasets/programacionTUS_horariosLineas.json');

    console.log(`📊 API respondió con ${response.data.resources.length} recursos`);

    // Convertir a strings para comparación consistente
    const stopIdStr = stopId.toString();
    const routeIdStr = routeId.toString();

    // Filtrar por línea y parada
    const schedules = response.data.resources.filter(item => {
      const itemLinea = item['ayto:linea']?.toString();
      const itemParada = item['ayto:idParada']?.toString();

      return itemLinea === routeIdStr && itemParada === stopIdStr;
    });

    console.log(`🎯 Después del filtro: ${schedules.length} resultados`);

    if (schedules.length === 0) {
      console.log('❌ No se encontraron horarios después del filtro');

      // Debug: mostrar algunos items para ver la estructura
      console.log('📋 Muestra de datos para debug:');
      response.data.resources.slice(0, 3).forEach((item, i) => {
        console.log(`  ${i}: línea=${item['ayto:linea']}, parada=${item['ayto:idParada']}, nombre=${item['ayto:nombreParada']}`);
      });

      return null;
    }

    // NUEVA LÓGICA: Obtener hora actual
    const now = new Date();
    const currentTimeInSeconds = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds();

    console.log(`🕐 Hora actual: ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')} (${currentTimeInSeconds} segundos)`);

    // Convertir formato de hora, filtrar futuros y calcular tiempo restante
    const departures = schedules
      .map(schedule => {
        const horaSegundos = parseInt(schedule['ayto:hora']);
        const timeFormatted = convertirHora(schedule['ayto:hora']);

        // Calcular diferencia en minutos
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
      .filter(departure => departure.isFuture) // Solo horarios futuros
      .sort((a, b) => a.timeInSeconds - b.timeInSeconds); // Ordenar por hora

    console.log(`✅ Procesados ${departures.length} horarios futuros`);

    if (departures.length === 0) {
      console.log('⏰ No hay más horarios para hoy');
      return { next_departures: [], noMoreToday: true };
    }

    return {
      next_departures: departures.slice(0, 5), // Solo los próximos 5
      currentTime: `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`
    };
  } catch (error) {
    console.error('❌ Error en getTusSchedule:', error.message);
    return null;
  }
}

// Función para convertir el formato de hora
function convertirHora(horaString) {
  // La API usa formato como "31140" que significa segundos desde medianoche
  const totalSegundos = parseInt(horaString);
  const horas = Math.floor(totalSegundos / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);

  return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
}

async function storeInstallation(installation) {
  console.log('🔥 ENTRANDO A storeInstallation con:', JSON.stringify(installation, null, 2));

  await fs.mkdir(DATA_DIR, { recursive: true });
  const id = installation.team?.id || installation.enterprise?.id || 'unknown';
  const filePath = path.join(DATA_DIR, `${id}.json`);

  console.log(`💾 Guardando instalación para team: ${id} en ${filePath}`);

  await fs.writeFile(filePath, JSON.stringify(installation, null, 2));

  console.log(`✅ Instalación guardada correctamente`);

  // Verificar que se escribió
  try {
    await fs.access(filePath);
    console.log(`🔍 Archivo existe después de escribir: SÍ`);
  } catch {
    console.log(`🔍 Archivo existe después de escribir: NO`);
  }
}

async function fetchInstallation(query) {
  const id = query.teamId || query.enterpriseId;
  const p = path.join(DATA_DIR, `${id}.json`);

  console.log(`🔍 Buscando instalación: ${p}`);

  try {
    const content = await fs.readFile(p, 'utf8');
    console.log(`✅ Instalación encontrada para team: ${id}`);
    return JSON.parse(content);
  } catch (error) {
    console.log(`❌ No se encontró instalación para team: ${id}`);
    console.log(`📁 Archivos en directorio data:`);

    try {
      const files = await fs.readdir(DATA_DIR);
      console.log(`   ${files.join(', ')}`);
    } catch (dirError) {
      console.log(`   Directorio no existe: ${DATA_DIR}`);
    }

    throw error;
  }
}

async function deleteInstallation(query) {
  const id = query.teamId || query.enterpriseId;
  await fs.unlink(path.join(DATA_DIR, `${id}.json`)).catch(() => { });
}

const installationStore = {
  storeInstallation,
  fetchInstallation,
  deleteInstallation
};

const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  scopes: ['chat:write', 'commands', 'app_mentions:read'],
  installationStore,
  installerOptions: {
    installPath: '/slack/install',
    redirectUriPath: '/slack/oauth_redirect',
  },
  port: process.env.PORT || 3000
});

// Comando para consultar horarios de bus
app.command('/bus', async ({ ack, respond, command }) => {
  console.log('🚌 Comando /bus recibido:', command.text);

  try {
    await ack();
    console.log('✅ ACK enviado');

    const args = command.text.split(' ');
    const stopId = args[0];
    const routeId = args[1] || '1'; // Por defecto línea 1

    console.log(`📍 Buscando parada: ${stopId}, línea: ${routeId}`);

    if (!stopId) {
      await respond({
        response_type: 'ephemeral',
        text: 'Por favor proporciona el ID de la parada. Ejemplo: `/bus 338` (para línea 1) o `/bus 338 2` (para línea 2)'
      });
      return;
    }

    await respond({
      response_type: 'ephemeral',
      text: '🔍 Consultando estimaciones en tiempo real y horarios programados...'
    });

    // PRIMERO: Intentar obtener datos en tiempo real
    console.log('🔍 Llamando a getTusRealTimeEstimates...');
    const realTimeData = await getTusRealTimeEstimates(stopId, routeId);
    console.log('📊 Resultado de tiempo real:', realTimeData ? 'Datos encontrados' : 'Sin datos');

    if (realTimeData && !realTimeData.noBusesActive) {
      // HAY BUSES ACTIVOS EN TIEMPO REAL
      await respond({
        response_type: 'in_channel',
        text: `🚌 *TIEMPO REAL - Línea ${routeId} - Parada ${stopId}:*\n${formatRealTimeSchedule(realTimeData)}`
      });

      console.log('✅ Respuesta de tiempo real enviada correctamente');
      return;
    }

    // SEGUNDO: Si no hay buses activos, usar horarios programados
    console.log('🔍 No hay buses activos. Consultando horarios programados...');
    const scheduleData = await getTusSchedule(stopId, routeId);
    console.log('📊 Resultado de horarios programados:', scheduleData ? 'Datos encontrados' : 'Sin datos');

    if (!scheduleData) {
      await respond({
        response_type: 'ephemeral',
        text: `❌ No encontré información para la parada ${stopId} en la línea ${routeId}. Verifica los datos.`
      });
      return;
    }

    // Mostrar horarios programados como respaldo
    await respond({
      response_type: 'in_channel',
      text: `🚌 *HORARIOS PROGRAMADOS - Línea ${routeId} - Parada ${stopId}:*\n${formatSchedule(scheduleData)}\n\n⚠️ _No hay buses activos actualmente. Mostrando horarios programados._`
    });

    console.log('✅ Respuesta de horarios programados enviada correctamente');

  } catch (error) {
    console.error('❌ Error en comando /bus:', error);

    try {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Ocurrió un error consultando las APIs. Revisa los logs del servidor.'
      });
    } catch (respondError) {
      console.error('❌ Error enviando respuesta de error:', respondError);
    }
  }
});

function formatSchedule(schedule) {
  try {
    if (schedule.noMoreToday) {
      return '⏰ No hay más horarios para hoy. Consulta mañana.';
    }

    if (schedule && schedule.next_departures && schedule.next_departures.length > 0) {
      const formattedList = schedule.next_departures
        .map(departure => {
          const minutesText = departure.minutesFromNow === 1 ? 'minuto' : 'minutos';
          return `🕐 ${departure.time} (en ${departure.minutesFromNow} ${minutesText}) 🚍 → ${departure.destination}`;
        })
        .join('\n');

      return `${formattedList}\n\n🕒 _Hora actual: ${schedule.currentTime} | 📅 Horarios programados de TUS Santander_`;
    }
    return 'No hay información de horarios disponible.';
  } catch (error) {
    console.error('❌ Error en formatSchedule:', error);
    return 'Error formateando la respuesta.';
  }
}

app.event('app_mention', async ({ event, client }) => {
  // Si mencionan al bot con la palabra "ip", responder con la IP del servidor
  if (event.text.toLowerCase().includes('ip')) {
    try {
      const response = await axios.get('https://api.ipify.org?format=json');
      const ip = response.data.ip;
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `🌐 Mi dirección IP pública es: \`${ip}\``
      });
    } catch (error) {
      console.error('Error obteniendo IP:', error);
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `❌ No pude obtener mi IP. Error: ${error.message}`
      });
    }
    return;
  }

  await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.ts,
    text: `Hola <@${event.user}> — bienvenido! Prueba /bus para ver horarios`
  });
});

// un slash command de ejemplo
app.command('/cancion', async ({ ack, respond }) => {
  await ack();
  await respond({
    response_type: 'in_channel',
    text: '🎵 Esta es la canción que canta el bot (instalación con token rotation).'
  });
});

// Comando de ayuda
app.command('/bushelp', async ({ ack, respond }) => {
  await ack();
  await respond({
    response_type: 'ephemeral',
    text: `🚌 *Cómo usar el bot*
    \n**Comando principal:**
    \n• \`/bus 338\` → Consulta la parada 338 en línea 1
    \n• \`/bus 338 2\` → Consulta la parada 338 en línea 2
    \n\n**¿Qué hace el bot?**
    \n🔴 **Primero** busca buses activos en tiempo real con distancia exacta
    \n📅 **Si no hay buses activos**, muestra horarios programados
    \n\n**Información que recibes:**
    \n• ⏰ Tiempo exacto en minutos hasta llegada
    \n• 📍 Distancia actual del bus a la parada
    \n• 🎯 Destino del bus
    \n• 🚌 ID del bus (para tiempo real)
    \n\n🔧 *Otros comandos*
    \n• \`/bushelp\`: Ver esta ayuda
    \n• \`/cancion\`: Comando de prueba
    `
  });
});

// Función para obtener estimaciones en tiempo real de TUS
async function getTusRealTimeEstimates(stopId, routeId) {
  try {
    console.log(`🌐 Haciendo llamada a API de tiempo real para parada ${stopId}, línea ${routeId}`);
    const response = await axios.get('https://datos.santander.es/api/rest/datasets/control_flotas_estimaciones.json');

    console.log(`📊 API de tiempo real respondió con ${response.data.resources.length} recursos`);

    // Convertir a strings para comparación consistente
    const stopIdStr = stopId.toString();
    const routeIdStr = routeId.toString();

    // Filtrar por línea y parada
    const estimates = response.data.resources.filter(item => {
      const itemLinea = item['ayto:etiqLinea']?.toString();
      const itemParada = item['ayto:paradaId']?.toString();

      return itemLinea === routeIdStr && itemParada === stopIdStr;
    });

    console.log(`🎯 Después del filtro: ${estimates.length} buses encontrados`);

    if (estimates.length === 0) {
      console.log('❌ No se encontraron buses en tiempo real');

      // Debug: mostrar algunos items para ver la estructura
      console.log('📋 Muestra de datos para debug:');
      response.data.resources.slice(0, 3).forEach((item, i) => {
        console.log(`  ${i}: línea=${item['ayto:etiqLinea']}, parada=${item['ayto:paradaId']}`);
      });

      return null;
    }

    // Obtener hora actual
    const now = new Date();

    // Procesar estimaciones
    const buses = [];

    estimates.forEach(estimate => {
      // Procesar destino 1 si existe
      if (estimate['ayto:tiempo1'] && parseInt(estimate['ayto:tiempo1']) > 0) {
        const timeInSecondsOriginal = parseInt(estimate['ayto:tiempo1']);

        // ⏰ RESTAR 3 MINUTOS (180 segundos) AL TIEMPO ORIGINAL
        const timeInSecondsAdjusted = Math.max(0, timeInSecondsOriginal - 180);
        const timeInMinutes = Math.round(timeInSecondsAdjusted / 60);

        console.log(`⏰ Bus ${estimate['dc:identifier']}: Tiempo original: ${Math.round(timeInSecondsOriginal / 60)} min → Ajustado: ${timeInMinutes} min (-3 min)`);

        // Solo agregar si el tiempo ajustado es mayor a 0
        if (timeInSecondsAdjusted > 0) {
          buses.push({
            destination: estimate['ayto:destino1'],
            timeInSeconds: timeInSecondsAdjusted,
            timeInMinutes: timeInMinutes,
            distanceInMeters: parseInt(estimate['ayto:distancia1'] || 0),
            busId: estimate['dc:identifier'],
            lastUpdate: estimate['ayto:fechActual'],
            originalTimeInMinutes: Math.round(timeInSecondsOriginal / 60) // Para debug
          });
        }
      }

      // Procesar destino 2 si existe y es diferente
      if (estimate['ayto:tiempo2'] &&
        parseInt(estimate['ayto:tiempo2']) > 0 &&
        estimate['ayto:destino2'] !== estimate['ayto:destino1']) {
        const timeInSecondsOriginal = parseInt(estimate['ayto:tiempo2']);

        // ⏰ RESTAR 3 MINUTOS (180 segundos) AL TIEMPO ORIGINAL
        const timeInSecondsAdjusted = Math.max(0, timeInSecondsOriginal - 180);
        const timeInMinutes = Math.round(timeInSecondsAdjusted / 60);

        console.log(`⏰ Bus ${estimate['dc:identifier']} (destino 2): Tiempo original: ${Math.round(timeInSecondsOriginal / 60)} min → Ajustado: ${timeInMinutes} min (-3 min)`);

        // Solo agregar si el tiempo ajustado es mayor a 0
        if (timeInSecondsAdjusted > 0) {
          buses.push({
            destination: estimate['ayto:destino2'],
            timeInSeconds: timeInSecondsAdjusted,
            timeInMinutes: timeInMinutes,
            distanceInMeters: parseInt(estimate['ayto:distancia2'] || 0),
            busId: estimate['dc:identifier'],
            lastUpdate: estimate['ayto:fechActual'],
            originalTimeInMinutes: Math.round(timeInSecondsOriginal / 60) // Para debug
          });
        }
      }
    });

    // Ordenar por tiempo de llegada
    buses.sort((a, b) => a.timeInSeconds - b.timeInSeconds);

    console.log(`✅ Procesados ${buses.length} buses en tiempo real (con ajuste de -3 minutos)`);

    if (buses.length === 0) {
      console.log('⏰ No hay buses en camino actualmente (después del ajuste de tiempo)');
      return { buses: [], noBusesActive: true };
    }

    return {
      buses: buses.slice(0, 5), // Solo los próximos 5
      currentTime: `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`,
      isRealTime: true
    };
  } catch (error) {
    console.error('❌ Error en getTusRealTimeEstimates:', error.message);
    return null;
  }
}

app.command('/realTimeBus', async ({ ack, respond, command }) => {
  console.log('🚌 Comando /realTimeBus recibido:', command.text);

  try {
    await ack();
    console.log('✅ ACK enviado');

    const args = command.text.split(' ');
    const stopId = args[0];
    const routeId = args[1] || '1'; // Por defecto línea 1

    console.log(`📍 Buscando parada: ${stopId}, línea: ${routeId}`);

    if (!stopId) {
      await respond({
        response_type: 'ephemeral',
        text: 'Por favor proporciona el ID de la parada. Ejemplo: `/realTimeBus 338` (para línea 1) o `/realTimeBus 338 2` (para línea 2)'
      });
      return;
    }

    await respond({
      response_type: 'ephemeral',
      text: '🔍 Buscando estimaciones en tiempo real...'
    });

    console.log('🔍 Llamando a getTusRealTimeEstimates...');
    const estimates = await getTusRealTimeEstimates(stopId, routeId);
    console.log('📊 Resultado de getTusRealTimeEstimates:', estimates ? 'Datos encontrados' : 'Sin datos');

    if (!estimates) {
      await respond({
        response_type: 'ephemeral',
        text: `❌ No encontré estimaciones en tiempo real para la parada ${stopId} en la línea ${routeId}. Verifica los datos.`
      });
      return;
    }

    await respond({
      response_type: 'in_channel',
      text: `🚌 *Estimaciones en Tiempo Real Línea ${routeId} - Parada ${stopId}:*\n${formatRealTimeEstimates(estimates)}`
    });

    console.log('✅ Respuesta enviada correctamente');

  } catch (error) {
    console.error('❌ Error en comando /realTimeBus:', error);

    try {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Ocurrió un error. Revisa los logs del servidor.'
      });
    } catch (respondError) {
      console.error('❌ Error enviando respuesta de error:', respondError);
    }
  }
});

function formatRealTimeEstimates(estimates) {
  try {
    if (estimates.noBusesActive) {
      return '⏰ No hay buses en camino actualmente. Consulta más tarde.';
    }

    if (estimates && estimates.buses && estimates.buses.length > 0) {
      const formattedList = estimates.buses
        .map(bus => {
          const minutesText = bus.timeInMinutes === 1 ? 'minuto' : 'minutos';
          return `🚌 ${bus.destination} - ${bus.timeInMinutes} ${minutesText} (ID: ${bus.busId})`;
        })
        .join('\n');

      return `${formattedList}\n\n⏰ _Hora actual: ${estimates.currentTime} | Estimaciones en tiempo real de TUS Santander_`;
    }
    return 'No hay información de estimaciones disponible.';
  } catch (error) {
    console.error('❌ Error en formatRealTimeEstimates:', error);
    return 'Error formateando la respuesta.';
  }
}

app.command('/realTimeBusHelp', async ({ ack, respond }) => {
  await ack();
  await respond({
    response_type: 'ephemeral',
    text: `🚌 *Cómo usar el comando de estimaciones en tiempo real*
    \n1. Para consultar estimaciones en tiempo real de autobús, usa el comando /realTimeBus seguido del ID de la parada. Ejemplo: \`/realTimeBus 338\`.
    \n2. Opcionalmente, puedes especificar el ID de la línea. Ejemplo: \`/realTimeBus 338 2\` para la línea 2.
    \n3. El comando responderá con las estimaciones de llegada en tiempo real para la parada en la línea indicada.
    \n\n🔧 *Comandos disponibles*
    \n- \`/realTimeBus\`: Consultar estimaciones en tiempo real de autobús.
    \n- \`/realTimeBusHelp\`: Ver esta ayuda.
    `
  });
});

// Nueva función para formatear la respuesta de horarios en tiempo real
function formatRealTimeSchedule(schedule) {
  try {
    if (schedule.noBusesActive) {
      return '🚌 No hay buses activos en este momento para esta parada y línea.\n\n⏰ _Consulta en tiempo real de TUS Santander_';
    }

    if (schedule && schedule.buses && schedule.buses.length > 0) {
      const formattedList = schedule.buses
        .map(bus => {
          const minutesText = bus.timeInMinutes === 1 ? 'minuto' : 'minutos';
          const distanceKm = (bus.distanceInMeters / 1000).toFixed(1);

          if (bus.timeInMinutes < 1) {
            return `🚨 **LLEGANDO AHORA** 🚍 → ${bus.destination}\n   📍 Distancia: ${distanceKm} km | 🆔 Bus ID: ${bus.busId}`;
          } else if (bus.timeInMinutes === 1) {
            return `⚠️ **1 MINUTO** 🚍 → ${bus.destination}\n   📍 Distancia: ${distanceKm} km | 🆔 Bus ID: ${bus.busId}`;
          } else {
            return `🕒 **${bus.timeInMinutes} minutos** 🚍 → ${bus.destination}\n   📍 Distancia: ${distanceKm} km | 🆔 Bus ID: ${bus.busId}`;
          }
        })
        .join('\n\n');

      return `${formattedList}\n\n🕒 _Hora actual: ${schedule.currentTime} | 🔴 Estimaciones ajustadas (-3 min) - TUS Santander_`;
    }
    return 'No hay información de buses en tiempo real disponible.';
  } catch (error) {
    console.error('❌ Error en formatRealTimeSchedule:', error);
    return 'Error formateando la respuesta en tiempo real.';
  }
}

// Ejemplo de uso de la nueva función en un comando
app.command('/testRealTimeSchedule', async ({ ack, respond }) => {
  await ack();

  // Simular datos de entrada
  const scheduleData = {
    noBusesActive: false,
    buses: [
      { destination: 'Centro', timeInMinutes: 2, distanceInMeters: 150, busId: '1234' },
      { destination: 'Hospital', timeInMinutes: 5, distanceInMeters: 300, busId: '5678' }
    ],
    currentTime: '14:30'
  };

  // Formatear respuesta
  const responseText = formatRealTimeSchedule(scheduleData);

  await respond({
    response_type: 'in_channel',
    text: responseText
  });
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bot corriendo en http://localhost:' + (process.env.PORT || 3000));
  console.log('  - Install page: /slack/install');
  console.log('  - Redirect path: /slack/oauth_redirect');
})();
