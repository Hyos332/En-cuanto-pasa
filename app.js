require('dotenv').config();
const { App } = require('@slack/bolt');
const installationStore = require('./src/utils/installationStore');
const { handleBusCommand, handleRealTimeBusCommand } = require('./src/handlers/busHandler');
const { handleRefreshSchedule, handleRefreshRealTime } = require('./src/handlers/actionHandler');
const { handleLoginCommand, handleLoginSubmission, handleScheduleCommand, initSchedules } = require('./src/handlers/kronosHandler');
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

// Middleware de Debug Global
app.use(async ({ logger, body, next }) => {
  console.log('📡 [DEBUG] Petición entrante de Slack:');
  if (body.type) console.log('   Tipo:', body.type);
  if (body.command) console.log('   Comando:', body.command);
  if (body.view) console.log('   View Callback ID:', body.view.callback_id);
  if (body.actions) console.log('   Action ID:', body.actions[0].action_id);
  await next();
});

// --- COMANDOS ---
app.command('/bus', handleBusCommand);
app.command('/realTimeBus', handleRealTimeBusCommand);

app.command('/login', handleLoginCommand);
app.view('kronos_login_modal', handleLoginSubmission);
app.command('/programar', handleScheduleCommand);

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
  await initSchedules(app);
  console.log('='.repeat(80));
  console.log('⚡️ BOT INICIADO culo con caca para carlisius - VERSION 3.0.1 - KRONOS ENABLED');
  console.log('🕒 Timestamp:', new Date().toISOString());
  console.log('🔌 Puerto:', process.env.PORT || 3000);
  console.log('='.repeat(80));
})();
