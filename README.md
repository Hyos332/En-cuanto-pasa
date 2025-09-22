# 🚌 En-cuanto-pasa: Bot de Slack para TUS Santander

Bot de Slack que te dice en tiempo real cuántos minutos faltan para que llegue el bus a tu parada en Santander.

## 🚀 Características
- Consulta buses en tiempo real (API oficial de TUS)
- Muestra distancia y minutos ajustados (-3 min)
- Respaldo con horarios programados si no hay buses activos
- Comandos: `/bus`, `/bushelp`, `/cancion`
- Fácil de instalar y usar

## 📦 Estructura del proyecto
```
En-cuanto-pasa/
├── src/
│   ├── app.js
│   └── bot/
│       ├── index.js
│       ├── commands/
│       │   ├── bus.js
│       │   ├── bushelp.js
│       │   └── cancion.js
│       ├── events/
│       │   └── appMention.js
│       └── utils/
│           ├── tusRealTime.js
│           ├── tusSchedule.js
│           └── installationStore.js
├── data/                # Instalaciones de Slack (ignorado por git)
├── .env                 # Variables de entorno (ignorado por git)
├── .gitignore
├── package.json
├── README.md
```

## ⚡️ Instalación rápida
1. Clona el repo: `git clone https://github.com/Hyos332/En-cuanto-pasa.git`
2. Instala dependencias: `npm install`
3. Crea tu `.env` con tus credenciales de Slack
4. Ejecuta el bot: `node src/app.js`
5. Expón con ngrok: `ngrok http 3000`
6. Instala el bot en Slack: `https://TU-NGROK/slack/install`

## 📝 Comandos disponibles
- `/bus [parada] [línea]` → Consulta tiempo real y horarios
- `/bushelp` → Ayuda
- `/cancion` → Comando de prueba

## 🛠️ APIs utilizadas
- Tiempo real: https://datos.santander.es/api/rest/datasets/control_flotas_estimaciones.json
- Horarios programados: http://datos.santander.es/api/rest/datasets/programacionTUS_horariosLineas.json

## 🔒 Seguridad
- No subas `.env`, `data/` ni tus tokens a GitHub

## 🤝 Contribuir
¡Forkea el proyecto y haz tu PR!

---
Desarrollado por Hyos332 y GitHub Copilot 🚀
