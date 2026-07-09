const fs = require('fs').promises;
const { Client } = require('ssh2');
const config = require('../config');

const LEVEL_WEIGHT = {
    ok: 0,
    warning: 1,
    critical: 2
};

function parseList(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, '\'\\\'\'')}'`;
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPercent(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

function bytesFromKb(value) {
    return Math.max(0, Math.round(toNumber(value) * 1024));
}

function formatPercent(value) {
    return `${clampPercent(value).toFixed(1)}%`;
}

function formatBytes(bytes) {
    const safeBytes = Math.max(0, toNumber(bytes));
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = safeBytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    if (unitIndex === 0) {
        return `${value.toFixed(0)} ${units[unitIndex]}`;
    }

    return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatUptime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(toNumber(seconds)));
    const days = Math.floor(safeSeconds / 86400);
    const hours = Math.floor((safeSeconds % 86400) / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || parts.length > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);

    return parts.join(' ');
}

function buildRemoteCommand(diskPathsValue = '/') {
    const diskPaths = parseList(diskPathsValue);
    const diskArgs = (diskPaths.length ? diskPaths : ['/']).map(shellQuote).join(' ');

    return `
set -u
echo "__SERVER_MONITOR__"
echo "remote_timestamp=$(date -Iseconds 2>/dev/null || date)"
echo "hostname=$(hostname 2>/dev/null || uname -n 2>/dev/null || echo unknown)"
echo "kernel=$(uname -srmo 2>/dev/null || uname -a 2>/dev/null || echo unknown)"
echo "uptime_seconds=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)"
if [ -r /proc/loadavg ]; then
  set -- $(cat /proc/loadavg)
  echo "load1=$1"
  echo "load5=$2"
  echo "load15=$3"
else
  echo "load1=0"
  echo "load5=0"
  echo "load15=0"
fi
echo "cpu_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)"
read_cpu() {
  awk '/^cpu / {
    idle=$5
    total=0
    for (i=2; i<=NF; i++) total += $i
    print total, idle
  }' /proc/stat 2>/dev/null
}
set -- $(read_cpu)
cpu_total_a=\${1:-0}
cpu_idle_a=\${2:-0}
sleep 0.35
set -- $(read_cpu)
cpu_total_b=\${1:-0}
cpu_idle_b=\${2:-0}
awk -v total_a="$cpu_total_a" -v idle_a="$cpu_idle_a" -v total_b="$cpu_total_b" -v idle_b="$cpu_idle_b" 'BEGIN {
  delta_total = total_b - total_a
  delta_idle = idle_b - idle_a
  if (delta_total <= 0) {
    print "cpu_usage_percent=0"
  } else {
    printf "cpu_usage_percent=%.1f\\n", ((delta_total - delta_idle) / delta_total) * 100
  }
}'
awk '
  /^MemTotal:/ { mem_total=$2 }
  /^MemAvailable:/ { mem_available=$2 }
  /^SwapTotal:/ { swap_total=$2 }
  /^SwapFree:/ { swap_free=$2 }
  END {
    printf "mem_total_kb=%s\\n", mem_total + 0
    printf "mem_available_kb=%s\\n", mem_available + 0
    printf "swap_total_kb=%s\\n", swap_total + 0
    printf "swap_free_kb=%s\\n", swap_free + 0
  }
' /proc/meminfo 2>/dev/null
ps -eo stat= 2>/dev/null | awk '
  BEGIN { total=0; zombies=0 }
  { total++; if ($1 ~ /^Z/) zombies++ }
  END {
    printf "process_total=%s\\n", total + 0
    printf "process_zombies=%s\\n", zombies + 0
  }
'
echo "__DISKS__"
df -P -k ${diskArgs} 2>/dev/null | awk 'NR == 1 || !seen[$6]++'
echo "__TOP_MEM__"
ps -eo pid=,ppid=,comm=,%cpu=,%mem=,rss= --sort=-%mem 2>/dev/null | head -n 8 || true
echo "__TOP_CPU__"
ps -eo pid=,ppid=,comm=,%cpu=,%mem=,rss= --sort=-%cpu 2>/dev/null | head -n 8 || true
echo "__END__"
`;
}

