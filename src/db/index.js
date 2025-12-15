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

    // NUEVA TABLA V2: Franjas Horarias (Jornada Partida)
    db.run('CREATE TABLE IF NOT EXISTS time_slots (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
        'slack_id TEXT,' +
        'day_of_week INTEGER,' + // 1=Lunes...
        'start_time TEXT,' +
        'end_time TEXT,' +
        'is_active INTEGER DEFAULT 1' +
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

    // --- NUEVO V2 (Multi-Slot) ---
    // Reemplaza TODOS los slots de un usuario por los nuevos (limpieza total)
    saveUserSlots: (slackId, slots) => {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // 1. Borrar horarios viejos
                db.run('DELETE FROM time_slots WHERE slack_id = ?', [slackId]);

                // 2. Insertar nuevos
                const stmt = db.prepare('INSERT INTO time_slots (slack_id, day_of_week, start_time, end_time, is_active) VALUES (?, ?, ?, ?, ?)');

                slots.forEach(slot => {
                    stmt.run(slackId, slot.day_of_week, slot.start_time, slot.end_time, slot.is_active ? 1 : 0);
                });

                stmt.finalize();

                db.run('COMMIT', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    },

    // Lee la tabla nueva time_slots
    getWeeklySchedule: (slackId) => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM time_slots WHERE slack_id = ? ORDER BY day_of_week, start_time',
                [slackId], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
        });
    },

    getAllWeeklySchedules: () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT w.*, u.kronos_user, u.kronos_password ' +
                'FROM time_slots w ' +
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
