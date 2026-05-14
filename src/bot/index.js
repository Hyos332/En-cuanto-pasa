const { App } = require('@slack/bolt');
const { registerCommands } = require('./commands');
const { registerEvents } = require('./events');
const config = require('../config');

function startBot() {
  config.requireRuntimeConfig();

  const app = new App({
    signingSecret: config.SLACK.SIGNING_SECRET,
    token: config.SLACK.BOT_TOKEN,
    port: config.APP.PORT
  });

  registerCommands(app);
  registerEvents(app);

  (async () => {
    await app.start(config.APP.PORT);
    console.log('⚡️ Bot corriendo en http://localhost:' + config.APP.PORT);
  })();
}

module.exports = { startBot };