function parseKeyValue(line) {
    const index = line.indexOf('=');
    if (index === -1) return null;

    return {
        key: line.slice(0, index).trim(),
        value: line.slice(index + 1).trim()
    };
}

function parseDiskLine(line) {
    const match = line.trim().match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
    if (!match) return null;

    return {
        filesystem: match[1],
        sizeBytes: bytesFromKb(match[2]),
        usedBytes: bytesFromKb(match[3]),
        availableBytes: bytesFromKb(match[4]),
        usedPercent: toNumber(match[5]),
        mount: match[6]
    };
}

function parseProcessLine(line) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)$/);
    if (!match) return null;

    return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
        cpuPercent: toNumber(match[4]),
        memoryPercent: toNumber(match[5]),
        rssBytes: bytesFromKb(match[6])
    };
}

function parseRemoteOutput(output) {
    const values = {};
    const disks = [];
    const topMemory = [];
    const topCpu = [];
    let section = 'values';

    String(output || '').split(/\r?\n/).forEach(rawLine => {
        const line = rawLine.trim();
        if (!line) return;

        if (line === '__SERVER_MONITOR__') {
            section = 'values';
            return;
        }

        if (line === '__DISKS__') {
            section = 'disks';
            return;
        }

        if (line === '__TOP_MEM__') {
            section = 'topMemory';
            return;
        }

        if (line === '__TOP_CPU__') {
            section = 'topCpu';
            return;
        }

        if (line === '__END__') {
            section = 'done';
            return;
        }

        if (section === 'values') {
            const entry = parseKeyValue(line);
            if (entry) values[entry.key] = entry.value;
            return;
        }

        if (section === 'disks') {
            if (/^Filesystem\s+/i.test(line)) return;
            const disk = parseDiskLine(line);
            if (disk) disks.push(disk);
            return;
        }

        if (section === 'topMemory') {
            const process = parseProcessLine(line);
            if (process) topMemory.push(process);
            return;
        }

        if (section === 'topCpu') {
            const process = parseProcessLine(line);
            if (process) topCpu.push(process);
        }
    });

    const memTotalBytes = bytesFromKb(values.mem_total_kb);
    const memAvailableBytes = bytesFromKb(values.mem_available_kb);
    const memUsedBytes = Math.max(0, memTotalBytes - memAvailableBytes);
    const swapTotalBytes = bytesFromKb(values.swap_total_kb);
    const swapFreeBytes = bytesFromKb(values.swap_free_kb);
    const swapUsedBytes = Math.max(0, swapTotalBytes - swapFreeBytes);
    const cpuCores = Math.max(1, toNumber(values.cpu_cores, 1));
    const load1 = toNumber(values.load1);

    return {
        collectedAt: new Date().toISOString(),
        connection: {
            ok: true
        },
        system: {
            hostname: values.hostname || 'unknown',
            kernel: values.kernel || 'unknown',
            remoteTimestamp: values.remote_timestamp || null,
            uptimeSeconds: toNumber(values.uptime_seconds),
            uptimeText: formatUptime(values.uptime_seconds)
        },
        cpu: {
            usagePercent: clampPercent(toNumber(values.cpu_usage_percent)),
            cores: cpuCores,
            load1,
            load5: toNumber(values.load5),
            load15: toNumber(values.load15),
            loadPerCore: load1 / cpuCores
        },
        memory: {
            totalBytes: memTotalBytes,
            availableBytes: memAvailableBytes,
            usedBytes: memUsedBytes,
            usedPercent: memTotalBytes > 0 ? clampPercent((memUsedBytes / memTotalBytes) * 100) : 0
        },
        swap: {
            totalBytes: swapTotalBytes,
            freeBytes: swapFreeBytes,
            usedBytes: swapUsedBytes,
            usedPercent: swapTotalBytes > 0 ? clampPercent((swapUsedBytes / swapTotalBytes) * 100) : 0
        },
        disks,
        processes: {
            total: Math.max(0, toNumber(values.process_total)),
            zombies: Math.max(0, toNumber(values.process_zombies)),
            topMemory,
            topCpu
        }
    };
}

