const { formatRealTimeSchedule } = require('../../../src/bot/utils/tusRealTime');

describe('tusRealTime utils', () => {
  test('should format real time schedule correctly', () => {
    const mockSchedule = {
      buses: [
        {
          destination: 'Hospital',
          timeInMinutes: 2,
          distanceInMeters: 150,
          busId: '1234'
        }
      ],
      currentTime: '14:25'
    };

    const result = formatRealTimeSchedule(mockSchedule);
    expect(result).toContain('Hospital');
    expect(result).toContain('2 minutos');
    expect(result).toContain('1234');
  });

  test('should handle no buses available', () => {
    const mockSchedule = { noBusesActive: true };
    const result = formatRealTimeSchedule(mockSchedule);
    expect(result).toContain('No hay buses activos');
  });
});