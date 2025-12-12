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
    saveSchedule: (slackId, time) => {
        return new Promise((resolve, reject) => {
            db.run('INSERT OR REPLACE INTO schedules (slack_id, time, active) VALUES (?, ?, 1)',
                [slackId, time], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    },
    getSchedule: (slackId) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM schedules WHERE slack_id = ?', [slackId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
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
