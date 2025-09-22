module.exports = (app) => {
  app.command('/cancion', async ({ ack, respond }) => {
    await ack();
    await respond({
      response_type: 'in_channel',
      text: '🎵 Esta es la canción que canta el bot (instalación con token rotation).'
    });
  });
};