function addCheck(checks, level, label, message) {
    checks.push({ level, label, message });
}

function highestSeverity(checks) {
    return checks.reduce((highest, check) => (
        LEVEL_WEIGHT[check.level] > LEVEL_WEIGHT[highest] ? check.level : highest
    ), 'ok');
}

function analyzeMetrics(metrics, thresholds = config.SERVER_MONITOR) {
    const checks = [];

    if (!metrics.connection?.ok) {
        addCheck(checks, 'critical', 'SSH', metrics.connection?.error || 'No se pudo conectar por SSH.');
    } else {
        addCheck(checks, 'ok', 'SSH', 'Conexión SSH correcta.');
    }

    if (metrics.cpu) {
        if (metrics.cpu.usagePercent >= thresholds.CPU_CRITICAL_PERCENT) {
            addCheck(checks, 'critical', 'CPU', `CPU al ${formatPercent(metrics.cpu.usagePercent)}.`);
        } else if (metrics.cpu.usagePercent >= thresholds.CPU_WARN_PERCENT) {
            addCheck(checks, 'warning', 'CPU', `CPU alta: ${formatPercent(metrics.cpu.usagePercent)}.`);
        } else {
            addCheck(checks, 'ok', 'CPU', `CPU estable: ${formatPercent(metrics.cpu.usagePercent)}.`);
        }

        if (metrics.cpu.loadPerCore >= thresholds.LOAD_CRITICAL_PER_CORE) {
            addCheck(checks, 'critical', 'Load', `Load por core en ${metrics.cpu.loadPerCore.toFixed(2)}.`);
        } else if (metrics.cpu.loadPerCore >= thresholds.LOAD_WARN_PER_CORE) {
            addCheck(checks, 'warning', 'Load', `Load por core alto: ${metrics.cpu.loadPerCore.toFixed(2)}.`);
        } else {
            addCheck(checks, 'ok', 'Load', `Load por core normal: ${metrics.cpu.loadPerCore.toFixed(2)}.`);
        }
    }

    if (metrics.memory) {
        if (metrics.memory.usedPercent >= thresholds.MEMORY_CRITICAL_PERCENT) {
            addCheck(checks, 'critical', 'RAM', `RAM al ${formatPercent(metrics.memory.usedPercent)}.`);
        } else if (metrics.memory.usedPercent >= thresholds.MEMORY_WARN_PERCENT) {
            addCheck(checks, 'warning', 'RAM', `RAM alta: ${formatPercent(metrics.memory.usedPercent)}.`);
        } else {
            addCheck(checks, 'ok', 'RAM', `RAM estable: ${formatPercent(metrics.memory.usedPercent)}.`);
        }
    }

    if (metrics.swap?.totalBytes > 0) {
        if (metrics.swap.usedPercent >= thresholds.SWAP_CRITICAL_PERCENT) {
            addCheck(checks, 'critical', 'Swap', `Swap al ${formatPercent(metrics.swap.usedPercent)}.`);
        } else if (metrics.swap.usedPercent >= thresholds.SWAP_WARN_PERCENT) {
            addCheck(checks, 'warning', 'Swap', `Swap alta: ${formatPercent(metrics.swap.usedPercent)}.`);
        } else {
            addCheck(checks, 'ok', 'Swap', `Swap normal: ${formatPercent(metrics.swap.usedPercent)}.`);
        }
    }

    const worstDisk = [...(metrics.disks || [])].sort((a, b) => b.usedPercent - a.usedPercent)[0];
    if (worstDisk) {
        if (worstDisk.usedPercent >= thresholds.DISK_CRITICAL_PERCENT) {
            addCheck(checks, 'critical', 'Disco', `${worstDisk.mount} al ${formatPercent(worstDisk.usedPercent)}.`);
        } else if (worstDisk.usedPercent >= thresholds.DISK_WARN_PERCENT) {
            addCheck(checks, 'warning', 'Disco', `${worstDisk.mount} alto: ${formatPercent(worstDisk.usedPercent)}.`);
        } else {
            addCheck(checks, 'ok', 'Disco', `${worstDisk.mount} estable: ${formatPercent(worstDisk.usedPercent)}.`);
        }
    }

    const zombies = metrics.processes?.zombies || 0;
    if (zombies > 0) {
        addCheck(checks, 'warning', 'Procesos', `${zombies} procesos zombie detectados.`);
    } else if (metrics.processes) {
        addCheck(checks, 'ok', 'Procesos', `${metrics.processes.total} procesos, sin zombies.`);
    }

    const topMemory = metrics.processes?.topMemory?.[0];
    if (topMemory && topMemory.memoryPercent >= thresholds.PROCESS_MEMORY_WARN_PERCENT) {
        addCheck(
            checks,
            'warning',
            'Proceso RAM',
            `${topMemory.command} usa ${formatPercent(topMemory.memoryPercent)} de RAM.`
        );
    }

    const topCpu = metrics.processes?.topCpu?.[0];
    if (topCpu && topCpu.cpuPercent >= thresholds.PROCESS_CPU_WARN_PERCENT) {
        addCheck(
            checks,
            'warning',
            'Proceso CPU',
            `${topCpu.command} usa ${formatPercent(topCpu.cpuPercent)} de CPU.`
        );
    }

    const severity = highestSeverity(checks);

    return {
        ...metrics,
        severity,
        checks,
        summary: checks
            .filter(check => check.level === severity)
            .map(check => check.message)
            .join(' ')
    };
}

