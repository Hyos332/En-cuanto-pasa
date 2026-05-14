module.exports = {
    API: {
        TUS_SCHEDULE: 'http://datos.santander.es/api/rest/datasets/programacionTUS_horariosLineas.json',
        TUS_ESTIMATES: 'https://datos.santander.es/api/rest/datasets/control_flotas_estimaciones.json'
    },
    SETTINGS: {
        REAL_TIME_ADJUSTMENT_SECONDS: 180, // Restar 3 minutos
        CACHE_TTL_SECONDS: 60, // Tiempo de vida de la caché
        DEFAULT_ROUTE: '1'
    }
};
