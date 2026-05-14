require('dotenv').config();
const { App, ExpressReceiver } = require('@slack/bolt');
const installationStore = require('./src/utils/installationStore');
const { handleBusCommand, handleRealTimeBusCommand } = require('./src/handlers/busHandler');
const { handleRefreshSchedule, handleRefreshRealTime } = require('./src/handlers/actionHandler');

const oauthConfigured = Boolean(
  process.env.SLACK_CLIENT_ID &&
  process.env.SLACK_CLIENT_SECRET &&
  process.env.SLACK_STATE_SECRET
);

if (!process.env.SLACK_SIGNING_SECRET) {
  throw new Error('Falta SLACK_SIGNING_SECRET en el entorno.');
}

if (!process.env.SLACK_BOT_TOKEN && !oauthConfigured) {
  throw new Error('Falta SLACK_BOT_TOKEN o la configuración OAuth completa de Slack.');
}

const receiverOptions = {
  signingSecret: process.env.SLACK_SIGNING_SECRET,
};

if (oauthConfigured) {
  Object.assign(receiverOptions, {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    stateSecret: process.env.SLACK_STATE_SECRET,
    scopes: ['chat:write', 'commands', 'app_mentions:read'],
    installationStore,
    installerOptions: {
      installPath: '/slack/install',
      redirectUriPath: '/slack/oauth_redirect',
    },
  });
}

const receiver = new ExpressReceiver(receiverOptions);

receiver.router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const appOptions = {
  receiver,
};

if (process.env.SLACK_BOT_TOKEN) {
  appOptions.token = process.env.SLACK_BOT_TOKEN;
}

const app = new App(appOptions);

app.use(async ({ logger, body, next }) => {
  logger.debug('Slack event received', body?.type || body?.command || 'unknown');
  await next();
});

app.command('/bus', handleBusCommand);
app.command('/realTimeBus', handleRealTimeBusCommand);

app.action('refresh_schedule_btn', handleRefreshSchedule);
app.action('refresh_realtime_btn', handleRefreshRealTime);

app.event('app_mention', async ({ event, client }) => {
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
    text: `🤖 **Versión del Bot:** v2.1.0 (solo TUS) - ${new Date().toISOString()}`
  });
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('='.repeat(80));
  console.log('⚡️ BOT INICIADO - TUS SANTANDER');
  console.log('🕒 Timestamp:', new Date().toISOString());
  console.log('🔌 Puerto:', process.env.PORT || 3000);
  console.log('='.repeat(80));
})();