function buildFailureReport(error, monitorConfig = config.SERVER_MONITOR) {
    const message = error?.message || String(error || 'Error desconocido conectando al servidor.');

    return analyzeMetrics({
        collectedAt: new Date().toISOString(),
        target: {
            host: monitorConfig.HOST,
            port: monitorConfig.PORT,
            username: monitorConfig.USERNAME || null
        },
        connection: {
            ok: false,
            error: message
        },
        system: {
            hostname: monitorConfig.HOST || 'unknown',
            kernel: 'unknown',
            remoteTimestamp: null,
            uptimeSeconds: 0,
            uptimeText: '0m'
        },
        disks: [],
        processes: {
            total: 0,
            zombies: 0,
            topMemory: [],
            topCpu: []
        }
    }, monitorConfig);
}

function getMissingSshConfig(monitorConfig = config.SERVER_MONITOR) {
    const missing = [];

    if (!monitorConfig.HOST) missing.push('SERVER_MONITOR_HOST');
    if (!monitorConfig.USERNAME) missing.push('SERVER_MONITOR_USERNAME');
    if (!monitorConfig.PASSWORD && !monitorConfig.PRIVATE_KEY && !monitorConfig.PRIVATE_KEY_PATH) {
        missing.push('SERVER_MONITOR_PASSWORD o SERVER_MONITOR_PRIVATE_KEY');
    }

    return missing;
}

async function getPrivateKey(monitorConfig) {
    if (monitorConfig.PRIVATE_KEY) {
        return monitorConfig.PRIVATE_KEY.replace(/\\n/g, '\n');
    }

    if (monitorConfig.PRIVATE_KEY_PATH) {
        return fs.readFile(monitorConfig.PRIVATE_KEY_PATH, 'utf8');
    }

    return null;
}

async function buildSshConnectionConfig(monitorConfig) {
    const connectionConfig = {
        host: monitorConfig.HOST,
        port: monitorConfig.PORT,
        username: monitorConfig.USERNAME,
        readyTimeout: monitorConfig.READY_TIMEOUT_MS,
        keepaliveInterval: 10000
    };

    const privateKey = await getPrivateKey(monitorConfig);
    if (privateKey) {
        connectionConfig.privateKey = privateKey;
        if (monitorConfig.PASSPHRASE) {
            connectionConfig.passphrase = monitorConfig.PASSPHRASE;
        }
    } else {
        connectionConfig.password = monitorConfig.PASSWORD;
    }

    return connectionConfig;
}

