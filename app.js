require('dotenv').config();
const { App, ExpressReceiver } = require('@slack/bolt');
const express = require('express');
const path = require('path');
const installationStore = require('./src/utils/installationStore');
const { handleBusCommand, handleRealTimeBusCommand } = require('./src/handlers/busHandler');
const { handleRefreshSchedule, handleRefreshRealTime } = require('./src/handlers/actionHandler');
const { handleLoginCommand, handlePanelCommand, handleScheduleCommand, handleStopCommand, handleSemanalCommand, initSchedules, reloadUserSchedule, sendScheduleConfirmation, tokenStore } = require('./src/handlers/kronosHandler');
const axios = require('axios');
const config = require('./src/config');
const db = require('./src/db'); 

const TIME_FORMAT_REGEX = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

function toMinutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return (hour * 60) + minute;
}

function normalizeSlots(rawSlots) {
  if (!Array.isArray(rawSlots)) {
    return null;
  }

  const normalized = [];

  for (const slot of rawSlots) {
    if (!slot || typeof slot !== 'object') {
      return null;
    }

    const dayOfWeek = Number(slot.day_of_week);
    const startTime = typeof slot.start_time === 'string' ? slot.start_time.trim() : '';
    const endTime = typeof slot.end_time === 'string' ? slot.end_time.trim() : '';
    const isActive = slot.is_active !== false;

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return null;
    }

    if (!TIME_FORMAT_REGEX.test(startTime) || !TIME_FORMAT_REGEX.test(endTime)) {
      return null;
    }

    if (toMinutes(startTime) >= toMinutes(endTime)) {
      return null;
    }

    normalized.push({
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      is_active: Boolean(isActive)
    });
  }

  return normalized;
}

// 1. Inicializar ExpressReceiver (Servidor Web)
const receiver = new ExpressReceiver({
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
});

// 2. Configurar rutas Web (Dashboard)
receiver.router.use('/static', express.static(path.join(__dirname, 'src/public')));
receiver.router.use(express.json()); // Permitir JSON en body

// Ruta principal del Dashboard
receiver.router.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/public/dashboard.html'));
});

receiver.router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// API: Obtener datos
receiver.router.get('/api/schedule', async (req, res) => {
  const token = req.query.token;
  const session = tokenStore.get(token);

  if (!session || Date.now() > session.expiresAt) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  try {
    const schedules = await db.getWeeklySchedule(session.slackId);
    res.json({
      schedules,
      expiresAt: session.expiresAt // Enviamos expiración al front
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error obteniendo datos' });
  }
});

// API: Guardar horario
receiver.router.post('/api/schedule', async (req, res) => {
  const token = req.query.token;
  const session = tokenStore.get(token);

  if (!session || Date.now() > session.expiresAt) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const validatedSlots = normalizeSlots(req.body?.slots);
  if (!validatedSlots) {
    return res.status(400).json({ error: 'Payload inválido para slots' });
  }

  try {
    // Guardar todos los slots (vaciando anteriores)
    await db.saveUserSlots(session.slackId, validatedSlots);

    // HOT RELOAD: Recargar tareas en memoria inmediatamente
    await reloadUserSchedule(session.slackId);

    // Notificar al usuario (asíncrono)
    sendScheduleConfirmation(session.slackId, validatedSlots);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error guardando datos' });
  }
});

// 3. Inicializar App de Bolt con ese receiver
const app = new App({
  receiver,
});

// Middleware de Debug Global
app.use(async ({ logger, body, next }) => {
  // ... (debug logs)
  await next();
});

// --- COMANDOS ---
app.command('/bus', handleBusCommand);
app.command('/realTimeBus', handleRealTimeBusCommand);
// Kronos
app.command('/login', handleLoginCommand);
app.command('/panel', handlePanelCommand);

console.log('🛠️ Registering /stop command. Handler type:', typeof handleStopCommand);
if (typeof handleStopCommand !== 'function') {
  console.error('❌ CRITICAL ERROR: handleStopCommand is not a function! Check exports in kronosHandler.js');
}

app.command('/stop', handleStopCommand);
app.command('/semanal', handleSemanalCommand);
// app.command('/horario', handleScheduleCommand); // Legacy
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
  await initSchedules();
  console.log('='.repeat(80));
  console.log('⚡️ BOT INICIADO - VERSION 3.0.2 - KRONOS ENABLED');
  console.log('🕒 Timestamp:', new Date().toISOString());
  console.log('🔌 Puerto:', process.env.PORT || 3000);
  console.log('='.repeat(80));
})();
