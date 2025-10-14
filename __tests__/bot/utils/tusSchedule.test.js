const { formatSchedule } = require('../../../src/bot/utils/tusSchedule');

describe('tusSchedule utils', () => {
  test('should format schedule correctly', () => {
    const mockSchedule = {
      next_departures: [
        {
          time: '14:30',
          minutesFromNow: 5,
          destination: 'Centro'
        }
      ],
      currentTime: '14:25'
    };

    const result = formatSchedule(mockSchedule);
    expect(result).toContain('14:30');
    expect(result).toContain('Centro');
  });

  test('should handle no more buses today', () => {
    const mockSchedule = { noMoreToday: true };
    const result = formatSchedule(mockSchedule);
    expect(result).toContain('No hay más horarios para hoy');
  });
});