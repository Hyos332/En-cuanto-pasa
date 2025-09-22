const { App } = require('@slack/bolt');
const { registerCommands } = require('./commands');
const { registerEvents } = require('./events');
const installationStore = require('./utils/installationStore');

function startBot() {
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
