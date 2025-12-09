require('dotenv').config();
const { App } = require('@slack/bolt');
const installationStore = require('./src/utils/installationStore');
const { handleBusCommand, handleRealTimeBusCommand } = require('./src/handlers/busHandler');
const { handleRefreshSchedule, handleRefreshRealTime } = require('./src/handlers/actionHandler');
const axios = require('axios');
const config = require('./src/config');

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

// --- COMANDOS ---
app.command('/bus', handleBusCommand);
app.command('/realTimeBus', handleRealTimeBusCommand);

// --- ACCIONES (BOTONES) ---
app.action('refresh_schedule_btn', handleRefreshSchedule);
app.action('refresh_realtime_btn', handleRefreshRealTime);

// --- EVENTOS ---
app.event('app_mention', async ({ event, client }) => {
  if (event.text.toLowerCase().includes('ip')) {
    try {
      const response = await axios.get(config.API.IPIFY);
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `🌐 Mi dirección IP pública es: \`${response.data.ip}\``
      });
    } catch (error) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `❌ Error obteniendo IP: ${error.message}`
      });
    }
    return;
  }

  await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.ts,
    text: `Hola <@${event.user}> — bienvenido! Prueba /bus para ver horarios con botones interactivos 🔄`
  });
});

// Otros comandos legacy
app.command('/cancion', async ({ ack, respond }) => {
  await ack();
  await respond({ response_type: 'in_channel', text: '🎵 Esta es la canción que canta el bot (Refactorizado).' });
});

app.command('/bushelp', async ({ ack, respond }) => {
  await ack();
  await respond({
    response_type: 'ephemeral',
    text: `🚌 *Ayuda del Bot TUS*\n\nAhora con botones interactivos para actualizar la información sin reescribir comandos.\n\n• \`/bus [parada] [linea]\` - Ver horarios y tiempo real.\n• \`/realTimeBus [parada] [linea]\` - Solo tiempo real.`
  });
});

app.command('/botversion', async ({ ack, respond }) => {
  await ack();
  await respond({
    response_type: 'ephemeral',
    text: `🤖 **Versión del Bot:** v2.0.0 (Refactorizado con Botones) - ${new Date().toISOString()}`
  });
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bot (Refactorizado v2 - CON BOTONES) corriendo en puerto ' + (process.env.PORT || 3000));
})();
