module.exports = (app) => {
  app.command('/bushelp', async ({ ack, respond }) => {
    await ack();
    await respond({
      response_type: 'ephemeral',
      text: `🚌 *Cómo usar el bot*
• /bus [parada] [línea] → Consulta en tiempo real y horarios programados
• /bushelp → Ver esta ayuda
• /cancion → Comando de prueba
\nPrimero busca buses activos en tiempo real, si no hay muestra horarios programados.`
    });
  });
};
