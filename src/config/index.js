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

function readNumber(name, fallback, options = {}) {
    const rawValue = process.env[name];
    const parsedValue = Number.parseFloat(rawValue);
    const value = Number.isFinite(parsedValue) ? parsedValue : fallback;

    if (Number.isFinite(options.min)) {
        return Math.max(options.min, value);
    }

    return value;
}

function readBoolean(name, fallback = false) {
    const value = readString(name).toLowerCase();

    if (!value) return fallback;
    if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;

    return fallback;
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
    SERVER_MONITOR: {
        ENABLED: readBoolean('SERVER_MONITOR_ENABLED', false),
        HOST: readString('SERVER_MONITOR_HOST', '172.22.9.2'),
        PORT: readInteger('SERVER_MONITOR_PORT', 22, { min: 1 }),
        USERNAME: readString('SERVER_MONITOR_USERNAME'),
        PASSWORD: readString('SERVER_MONITOR_PASSWORD'),
        PRIVATE_KEY: readString('SERVER_MONITOR_PRIVATE_KEY'),
        PRIVATE_KEY_PATH: readString('SERVER_MONITOR_PRIVATE_KEY_PATH'),
        PASSPHRASE: readString('SERVER_MONITOR_PASSPHRASE'),
        READY_TIMEOUT_MS: readInteger('SERVER_MONITOR_READY_TIMEOUT_MS', 10000, { min: 1000 }),
        COMMAND_TIMEOUT_MS: readInteger('SERVER_MONITOR_COMMAND_TIMEOUT_MS', 12000, { min: 3000 }),
        POLL_INTERVAL_MS: readInteger('SERVER_MONITOR_POLL_INTERVAL_MS', 300000, { min: 30000 }),
        ALERT_COOLDOWN_MS: readInteger('SERVER_MONITOR_ALERT_COOLDOWN_MS', 1800000, { min: 60000 }),
        ALERT_CHANNEL_ID: readString('SERVER_MONITOR_ALERT_CHANNEL_ID'),
        DISK_PATHS: readString('SERVER_MONITOR_DISK_PATHS', '/'),
        ALLOWED_USERNAMES: readString('SERVER_MONITOR_ALLOWED_USERNAMES'),
        ALLOWED_USER_IDS: readString('SERVER_MONITOR_ALLOWED_USER_IDS'),
        CPU_WARN_PERCENT: readNumber('SERVER_MONITOR_CPU_WARN_PERCENT', 85, { min: 1 }),
        CPU_CRITICAL_PERCENT: readNumber('SERVER_MONITOR_CPU_CRITICAL_PERCENT', 95, { min: 1 }),
        MEMORY_WARN_PERCENT: readNumber('SERVER_MONITOR_MEMORY_WARN_PERCENT', 85, { min: 1 }),
        MEMORY_CRITICAL_PERCENT: readNumber('SERVER_MONITOR_MEMORY_CRITICAL_PERCENT', 95, { min: 1 }),
        SWAP_WARN_PERCENT: readNumber('SERVER_MONITOR_SWAP_WARN_PERCENT', 50, { min: 1 }),
        SWAP_CRITICAL_PERCENT: readNumber('SERVER_MONITOR_SWAP_CRITICAL_PERCENT', 80, { min: 1 }),
        DISK_WARN_PERCENT: readNumber('SERVER_MONITOR_DISK_WARN_PERCENT', 85, { min: 1 }),
        DISK_CRITICAL_PERCENT: readNumber('SERVER_MONITOR_DISK_CRITICAL_PERCENT', 95, { min: 1 }),
        LOAD_WARN_PER_CORE: readNumber('SERVER_MONITOR_LOAD_WARN_PER_CORE', 1.5, { min: 0.1 }),
        LOAD_CRITICAL_PER_CORE: readNumber('SERVER_MONITOR_LOAD_CRITICAL_PER_CORE', 2.5, { min: 0.1 }),
        PROCESS_MEMORY_WARN_PERCENT: readNumber('SERVER_MONITOR_PROCESS_MEMORY_WARN_PERCENT', 50, { min: 1 }),
        PROCESS_CPU_WARN_PERCENT: readNumber('SERVER_MONITOR_PROCESS_CPU_WARN_PERCENT', 90, { min: 1 })
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
