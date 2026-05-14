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
├── app.js               # Entry point único (Slack + Dashboard + API)
├── src/
│   ├── handlers/
│   ├── services/
│   ├── db/
│   ├── utils/
│   └── public/
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
4. Define en `.env` `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` y `KRONOS_CREDENTIALS_SECRET` (mínimo 16 caracteres)
5. Ejecuta el bot: `npm start`
6. (Opcional en local) Expón con ngrok: `ngrok http 3000`
7. Instala el bot en Slack: `https://TU-NGROK/slack/install`

Si vas a instalarlo con OAuth en vez de token directo, define también `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` y `SLACK_STATE_SECRET`.

## 📝 Comandos disponibles
- `/bus [parada] [línea]` → Consulta tiempo real y horarios
- `/bushelp` → Ayuda
- `/cancion` → Comando de prueba
- `/login [usuario] [contraseña]` → Guarda acceso a Kronos
- `/panel` → Configura horario semanal
- `/stop` → Detiene automatización
- `/semanal [DD/MM/AAAA|YYYY-MM-DD]` → Consulta horas semanales, calcula diferencia vs objetivo, genera Excel y puede sincronizar Google Sheets

## ⚙️ Variables para /semanal
- `SEMANAL_ALLOWED_USERNAMES`: usuarios permitidos por username (separados por coma)
- `SEMANAL_ALLOWED_USER_IDS`: usuarios permitidos por ID de Slack (separados por coma)
- `SEMANAL_WEEKLY_TARGETS`: objetivos semanales por persona, formato:
  `Nombre=20,Otra Persona=25`
- `SEMANAL_GSHEETS_ENABLED`: `true/false` para activar sync con Google Sheets
- `SEMANAL_GSHEETS_SPREADSHEET_ID`: ID del spreadsheet destino
- `SEMANAL_GSHEETS_SHEET_NAME`: nombre de pestaña destino (por defecto `Horas Extra Bot`)
- `SEMANAL_GSHEETS_CREDENTIALS_BASE64`: JSON de service account en base64 (recomendado en CI)
  - También soporta `SEMANAL_GSHEETS_CREDENTIALS_JSON` con el JSON inline.
  - El spreadsheet debe estar compartido con el `client_email` de la service account (permiso Editor).

## 🛠️ APIs utilizadas
- Tiempo real: https://datos.santander.es/api/rest/datasets/control_flotas_estimaciones.json
- Horarios programados: http://datos.santander.es/api/rest/datasets/programacionTUS_horariosLineas.json

## 🔒 Seguridad
- No subas `.env`, `data/` ni tus tokens a GitHub

## 🤝 Contribuir
¡Forkea el proyecto y haz tu PR!

---
Desarrollado por Hyos332 y GitHub Copilot 🚀
