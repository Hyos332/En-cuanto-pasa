const {
    analyzeMetrics,
    formatServerStatusText,
    parseRemoteOutput
} = require('../../src/services/serverMonitorService');

const thresholds = {
    CPU_WARN_PERCENT: 85,
    CPU_CRITICAL_PERCENT: 95,
    MEMORY_WARN_PERCENT: 85,
    MEMORY_CRITICAL_PERCENT: 95,
    SWAP_WARN_PERCENT: 50,
    SWAP_CRITICAL_PERCENT: 80,
    DISK_WARN_PERCENT: 85,
    DISK_CRITICAL_PERCENT: 95,
    LOAD_WARN_PER_CORE: 1.5,
    LOAD_CRITICAL_PER_CORE: 2.5,
    PROCESS_MEMORY_WARN_PERCENT: 50,
    PROCESS_CPU_WARN_PERCENT: 90
};

function sampleOutput(overrides = {}) {
    return `
__SERVER_MONITOR__
remote_timestamp=2026-07-09T10:00:00+00:00
hostname=${overrides.hostname || 'srv-test'}
kernel=Linux 6.1 x86_64 GNU/Linux
uptime_seconds=90061
load1=${overrides.load1 || '2.00'}
load5=1.20
load15=0.80
cpu_cores=2
cpu_usage_percent=${overrides.cpu || '41.5'}
mem_total_kb=1000000
mem_available_kb=${overrides.memAvailable || '350000'}
swap_total_kb=500000
swap_free_kb=${overrides.swapFree || '450000'}
process_total=120
process_zombies=${overrides.zombies || '0'}
__DISKS__
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/sda1 1000000 ${overrides.diskUsed || '450000'} 550000 ${overrides.diskPercent || '45'}% /
__TOP_MEM__
123 1 node 12.5 ${overrides.topMem || '14.0'} 204800
456 1 postgres 8.0 10.0 102400
__TOP_CPU__
789 1 chromium 35.5 8.0 153600
123 1 node ${overrides.topCpu || '12.5'} 14.0 204800
__END__
`;
}

describe('serverMonitorService', () => {
    test('parsea metricas remotas del servidor', () => {
        const metrics = parseRemoteOutput(sampleOutput());

        expect(metrics.connection.ok).toBe(true);
        expect(metrics.system.hostname).toBe('srv-test');
        expect(metrics.system.uptimeText).toBe('1d 1h 1m');
        expect(metrics.cpu.usagePercent).toBe(41.5);
        expect(metrics.cpu.loadPerCore).toBe(1);
        expect(metrics.memory.usedPercent).toBe(65);
        expect(metrics.swap.usedPercent).toBe(10);
        expect(metrics.disks[0]).toMatchObject({
            mount: '/',
            usedPercent: 45
        });
        expect(metrics.processes.topMemory[0]).toMatchObject({
            pid: 123,
            command: 'node',
            memoryPercent: 14
        });
    });

    test('marca critico cuando RAM o disco pasan umbrales criticos', () => {
        const metrics = parseRemoteOutput(sampleOutput({
            memAvailable: '30000',
            diskUsed: '980000',
            diskPercent: '98'
        }));
        const report = analyzeMetrics(metrics, thresholds);

        expect(report.severity).toBe('critical');
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ level: 'critical', label: 'RAM' }),
            expect.objectContaining({ level: 'critical', label: 'Disco' })
        ]));
    });

    test('marca warning para procesos sospechosos y lo muestra en Slack', () => {
        const metrics = parseRemoteOutput(sampleOutput({
            topMem: '55.2',
            topCpu: '93.5',
            zombies: '2'
        }));
        const report = analyzeMetrics({
            ...metrics,
            target: {
                host: '172.22.9.2'
            }
        }, thresholds);
        const text = formatServerStatusText(report);

        expect(report.severity).toBe('warning');
        expect(text).toContain('Servidor WARNING');
        expect(text).toContain('node usa 55.2% de RAM');
        expect(text).toContain('2 procesos zombie');
        expect(text).toContain('*Top RAM:*');
        expect(text).toContain('*Top CPU:*');
    });
});
