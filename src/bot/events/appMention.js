module.exports = (app) => {
  app.event('app_mention', async ({ event, client }) => {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: `Hola <@${event.user}> — bienvenido! Prueba /bus para ver horarios.`
    });
  });
};
