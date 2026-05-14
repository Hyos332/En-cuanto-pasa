const { App } = require('@slack/bolt');
const { registerCommands } = require('./commands');
const { registerEvents } = require('./events');
const installationStore = require('./utils/installationStore');

function startBot() {
  const oauthConfigured = Boolean(
    process.env.SLACK_CLIENT_ID &&
    process.env.SLACK_CLIENT_SECRET &&
    process.env.SLACK_STATE_SECRET
  );

  const appConfig = {
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    port: process.env.PORT || 3000
  };

  if (!process.env.SLACK_SIGNING_SECRET) {
    throw new Error('Falta SLACK_SIGNING_SECRET en el entorno.');
  }

  if (!process.env.SLACK_BOT_TOKEN && !oauthConfigured) {
    throw new Error('Falta SLACK_BOT_TOKEN o la configuración OAuth completa de Slack.');
  }

  if (process.env.SLACK_BOT_TOKEN) {
    appConfig.token = process.env.SLACK_BOT_TOKEN;
  }

  if (oauthConfigured) {
    Object.assign(appConfig, {
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

  const app = new App(appConfig);

  registerCommands(app);
  registerEvents(app);

  (async () => {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Bot corriendo en http://localhost:' + (process.env.PORT || 3000));
    console.log('  - Install page: /slack/install');
    console.log('  - Redirect path: /slack/oauth_redirect');
  })();
}

module.exports = { startBot };
