function readString(name, fallback = '') {
    const value = process.env[name];
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readInteger(name, fallback, options = {}) {
    const rawValue = process.env[name];
    const parsedValue = Number.parseInt(rawValue, 10);
    const value = Number.isFinite(parsedValue) ? parsedValue : fallback;

    if (Number.isFinite(options.min)) {
        return Math.max(options.min, value);
    }

    return value;
}

const config = {
    APP: {
        PORT: readInteger('PORT', 3000, { min: 1 }),
        PUBLIC_BASE_URL: readString('PUBLIC_BASE_URL', 'https://en-cuanto-pasa.ctdesarrollo-sdr.org')
    },
    SLACK: {
        BOT_TOKEN: readString('SLACK_BOT_TOKEN'),
        SIGNING_SECRET: readString('SLACK_SIGNING_SECRET')
    },
    KRONOS: {
        CREDENTIALS_SECRET: readString('KRONOS_CREDENTIALS_SECRET'),
        MAX_CONCURRENCY: readInteger('KRONOS_MAX_CONCURRENCY', 1, { min: 1 }),
        NAVIGATION_TIMEOUT_MS: readInteger('KRONOS_NAVIGATION_TIMEOUT_MS', 45000, { min: 5000 }),
        PUPPETEER_EXECUTABLE_PATH: readString('PUPPETEER_EXECUTABLE_PATH', '/usr/bin/chromium-browser')
    },
    SEMANAL: {
        ALLOWED_USERNAMES: readString('SEMANAL_ALLOWED_USERNAMES', 'diego.moys'),
        ALLOWED_USER_IDS: readString('SEMANAL_ALLOWED_USER_IDS'),
        WEEKLY_TARGETS: readString('SEMANAL_WEEKLY_TARGETS')
    },
    GOOGLE_SHEETS: {
        ENABLED: readString('SEMANAL_GSHEETS_ENABLED').toLowerCase(),
        SPREADSHEET_ID: readString('SEMANAL_GSHEETS_SPREADSHEET_ID'),
        SHEET_NAME: readString('SEMANAL_GSHEETS_SHEET_NAME', 'Horas Extra Bot'),
        CREDENTIALS_BASE64: readString('SEMANAL_GSHEETS_CREDENTIALS_BASE64'),
        CREDENTIALS_JSON: readString('SEMANAL_GSHEETS_CREDENTIALS_JSON')
    },
    API: {
        TUS_SCHEDULE: 'http://datos.santander.es/api/rest/datasets/programacionTUS_horariosLineas.json',
        TUS_ESTIMATES: 'https://datos.santander.es/api/rest/datasets/control_flotas_estimaciones.json'
    },
    SETTINGS: {
        REAL_TIME_ADJUSTMENT_SECONDS: 180,
        CACHE_TTL_SECONDS: 60,
        DEFAULT_ROUTE: '1',
        TUS_REQUEST_TIMEOUT_MS: readInteger('TUS_REQUEST_TIMEOUT_MS', 8000, { min: 1000 })
    }
};

function requireRuntimeConfig() {
    const missing = [];

    if (!config.SLACK.BOT_TOKEN) missing.push('SLACK_BOT_TOKEN');
    if (!config.SLACK.SIGNING_SECRET) missing.push('SLACK_SIGNING_SECRET');
    if (!config.KRONOS.CREDENTIALS_SECRET || config.KRONOS.CREDENTIALS_SECRET.length < 16) {
        missing.push('KRONOS_CREDENTIALS_SECRET');
    }
    if (!config.APP.PUBLIC_BASE_URL) missing.push('PUBLIC_BASE_URL');

    if (missing.length > 0) {
        throw new Error(`Faltan variables de entorno requeridas: ${missing.join(', ')}`);
    }
}

module.exports = {
    ...config,
    requireRuntimeConfig
};
