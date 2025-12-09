const NodeCache = require('node-cache');
const axios = require('axios');
const config = require('../config');

// Inicializar caché (TTL estándar de 60 segundos)
const cache = new NodeCache({ stdTTL: config.SETTINGS.CACHE_TTL_SECONDS });

class TusService {
    /**
     * Obtiene los horarios programados (con caché)
     */
    async getSchedule(stopId, routeId) {
        const cacheKey = `schedule_${stopId}_${routeId}`;
        const cachedData = cache.get(cacheKey);

        if (cachedData) {
            console.log(`📦 Sirviendo datos de caché para ${cacheKey}`);
            return cachedData;
        }

        try {
            console.log(`🌐 Llamando a API Programación para parada ${stopId}, línea ${routeId}`);
            const response = await axios.get(config.API.TUS_SCHEDULE);

            const stopIdStr = stopId.toString();
            const routeIdStr = routeId.toString();

            const schedules = response.data.resources.filter(item => {
                const itemLinea = item['ayto:linea']?.toString();
                const itemParada = item['ayto:idParada']?.toString();
                return itemLinea === routeIdStr && itemParada === stopIdStr;
            });

            if (schedules.length === 0) return null;

            const now = new Date();
            const currentTimeInSeconds = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds();

            const departures = schedules
                .map(schedule => {
                    const horaSegundos = parseInt(schedule['ayto:hora']);
                    const diffInSeconds = horaSegundos - currentTimeInSeconds;

                    return {
                        time: this._convertirHora(schedule['ayto:hora']),
                        timeInSeconds: horaSegundos,
                        destination: schedule['ayto:nombreParada'],
                        trip: schedule['ayto:numViaje'],
                        minutesFromNow: Math.round(diffInSeconds / 60),
                        isFuture: diffInSeconds > 0
                    };
                })
                .filter(departure => departure.isFuture)
                .sort((a, b) => a.timeInSeconds - b.timeInSeconds)
                .slice(0, 5);

            const result = {
                next_departures: departures,
                currentTime: `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`,
                noMoreToday: departures.length === 0
            };

            // Guardar en caché
            cache.set(cacheKey, result);
            return result;

        } catch (error) {
            console.error('❌ Error en getSchedule:', error.message);
            return null;
        }
    }

    /**
     * Obtiene estimaciones en tiempo real (con caché corta)
     */
    async getRealTimeEstimates(stopId, routeId) {
        // Cache más corta para tiempo real (10 segundos)
        const cacheKey = `realtime_${stopId}_${routeId}`;
        const cachedData = cache.get(cacheKey);

        if (cachedData) {
            console.log(`📦 Sirviendo datos de caché (RT) para ${cacheKey}`);
            return cachedData;
        }

        try {
            console.log(`🌐 Llamando a API Tiempo Real para parada ${stopId}, línea ${routeId}`);
            const response = await axios.get(config.API.TUS_ESTIMATES);

            const stopIdStr = stopId.toString();
            const routeIdStr = routeId.toString();

            const estimates = response.data.resources.filter(item => {
                const itemLinea = item['ayto:etiqLinea']?.toString();
                const itemParada = item['ayto:paradaId']?.toString();
                return itemLinea === routeIdStr && itemParada === stopIdStr;
            });

            if (estimates.length === 0) {
                return { buses: [], noBusesActive: true };
            }

            const now = new Date();
            const buses = [];

            estimates.forEach(estimate => {
                this._processEstimate(estimate, '1', buses);
                this._processEstimate(estimate, '2', buses);
            });

            buses.sort((a, b) => a.timeInSeconds - b.timeInSeconds);

            const result = {
                buses: buses.slice(0, 5),
                currentTime: `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`,
                noBusesActive: buses.length === 0,
                isRealTime: true
            };

            // Guardar en caché (solo 10s para tiempo real)
            cache.set(cacheKey, result, 10);
            return result;

        } catch (error) {
            console.error('❌ Error en getRealTimeEstimates:', error.message);
            return null;
        }
    }

    _processEstimate(estimate, suffix, busesArray) {
        const timeKey = `ayto:tiempo${suffix}`;
        const destKey = `ayto:destino${suffix}`;
        const distKey = `ayto:distancia${suffix}`;

        if (estimate[timeKey] && parseInt(estimate[timeKey]) > 0) {
            // Evitar duplicados si destino1 == destino2
            if (suffix === '2' && estimate['ayto:destino1'] === estimate['ayto:destino2']) return;

            const timeInSecondsOriginal = parseInt(estimate[timeKey]);
            const timeInSecondsAdjusted = Math.max(0, timeInSecondsOriginal - config.SETTINGS.REAL_TIME_ADJUSTMENT_SECONDS);

            if (timeInSecondsAdjusted > 0) {
                busesArray.push({
                    destination: estimate[destKey],
                    timeInSeconds: timeInSecondsAdjusted,
                    timeInMinutes: Math.round(timeInSecondsAdjusted / 60),
                    distanceInMeters: parseInt(estimate[distKey] || 0),
                    busId: estimate['dc:identifier']
                });
            }
        }
    }

    _convertirHora(horaString) {
        const totalSegundos = parseInt(horaString);
        const horas = Math.floor(totalSegundos / 3600);
        const minutos = Math.floor((totalSegundos % 3600) / 60);
        return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
    }
}

module.exports = new TusService();
