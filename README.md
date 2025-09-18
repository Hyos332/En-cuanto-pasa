# 🚌 Bot de Horarios TUS Santander para Slack

Bot de Slack que proporciona información **en tiempo real** de los autobuses de TUS (Transporte Urbano de Santander).

## ✨ Características

- 🔴 **Tiempo real**: Consulta la ubicación exacta de los buses y calcula tiempos precisos
- 📍 **Distancia exacta**: Muestra la distancia actual del bus a la parada
- 📅 **Horarios programados**: Respaldo cuando no hay buses activos
- ⏰ **Ajuste inteligente**: Resta 3 minutos automáticamente para mayor precisión
- 🎯 **Múltiples líneas**: Soporte para todas las líneas de TUS

## 🚀 Comandos disponibles

### `/bus [parada] [línea]`
Consulta horarios en tiempo real para una parada específica.

**Ejemplos:**
- `/bus 338` → Parada 338 en línea 1
- `/bus 338 2` → Parada 338 en línea 2

### `/bushelp`
Muestra ayuda detallada sobre cómo usar el bot.

### `/cancion`
Comando de prueba para verificar que el bot funciona.

## 📊 APIs utilizadas

1. **Control de Flotas (Tiempo Real)**
   - URL: `https://datos.santander.es/api/rest/datasets/control_flotas_estimaciones.json`
   - Proporciona: Ubicación actual, tiempo estimado, distancia exacta

2. **Horarios Programados (Respaldo)**
   - URL: `http://datos.santander.es/api/rest/datasets/programacionTUS_horariosLineas.json`
   - Proporciona: Horarios teóricos cuando no hay buses activos

## 🛠️ Instalación

### Prerrequisitos
- Node.js 14+
- ngrok (para desarrollo)
- Una app de Slack configurada

### 1. Clonar el repositorio
```bash
git clone https://github.com/tu-usuario/slack-bot-tus-santander.git
cd slack-bot-tus-santander
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
Crea un archivo `.env` con:

```env
SLACK_SIGNING_SECRET=tu_signing_secret
SLACK_CLIENT_ID=tu_client_id
SLACK_CLIENT_SECRET=tu_client_secret
SLACK_STATE_SECRET=cualquier_string_secreto
PORT=3000
```

### 4. Configurar tu app de Slack

#### Slash Commands
Crea estos comandos en https://api.slack.com/apps:

- `/bus` → `https://tu-ngrok-url.ngrok-free.app/slack/events`
- `/bushelp` → `https://tu-ngrok-url.ngrok-free.app/slack/events`
- `/cancion` → `https://tu-ngrok-url.ngrok-free.app/slack/events`

#### OAuth & Permissions
- **Redirect URL**: `https://tu-ngrok-url.ngrok-free.app/slack/oauth_redirect`
- **Scopes**: `chat:write`, `commands`, `app_mentions:read`

### 5. Ejecutar en desarrollo

```bash
# Terminal 1: Iniciar la aplicación
npm start

# Terminal 2: Exponer con ngrok
ngrok http 3000
```

### 6. Instalar en Slack
Ve a: `https://tu-ngrok-url.ngrok-free.app/slack/install`

## 📱 Ejemplo de uso

```
Usuario: /bus 338

Bot: 🚌 TIEMPO REAL - Línea 1 - Parada 338:

🚌 **5 minutos** → GONZALEZ TREVILLA
   📍 Distancia: 2.3 km | Bus ID: 144

🚌 **12 minutos** → GONZALEZ TREVILLA
   📍 Distancia: 4.8 km | Bus ID: 267

⏰ Hora actual: 14:18 | 🔴 Estimaciones ajustadas (-3 min) - TUS Santander
```

## 🏗️ Arquitectura

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Slack User    │────│   Slack Bot     │────│  TUS APIs       │
│                 │    │                 │    │                 │
│ /bus 338        │────│ 1. Tiempo Real  │────│ control_flotas  │
│                 │    │ 2. Programados  │────│ programacion    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🔧 Desarrollo

### Estructura del proyecto
```
slack-bot-tus-santander/
├── app.js              # Aplicación principal
├── package.json        # Dependencias
├── .env               # Variables de entorno (no incluido)
├── .gitignore         # Archivos ignorados por Git
├── README.md          # Documentación
└── data/              # Instalaciones de Slack (no incluido)
```

### Scripts disponibles
```bash
npm start              # Iniciar aplicación
npm run dev            # Modo desarrollo con nodemon
npm test               # Ejecutar pruebas (si las hay)
```

## 🚀 Despliegue en producción

Para producción, puedes usar servicios como:
- **Heroku**: Fácil deploy con git
- **Railway**: Moderno y simple
- **AWS/Google Cloud**: Más control y escalabilidad

Recuerda actualizar las URLs en tu app de Slack cuando cambies de ngrok a producción.

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agrega nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para detalles.

## 🙏 Agradecimientos

- [TUS Santander](https://datos.santander.es/) por proporcionar las APIs públicas
- [Slack Bolt Framework](https://slack.dev/bolt-js/) por facilitar el desarrollo
- Comunidad de desarrolladores de Santander

---
