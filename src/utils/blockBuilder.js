function buildScheduleBlocks(schedule, stopId, routeId) {
    if (schedule.noMoreToday) {
        return [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "⏰ *No hay más horarios para hoy.* Consulta mañana."
                }
            }
        ];
    }

    const blocks = [
        {
            type: "header",
            text: {
                type: "plain_text",
                text: `📅 Horarios Programados - Parada ${stopId} (Línea ${routeId})`,
                emoji: true
            }
        },
        {
            type: "context",
            elements: [
                {
                    type: "mrkdwn",
                    text: `🕒 Hora actual: ${schedule.currentTime}`
                }
            ]
        },
        {
            type: "divider"
        }
    ];

    schedule.next_departures.forEach(dep => {
        const minutesText = dep.minutesFromNow === 1 ? 'minuto' : 'minutos';
        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*${dep.time}* (en ${dep.minutesFromNow} ${minutesText})\n🚍 Destino: ${dep.destination}`
            }
        });
    });

    blocks.push(
        {
            type: "divider"
        },
        {
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "🔄 Actualizar",
                        emoji: true
                    },
                    value: JSON.stringify({ action: 'refresh_schedule', stopId, routeId }),
                    action_id: "refresh_schedule_btn"
                }
            ]
        }
    );

    return blocks;
}

function buildRealTimeBlocks(estimates, stopId, routeId) {
    if (estimates.noBusesActive) {
        return [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "🚌 *No hay buses activos en este momento* para esta parada y línea."
                }
            },
            {
                type: "context",
                elements: [
                    {
                        type: "mrkdwn",
                        text: "⏰ Consulta en tiempo real de TUS Santander"
                    }
                ]
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: "🔄 Reintentar",
                            emoji: true
                        },
                        value: JSON.stringify({ action: 'refresh_realtime', stopId, routeId }),
                        action_id: "refresh_realtime_btn"
                    }
                ]
            }
        ];
    }

    const blocks = [
        {
            type: "header",
            text: {
                type: "plain_text",
                text: `🔴 Tiempo Real - Parada ${stopId} (Línea ${routeId})`,
                emoji: true
            }
        },
        {
            type: "context",
            elements: [
                {
                    type: "mrkdwn",
                    text: `🕒 Hora actual: ${estimates.currentTime} | ⚠️ Ajuste: -3 min`
                }
            ]
        },
        {
            type: "divider"
        }
    ];

    estimates.buses.forEach(bus => {
        let icon = "🕒";
        let statusText = `**${bus.timeInMinutes} min**`;

        if (bus.timeInMinutes < 1) {
            icon = "🚨";
            statusText = "*LLEGANDO AHORA*";
        } else if (bus.timeInMinutes === 1) {
            icon = "⚠️";
            statusText = "*1 MINUTO*";
        }

        const distanceKm = (bus.distanceInMeters / 1000).toFixed(1);

        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `${icon} ${statusText} 🚍 → *${bus.destination}*\n   📍 Distancia: ${distanceKm} km | 🆔 Bus ID: \`${bus.busId}\``
            }
        });
    });

    blocks.push(
        {
            type: "divider"
        },
        {
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "🔄 Actualizar Tiempo Real",
                        emoji: true
                    },
                    style: "primary",
                    value: JSON.stringify({ action: 'refresh_realtime', stopId, routeId }),
                    action_id: "refresh_realtime_btn"
                }
            ]
        }
    );

    return blocks;
}

module.exports = { buildScheduleBlocks, buildRealTimeBlocks };
