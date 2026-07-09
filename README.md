# 🚌 En-cuanto-pasa: Bot de Slack para TUS Santander

Bot de Slack que te dice en tiempo real cuántos minutos faltan para que llegue el bus a tu parada en Santander.

## 🚀 Características
- Consulta buses en tiempo real (API oficial de TUS)
- Muestra distancia y minutos ajustados (-3 min)
- Respaldo con horarios programados si no hay buses activos
- Monitor del servidor por SSH con estado de CPU, RAM, disco, swap y procesos pesados
- Alertas automáticas a Slack cuando el servidor entra en warning/crítico
- Comandos: `/bus`, `/realTimeBus`, `/bushelp`, `/cancion`, `/login`, `/panel`, `/stop`, `/semanal`, `/server`
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
4. Define en `.env` `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `KRONOS_CREDENTIALS_SECRET` (mínimo 16 caracteres) y `PUBLIC_BASE_URL`
5. Ejecuta el bot: `npm start`
6. (Opcional en local) Expón con ngrok: `ngrok http 3000`
7. Instala el bot en Slack: `https://TU-NGROK/slack/install`

El arranque principal usa token directo (`SLACK_BOT_TOKEN`) para evitar depender de instalaciones OAuth guardadas.

En Docker Compose el contenedor usa `restart: unless-stopped`, healthcheck y `autoheal` para reiniciar el bot si el proceso se cae o si `/health` deja de responder. Esto no sustituye un monitor externo: si el servidor host completo se congela o Docker deja de funcionar, el bot que vive dentro de ese mismo host tampoco podrá avisar.

## 📝 Comandos disponibles
- `/bus [parada] [línea]` → Consulta tiempo real y horarios
- `/bushelp` → Ayuda
- `/cancion` → Comando de prueba
- `/login [usuario] [contraseña]` → Guarda acceso a Kronos
- `/panel` → Configura horario semanal
- `/stop` → Detiene automatización
- `/semanal [DD/MM/AAAA|YYYY-MM-DD]` → Consulta horas semanales, calcula diferencia vs objetivo, genera Excel y puede sincronizar Google Sheets
- `/server` o `/servidor` → Revisa estado del servidor por SSH
- `/server procesos` → Muestra más procesos por consumo de RAM/CPU

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

## 🖥️ Variables para monitor del servidor
- `SERVER_MONITOR_HOST`: host/IP del servidor (por defecto `172.22.9.2`)
- `SERVER_MONITOR_USERNAME`: usuario SSH para consultar métricas
- `SERVER_MONITOR_PASSWORD` o `SERVER_MONITOR_PRIVATE_KEY`: credencial SSH
- `SERVER_MONITOR_PRIVATE_KEY_PATH`: ruta a una llave montada en el contenedor si prefieres archivo
- `SERVER_MONITOR_ENABLED`: `true/false` para activar alertas automáticas
- `SERVER_MONITOR_ALERT_CHANNEL_ID`: canal Slack donde enviar warnings/críticos
- `SERVER_MONITOR_ALLOWED_USERNAMES` / `SERVER_MONITOR_ALLOWED_USER_IDS`: allowlist opcional para `/server`
- `SERVER_MONITOR_POLL_INTERVAL_MS`: frecuencia de revisión automática (por defecto 5 minutos)
- `SERVER_MONITOR_ALERT_COOLDOWN_MS`: evita spam si el problema sigue activo (por defecto 30 minutos)
- Umbrales ajustables: `SERVER_MONITOR_CPU_WARN_PERCENT`, `SERVER_MONITOR_MEMORY_WARN_PERCENT`, `SERVER_MONITOR_DISK_WARN_PERCENT`, `SERVER_MONITOR_LOAD_WARN_PER_CORE`, entre otros en `.env.example`.

## 🛠️ APIs utilizadas
- Tiempo real: https://datos.santander.es/api/rest/datasets/control_flotas_estimaciones.json
- Horarios programados: http://datos.santander.es/api/rest/datasets/programacionTUS_horariosLineas.json

## 🔒 Seguridad
- No subas `.env`, `data/` ni tus tokens a GitHub

## 🤝 Contribuir
¡Forkea el proyecto y haz tu PR!

---
Desarrollado por Hyos332 y GitHub Copilot 🚀