async function runRemoteCommand(command, monitorConfig = config.SERVER_MONITOR) {
    const connectionConfig = await buildSshConnectionConfig(monitorConfig);

    return new Promise((resolve, reject) => {
        const conn = new Client();
        let stdout = '';
        let stderr = '';
        let finished = false;
        let timeout = null;

        function settle(error, result) {
            if (finished) return;
            finished = true;
            if (timeout) clearTimeout(timeout);
            conn.end();

            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        }

        timeout = setTimeout(() => {
            settle(new Error(`Timeout ejecutando monitoreo tras ${monitorConfig.COMMAND_TIMEOUT_MS} ms.`));
        }, monitorConfig.COMMAND_TIMEOUT_MS);

        conn.on('ready', () => {
            conn.exec(command, (error, stream) => {
                if (error) {
                    settle(error);
                    return;
                }

                stream.on('close', (code) => {
                    if (code && code !== 0) {
                        settle(new Error(`Comando remoto terminó con código ${code}: ${stderr.trim() || 'sin stderr'}`));
                        return;
                    }

                    settle(null, stdout);
                });

                stream.on('data', data => {
                    stdout += data.toString('utf8');
                });

                stream.stderr.on('data', data => {
                    stderr += data.toString('utf8');
                });
            });
        });

        conn.on('error', error => {
            settle(error);
        });

        conn.connect(connectionConfig);
    });
}

async function collectServerMetrics(options = {}) {
    const monitorConfig = options.monitorConfig || config.SERVER_MONITOR;
    const missing = getMissingSshConfig(monitorConfig);

    if (missing.length > 0) {
        return buildFailureReport(new Error(`Faltan variables de entorno: ${missing.join(', ')}.`), monitorConfig);
    }

    try {
        const output = await runRemoteCommand(buildRemoteCommand(monitorConfig.DISK_PATHS), monitorConfig);
        const metrics = parseRemoteOutput(output);

        return analyzeMetrics({
            ...metrics,
            target: {
                host: monitorConfig.HOST,
                port: monitorConfig.PORT,
                username: monitorConfig.USERNAME || null
            }
        }, monitorConfig);
    } catch (error) {
        return buildFailureReport(error, monitorConfig);
    }
}

function iconForLevel(level) {
    if (level === 'critical') return '🚨';
    if (level === 'warning') return '⚠️';
    return '✅';
}

function titleForSeverity(severity) {
    if (severity === 'critical') return 'CRÍTICO';
    if (severity === 'warning') return 'WARNING';
    return 'OK';
}

function formatProcess(process) {
    return `• \`${process.pid}\` ${process.command}: CPU ${formatPercent(process.cpuPercent)} | RAM ${formatPercent(process.memoryPercent)} | RSS ${formatBytes(process.rssBytes)}`;
}

function formatServerStatusText(report, options = {}) {
    const maxProcesses = options.maxProcesses || 5;
    const checks = report.checks || [];
    const problemChecks = checks.filter(check => check.level !== 'ok');
    const visibleChecks = problemChecks.length > 0 ? problemChecks : checks.slice(0, 4);
    const diskLines = (report.disks || []).slice(0, 4).map(disk => (
        `• ${disk.mount}: ${formatPercent(disk.usedPercent)} usado (${formatBytes(disk.availableBytes)} libres)`
    ));
    const topMemoryLines = (report.processes?.topMemory || []).slice(0, maxProcesses).map(formatProcess);
    const topCpuLines = (report.processes?.topCpu || []).slice(0, maxProcesses).map(formatProcess);

    const lines = [
        `${iconForLevel(report.severity)} *Servidor ${titleForSeverity(report.severity)}* \`${report.target?.host || report.system?.hostname || 'unknown'}\``
    ];

    if (!report.connection?.ok) {
        lines.push('', `🚨 ${report.connection?.error || 'No se pudo conectar por SSH.'}`);
        return lines.join('\n');
    }

    lines.push(
        `Host: *${report.system?.hostname || 'unknown'}* | Uptime: \`${report.system?.uptimeText || 'N/D'}\``,
        `CPU: \`${formatPercent(report.cpu?.usagePercent || 0)}\` | Load/core: \`${(report.cpu?.loadPerCore || 0).toFixed(2)}\` | RAM: \`${formatPercent(report.memory?.usedPercent || 0)}\``,
        `Swap: \`${report.swap?.totalBytes > 0 ? formatPercent(report.swap.usedPercent) : 'sin swap'}\` | Procesos: \`${report.processes?.total || 0}\` | Zombies: \`${report.processes?.zombies || 0}\``
    );

    if (visibleChecks.length > 0) {
        lines.push('', '*Chequeos:*');
        visibleChecks.forEach(check => {
            lines.push(`${iconForLevel(check.level)} *${check.label}:* ${check.message}`);
        });
    }

    if (diskLines.length > 0) {
        lines.push('', '*Discos:*', ...diskLines);
    }

    if (topMemoryLines.length > 0) {
        lines.push('', '*Top RAM:*', ...topMemoryLines);
    }

    if (topCpuLines.length > 0) {
        lines.push('', '*Top CPU:*', ...topCpuLines);
    }

    lines.push('', `_Muestra tomada: ${report.collectedAt}_`);

    return lines.join('\n');
}

