const { google } = require('googleapis');
const { formatMinutesClock, formatWeekLabelFromIso } = require('../utils/semanalReport');

const SHEETS_SCOPE = ['https://www.googleapis.com/auth/spreadsheets'];

function isGoogleSheetsEnabled() {
    const raw = (process.env.SEMANAL_GSHEETS_ENABLED || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'si'].includes(raw);
}

function parseGoogleCredentials() {
    const jsonInline = process.env.SEMANAL_GSHEETS_CREDENTIALS_JSON;
    const base64 = process.env.SEMANAL_GSHEETS_CREDENTIALS_BASE64;

    let credentials = null;
    if (jsonInline) {
        credentials = JSON.parse(jsonInline);
    } else if (base64) {
        const decoded = Buffer.from(base64, 'base64').toString('utf8');
        credentials = JSON.parse(decoded);
    } else {
        throw new Error('Faltan credenciales de Google Sheets. Define SEMANAL_GSHEETS_CREDENTIALS_JSON o _BASE64.');
    }

    if (!credentials.client_email || !credentials.private_key) {
        throw new Error('Credenciales de Google inválidas: se requiere client_email y private_key.');
    }

    return {
        ...credentials,
        private_key: credentials.private_key.replace(/\\n/g, '\n')
    };
}

async function getSheetsClient() {
    const credentials = parseGoogleCredentials();
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: SHEETS_SCOPE
    });
    return google.sheets({ version: 'v4', auth });
}

function quoteSheetName(sheetName) {
    return `'${sheetName.replace(/'/g, '\'\'')}'`;
}

function buildSheetValues(matrix, title) {
    const values = [];
    values.push([title]);
    values.push(['', ...matrix.weeks.map(formatWeekLabelFromIso), 'TOTAL']);

    matrix.people.forEach(person => {
        const targetHours = Number.isFinite(person.targetMinutes) ? Math.round(person.targetMinutes / 60) : '--';
        const weekCells = matrix.weeks.map(weekIso => {
            const value = person.weekly[weekIso];
            return Number.isFinite(value) ? formatMinutesClock(value) : '';
        });

        values.push([
            `${targetHours} ${person.personName}`,
            ...weekCells,
            formatMinutesClock(person.totalDeltaMinutes)
        ]);
    });

    return values;
}

function getCellStyleForDelta(minutes, isTotal = false) {
    if (!Number.isFinite(minutes)) {
        return null;
    }

    if (minutes < 0) {
        return {
            textFormat: { foregroundColor: { red: 0.75, green: 0.0, blue: 0.0 }, bold: isTotal },
            backgroundColor: { red: 0.99, green: 0.93, blue: 0.93 }
        };
    }

    if (minutes > 0) {
        return {
            textFormat: { foregroundColor: { red: 0.31, green: 0.31, blue: 0.31 }, bold: isTotal },
            backgroundColor: { red: 0.72, green: 0.88, blue: 0.80 }
        };
    }

    return {
        textFormat: { foregroundColor: { red: 0.37, green: 0.37, blue: 0.37 }, bold: isTotal }
    };
}

async function ensureSheet(sheets, spreadsheetId, sheetName) {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'spreadsheetId,sheets.properties.sheetId,sheets.properties.title'
    });

    const existing = (meta.data.sheets || []).find(s => s.properties && s.properties.title === sheetName);
    if (existing && existing.properties && Number.isInteger(existing.properties.sheetId)) {
        return existing.properties.sheetId;
    }

    const addResp = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                {
                    addSheet: {
                        properties: { title: sheetName }
                    }
                }
            ]
        }
    });

    const added = addResp.data.replies && addResp.data.replies[0] && addResp.data.replies[0].addSheet;
    const sheetId = added && added.properties && added.properties.sheetId;
    if (!Number.isInteger(sheetId)) {
        throw new Error(`No se pudo crear la hoja "${sheetName}".`);
    }

    return sheetId;
}

