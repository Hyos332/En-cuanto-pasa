const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { encryptSecret, decryptSecret } = require('../utils/credentialCrypto');

const dbPath = path.resolve(__dirname, '../../data/kronos.db');
const dataDir = path.dirname(dbPath);

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 5000);

function runSql(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function mapUserRowWithDecryptedPassword(row) {
    if (!row) {
        return row;
    }

    return {
        ...row,
        kronos_password: decryptSecret(row.kronos_password)
    };
}

db.serialize(() => {
    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA foreign_keys=ON');

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

    db.run('CREATE TABLE IF NOT EXISTS weekly_balances (' +
        'report_date_iso TEXT NOT NULL,' +
        'person_key TEXT NOT NULL,' +
        'person_name TEXT NOT NULL,' +
        'worked_minutes INTEGER,' +
        'target_minutes INTEGER,' +
        'delta_minutes INTEGER,' +
        'PRIMARY KEY (report_date_iso, person_key)' +
        ')');
});

module.exports = {
    saveUser: (slackId, user, password) => {
        return new Promise((resolve, reject) => {
            let encryptedPassword;
            try {
                encryptedPassword = encryptSecret(password);
            } catch (error) {
                reject(error);
                return;
            }

            db.run('INSERT OR REPLACE INTO users (slack_id, kronos_user, kronos_password) VALUES (?, ?, ?)',
                [slackId, user, encryptedPassword], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    },
    getUser: (slackId) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE slack_id = ?', [slackId], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }

                try {
                    resolve(mapUserRowWithDecryptedPassword(row));
                } catch (error) {
                    reject(error);
                }
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
    // --- NUEVO V2 (Multi-Slot) ---
    // Reemplaza TODOS los slots de un usuario por los nuevos (limpieza total)
    saveUserSlots: async (slackId, slots) => {
        await runSql('BEGIN IMMEDIATE TRANSACTION');

        try {
            await runSql('DELETE FROM time_slots WHERE slack_id = ?', [slackId]);

            for (const slot of slots) {
                await runSql(
                    'INSERT INTO time_slots (slack_id, day_of_week, start_time, end_time, is_active) VALUES (?, ?, ?, ?, ?)',
                    [slackId, slot.day_of_week, slot.start_time, slot.end_time, slot.is_active ? 1 : 0]
                );
            }

            await runSql('COMMIT');
        } catch (error) {
            await runSql('ROLLBACK').catch(() => {});
            throw error;
        }
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
                    if (err) {
                        reject(err);
                        return;
                    }

                    try {
                        resolve(rows.map(mapUserRowWithDecryptedPassword));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    },

    getAllSchedules: () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT s.slack_id, s.time, u.kronos_user, u.kronos_password ' +
                'FROM schedules s ' +
                'JOIN users u ON s.slack_id = u.slack_id ' +
                'WHERE s.active = 1', [], (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    try {
                        resolve(rows.map(mapUserRowWithDecryptedPassword));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    },

    clearLegacySchedule: (slackId) => {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM schedules WHERE slack_id = ?', [slackId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    saveWeeklyBalances: async (reportDateIso, balances) => {
        if (!reportDateIso || !Array.isArray(balances) || balances.length === 0) {
            return;
        }

        await runSql('BEGIN IMMEDIATE TRANSACTION');

        try {
            for (const entry of balances) {
                await runSql(
                    'INSERT INTO weekly_balances ' +
                    '(report_date_iso, person_key, person_name, worked_minutes, target_minutes, delta_minutes) ' +
                    'VALUES (?, ?, ?, ?, ?, ?) ' +
                    'ON CONFLICT(report_date_iso, person_key) DO UPDATE SET ' +
                    'person_name = excluded.person_name, ' +
                    'worked_minutes = excluded.worked_minutes, ' +
                    'target_minutes = excluded.target_minutes, ' +
                    'delta_minutes = excluded.delta_minutes',
                    [
                        reportDateIso,
                        entry.person_key,
                        entry.person_name,
                        entry.worked_minutes,
                        entry.target_minutes,
                        entry.delta_minutes
                    ]
                );
            }

            await runSql('COMMIT');
        } catch (error) {
            await runSql('ROLLBACK').catch(() => {});
            throw error;
        }
    },

    getWeeklyBalancesHistory: () => {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT report_date_iso, person_key, person_name, worked_minutes, target_minutes, delta_minutes ' +
                'FROM weekly_balances ' +
                'ORDER BY report_date_iso ASC, person_name ASC',
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }
};