function buildAlertFingerprint(report) {
    return (report.checks || [])
        .filter(check => check.level !== 'ok')
        .map(check => `${check.level}:${check.label}:${check.message}`)
        .join('|');
}

function startServerMonitorAlerts(slackClient, options = {}) {
    const monitorConfig = options.monitorConfig || config.SERVER_MONITOR;

    if (!monitorConfig.ENABLED) {
        console.log('🖥️ Server monitor alerts disabled.');
        return { stop: () => {} };
    }

    if (!monitorConfig.ALERT_CHANNEL_ID) {
        console.warn('⚠️ SERVER_MONITOR_ENABLED=true pero falta SERVER_MONITOR_ALERT_CHANNEL_ID. Alertas no iniciadas.');
        return { stop: () => {} };
    }

    let running = false;
    let alertActive = false;
    let lastSentAt = 0;
    let lastSeverity = 'ok';
    let lastFingerprint = '';

    async function sendReport(report, isRecovery = false) {
        const text = isRecovery
            ? `✅ *Servidor recuperado* \`${report.target?.host || monitorConfig.HOST}\`\nTodo volvió a estado OK.\n\n${formatServerStatusText(report, { maxProcesses: 3 })}`
            : formatServerStatusText(report, { maxProcesses: 5 });

        await slackClient.chat.postMessage({
            channel: monitorConfig.ALERT_CHANNEL_ID,
            text
        });
    }

    async function tick() {
        if (running) return;
        running = true;

        try {
            const report = await collectServerMetrics({ monitorConfig });
            const now = Date.now();

            if (report.severity === 'ok') {
                if (alertActive) {
                    await sendReport(report, true);
                }

                alertActive = false;
                lastSeverity = 'ok';
                lastFingerprint = '';
                return;
            }

            const fingerprint = buildAlertFingerprint(report);
            const shouldSend = !alertActive ||
                report.severity !== lastSeverity ||
                fingerprint !== lastFingerprint ||
                now - lastSentAt >= monitorConfig.ALERT_COOLDOWN_MS;

            if (shouldSend) {
                await sendReport(report);
                alertActive = true;
                lastSentAt = now;
                lastSeverity = report.severity;
                lastFingerprint = fingerprint;
            }
        } catch (error) {
            console.error('Error ejecutando server monitor:', error);
        } finally {
            running = false;
        }
    }

    tick();
    const interval = setInterval(tick, monitorConfig.POLL_INTERVAL_MS);

    console.log(`🖥️ Server monitor alerts enabled every ${monitorConfig.POLL_INTERVAL_MS} ms.`);

    return {
        stop: () => clearInterval(interval)
    };
}

module.exports = {
    analyzeMetrics,
    buildRemoteCommand,
    collectServerMetrics,
    formatBytes,
    formatServerStatusText,
    formatUptime,
    getMissingSshConfig,
    parseRemoteOutput,
    startServerMonitorAlerts
};