function buildFormatRequests(sheetId, matrix) {
    const totalColumns = Math.max(2, matrix.weeks.length + 2);
    const dataRows = matrix.people.length;
    const requests = [
        {
            updateSheetProperties: {
                properties: {
                    sheetId,
                    gridProperties: {
                        frozenRowCount: 2,
                        frozenColumnCount: 1
                    }
                },
                fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'
            }
        },
        {
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: 0,
                    endIndex: 1
                },
                properties: {
                    pixelSize: 280
                },
                fields: 'pixelSize'
            }
        },
        {
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: 1,
                    endIndex: totalColumns
                },
                properties: {
                    pixelSize: 90
                },
                fields: 'pixelSize'
            }
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 0,
                    endColumnIndex: totalColumns
                },
                cell: {
                    userEnteredFormat: {
                        textFormat: { bold: true, fontSize: 14 },
                        horizontalAlignment: 'LEFT',
                        verticalAlignment: 'MIDDLE'
                    }
                },
                fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)'
            }
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 1,
                    endRowIndex: 2,
                    startColumnIndex: 0,
                    endColumnIndex: totalColumns
                },
                cell: {
                    userEnteredFormat: {
                        textFormat: {
                            bold: true,
                            foregroundColor: { red: 0.11, green: 0.25, blue: 0.68 }
                        },
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE'
                    }
                },
                fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)'
            }
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 2,
                    endRowIndex: 2 + dataRows,
                    startColumnIndex: 0,
                    endColumnIndex: 1
                },
                cell: {
                    userEnteredFormat: {
                        textFormat: { bold: true, fontSize: 12 },
                        horizontalAlignment: 'LEFT',
                        verticalAlignment: 'MIDDLE'
                    }
                },
                fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)'
            }
        },
        {
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: 2,
                    endRowIndex: 2 + dataRows,
                    startColumnIndex: 1,
                    endColumnIndex: totalColumns
                },
                cell: {
                    userEnteredFormat: {
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE'
                    }
                },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)'
            }
        }
    ];

    matrix.people.forEach((person, personIndex) => {
        const row = 2 + personIndex;

        matrix.weeks.forEach((weekIso, weekIndex) => {
            const minutes = person.weekly[weekIso];
            const style = getCellStyleForDelta(minutes, false);
            if (!style) return;

            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: row,
                        endRowIndex: row + 1,
                        startColumnIndex: 1 + weekIndex,
                        endColumnIndex: 2 + weekIndex
                    },
                    cell: {
                        userEnteredFormat: style
                    },
                    fields: 'userEnteredFormat(textFormat,backgroundColor)'
                }
            });
        });

        const totalStyle = getCellStyleForDelta(person.totalDeltaMinutes, true);
        if (totalStyle) {
            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: row,
                        endRowIndex: row + 1,
                        startColumnIndex: totalColumns - 1,
                        endColumnIndex: totalColumns
                    },
                    cell: {
                        userEnteredFormat: totalStyle
                    },
                    fields: 'userEnteredFormat(textFormat,backgroundColor)'
                }
            });
        }
    });

    return requests;
}

async function syncSemanalSheet({ matrix, title = 'Horas Extra', reportDate }) {
    if (!isGoogleSheetsEnabled()) {
        return { enabled: false, synced: false };
    }

    const spreadsheetId = (process.env.SEMANAL_GSHEETS_SPREADSHEET_ID || '').trim();
    if (!spreadsheetId) {
        throw new Error('Falta SEMANAL_GSHEETS_SPREADSHEET_ID para sincronizar Google Sheets.');
    }

    const sheetName = (process.env.SEMANAL_GSHEETS_SHEET_NAME || 'Horas Extra Bot').trim();
    const sheets = await getSheetsClient();
    const sheetId = await ensureSheet(sheets, spreadsheetId, sheetName);

    const values = buildSheetValues(matrix, `${title} (${reportDate?.displayDate || 'sin fecha'})`);
    const rangeA1 = `${quoteSheetName(sheetName)}!A1`;
    const clearRange = `${quoteSheetName(sheetName)}!A:ZZ`;

    await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: clearRange
    });

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: rangeA1,
        valueInputOption: 'RAW',
        requestBody: {
            values
        }
    });

    const requests = buildFormatRequests(sheetId, matrix);
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });

    return {
        enabled: true,
        synced: true,
        spreadsheetId,
        sheetName,
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`
    };
}

module.exports = {
    syncSemanalSheet
};
