const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../../data/kronos.db');
const dataDir = path.dirname(dbPath);

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS users (' +
        'slack_id TEXT PRIMARY KEY,' +
        'kronos_user TEXT,' +
        'kronos_password TEXT' +
        ')');

    db.run('CREATE TABLE IF NOT EXISTS schedules (' +
        'slack_id TEXT PRIMARY KEY,' +
        'time TEXT,' +
        'active INTEGER DEFAULT 1' +
        ')');

    // NUEVA TABLA: Horario Semanal Completo
    db.run('CREATE TABLE IF NOT EXISTS weekly_schedules (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
        'slack_id TEXT,' +
        'day_of_week INTEGER,' + // 0=Domingo, 1=Lunes, ...
        'start_time TEXT,' +     // "09:00" o null
        'end_time TEXT,' +       // "18:00" o null
        'is_active INTEGER DEFAULT 1,' +
        'UNIQUE(slack_id, day_of_week)' + // Un solo registro por día y usuario
        ')');
});

module.exports = {
    saveUser: (slackId, user, password) => {
        return new Promise((resolve, reject) => {
            db.run('INSERT OR REPLACE INTO users (slack_id, kronos_user, kronos_password) VALUES (?, ?, ?)',
                [slackId, user, password], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    },
    getUser: (slackId) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE slack_id = ?', [slackId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },
    // --- LEGACY --- (Mantener mientras migramos)
    saveSchedule: (slackId, time) => {
        return new Promise((resolve, reject) => {
            db.run('INSERT OR REPLACE INTO schedules (slack_id, time, active) VALUES (?, ?, 1)',
                [slackId, time], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    },
    // --- NUEVO --- (Gestión de Horario Semanal)
    saveDaySchedule: (slackId, day, start, end, active) => {
        return new Promise((resolve, reject) => {
            // day: 1-5 (Lunes-Viernes)
            db.run(`INSERT OR REPLACE INTO weekly_schedules 
                (slack_id, day_of_week, start_time, end_time, is_active) 
                VALUES (?, ?, ?, ?, ?)`,
                [slackId, day, start, end, active ? 1 : 0], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    },
    getWeeklySchedule: (slackId) => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM weekly_schedules WHERE slack_id = ? ORDER BY day_of_week',
                [slackId], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
        });
    },
    getAllWeeklySchedules: () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT w.*, u.kronos_user, u.kronos_password ' +
                'FROM weekly_schedules w ' +
                'JOIN users u ON w.slack_id = u.slack_id ' +
                'WHERE w.is_active = 1', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
        });
    },
    getAllSchedules: () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT s.slack_id, s.time, u.kronos_user, u.kronos_password ' +
                'FROM schedules s ' +
                'JOIN users u ON s.slack_id = u.slack_id ' +
                'WHERE s.active = 1', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
        });
    }
};
