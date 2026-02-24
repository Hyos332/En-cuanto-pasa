const puppeteer = require('puppeteer');

const KRONOS_URL = 'https://kronos.ctdesarrollo-sdr.org/mi-tiempo-hoy';
const KRONOS_BASE_URL = 'https://kronos.ctdesarrollo-sdr.org/';

async function launchKronosPage() {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    return { browser, page };
}

function buildFindElementByText(page) {
    return async (selector, text) => {
        return page.evaluateHandle((selectorValue, textValue) => {
            const elements = [...globalThis.document.querySelectorAll(selectorValue)];
            return elements.find(el => el.innerText.includes(textValue));
        }, selector, text);
    };
}

async function loginToKronos(page, username, password) {
    const findElementByText = buildFindElementByText(page);

    await page.goto(KRONOS_BASE_URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[name="user"]');

    await page.type('input[name="user"]', username);
    await page.type('input[name="password"]', password);

    let loginButton = await page.$('button[type="submit"]');
    if (!loginButton) {
        const buttonHandle = await findElementByText('button', 'Acceder');
        if (buttonHandle.asElement()) {
            loginButton = buttonHandle.asElement();
        }
    }

    if (!loginButton) {
        throw new Error('No se encontró el botón de acceso en Kronos.');
    }

    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        loginButton.click()
    ]);
}

async function clickSidebarReports(page) {
    const clicked = await page.evaluate(() => {
        const elements = Array.from(globalThis.document.querySelectorAll('a,button,[role="button"],span,div'));
        const target = elements.find(el => (el.textContent || '').trim() === 'Reportes');

        if (!target) {
            return false;
        }

        const clickable = target.closest('a,button,[role="button"]') || target;
        clickable.click();
        return true;
    });

    if (clicked) {
        await waitForReportsView(page, 12000).catch(() => null);
        if (await isReportsView(page)) {
            return;
        }
    }

    const candidateRoutes = [
        'reportes',
        'admin/reportes',
        'administracion/reportes'
    ];

    for (const route of candidateRoutes) {
        await page.goto(`${KRONOS_BASE_URL}${route}`, { waitUntil: 'networkidle2' });
        await waitForReportsView(page, 8000).catch(() => null);
        if (await isReportsView(page)) {
            return;
        }
    }

    throw new Error('No se pudo abrir la pantalla de Reportes tras login.');
}

async function waitForReportsView(page, timeout = 20000) {
    await page.waitForFunction(() => {
        const text = (globalThis.document.body?.innerText || '').toLowerCase();
        const hasSummary = text.includes('resumen de horas de la semana');
        const hasDetail = text.includes('ver detalle');
        const hasColumns =
            text.includes('nombre') &&
            text.includes('usuario') &&
            text.includes('total de horas');

        return hasDetail || (hasSummary && hasColumns);
    }, { timeout });
}

async function isReportsView(page) {
    return page.evaluate(() => {
        const text = (globalThis.document.body?.innerText || '').toLowerCase();
        const hasSummary = text.includes('resumen de horas de la semana');
        const hasDetail = text.includes('ver detalle');
        const hasColumns =
            text.includes('nombre') &&
            text.includes('usuario') &&
            text.includes('total de horas');

        return hasDetail || (hasSummary && hasColumns);
    });
}

async function getPageDebugInfo(page) {
    return page.evaluate(() => {
        const text = (globalThis.document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        return {
            url: globalThis.location.href,
            title: globalThis.document.title,
            snippet: text.slice(0, 280)
        };
    });
}

function mergeRowData(primary = {}, secondary = {}) {
    const pick = (key) => primary[key] || secondary[key] || null;
    return {
        name: pick('name'),
        username: pick('username'),
        totalHours: pick('totalHours'),
        team: pick('team')
    };
}

async function extractFirstReportRow(page, timeout = 8000) {
    await waitForReportsView(page, timeout + 4000);

    await page.waitForFunction(() => {
        const tableRows = Array.from(globalThis.document.querySelectorAll('table tbody tr'))
            .filter(row => row.querySelectorAll('td').length > 0);
        const gridRows = Array.from(globalThis.document.querySelectorAll('[role="row"]'))
            .filter(row => row.querySelectorAll('[role="gridcell"]').length > 0);

        return tableRows.length > 0 || gridRows.length > 0;
    }, { timeout });

    const rowData = await page.evaluate(() => {
        const mapRow = (row) => {
            const cells = Array.from(row.querySelectorAll('td,[role="gridcell"]'))
                .map(cell => (cell.textContent || '').trim())
                .filter(Boolean);

            return {
                name: cells[0] || null,
                username: cells[1] || null,
                totalHours: cells[2] || null,
                team: cells[3] || null
            };
        };

        const firstTableRow = Array.from(globalThis.document.querySelectorAll('table tbody tr'))
            .find(row => row.querySelectorAll('td').length > 0);
        if (firstTableRow) {
            return mapRow(firstTableRow);
        }

        const firstGridRow = Array.from(globalThis.document.querySelectorAll('[role="row"]'))
            .find(row => row.querySelectorAll('[role="gridcell"]').length > 0);
        if (firstGridRow) {
            return mapRow(firstGridRow);
        }

        return null;
    });

    if (!rowData || (!rowData.name && !rowData.username)) {
        throw new Error('No se pudo leer la primera fila del reporte.');
    }

    return rowData;
}

async function openFirstReportDetail(page, timeout = 45000) {
    const currentUrl = page.url();

    await page.waitForFunction(() => {
        const candidates = Array.from(globalThis.document.querySelectorAll('a,button,[role="button"]'));
        return candidates.some(el => (el.textContent || '').toLowerCase().includes('ver detalle'));
    }, { timeout });

    const action = await page.evaluate(() => {
        const mapRow = (row) => {
            const cells = Array.from(row.querySelectorAll('td,[role="gridcell"]'))
                .map(cell => (cell.textContent || '').trim())
                .filter(Boolean);
            return {
                name: cells[0] || null,
                username: cells[1] || null,
                totalHours: cells[2] || null,
                team: cells[3] || null
            };
        };

        const candidates = Array.from(globalThis.document.querySelectorAll('a,button,[role="button"]'));
        const target = candidates.find(el => (el.textContent || '').toLowerCase().includes('ver detalle'));

        if (!target) {
            return { clicked: false, href: null, rowData: null };
        }

        const row = target.closest('tr,[role="row"]');
        const rowData = row ? mapRow(row) : null;

        const link = target.closest('a');
        const href = link ? link.getAttribute('href') : null;

        if (!href) {
            target.click();
        }

        return { clicked: true, href, rowData };
    });

    if (!action.clicked) {
        throw new Error('No se encontró la acción "Ver detalle" en la primera fila.');
    }

    if (action.href) {
        const detailUrl = new URL(action.href, KRONOS_BASE_URL).toString();
        await page.goto(detailUrl, { waitUntil: 'networkidle2' });
        return action.rowData;
    }

    await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
        page.waitForFunction(previousUrl => globalThis.location.href !== previousUrl, { timeout: 10000 }, currentUrl),
        page.waitForFunction(() => {
            const markers = [
                'detalle',
                'resumen',
                'horas registradas',
                'jornada'
            ];
            const text = (globalThis.document.body?.innerText || '').toLowerCase();
            return markers.some(marker => text.includes(marker));
        }, { timeout: 10000 })
    ]).catch(() => null);

    return action.rowData;
}

async function extractUserFromDetail(page, fallback) {
    const detailData = await page.evaluate(() => {
        const bodyText = (globalThis.document.body?.innerText || '').replace(/\r/g, '');
        const lines = bodyText.split('\n').map(line => line.trim()).filter(Boolean);

        const userLineIndex = lines.findIndex(line => line.toLowerCase() === 'usuario');
        const nameLineIndex = lines.findIndex(line => line.toLowerCase() === 'nombre');

        const username = userLineIndex >= 0 && lines[userLineIndex + 1] ? lines[userLineIndex + 1] : null;
        const name = nameLineIndex >= 0 && lines[nameLineIndex + 1] ? lines[nameLineIndex + 1] : null;

        const titleCandidate = lines.find(line => {
            const lower = line.toLowerCase();
            if (lower.includes('reportes') || lower.includes('resumen de horas')) return false;
            if (line.length < 3 || line.length > 80) return false;
            return /^[a-zA-ZÀ-ÿ0-9.\s-]+$/.test(line);
        });

        return { username, name, titleCandidate };
    });

    return {
        name: detailData.name || fallback.name,
        username: detailData.username || fallback.username,
        totalHours: fallback.totalHours,
        team: fallback.team,
        detailLabel: detailData.titleCandidate || detailData.name || fallback.name
    };
}

async function extractReportUserByUsername(page, targetUsername, timeout = 45000) {
    const normalizedTarget = (targetUsername || '').trim().toLowerCase();
    if (!normalizedTarget) {
        throw new Error('targetUsername inválido para búsqueda en Reportes.');
    }

    await waitForReportsView(page, 20000);

    await page.waitForFunction((target) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const toRow = (cells) => ({
            name: cells[0] || null,
            username: cells[1] || null,
            totalHours: cells[2] || null,
            team: cells[3] || null
        });

        const rows = [];

        const tableRows = Array.from(globalThis.document.querySelectorAll('table tbody tr'))
            .filter(row => row.querySelectorAll('td').length > 0);
        tableRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td')).map(cell => (cell.textContent || '').trim());
            rows.push(toRow(cells));
        });

        const gridRows = Array.from(globalThis.document.querySelectorAll('[role="row"]'))
            .filter(row => row.querySelectorAll('[role="gridcell"]').length > 0);
        gridRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('[role="gridcell"]')).map(cell => (cell.textContent || '').trim());
            rows.push(toRow(cells));
        });

        return rows.some(row => normalize(row.username) === target && Boolean(row.totalHours));
    }, { timeout }, normalizedTarget);

    const result = await page.evaluate((target) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const toRow = (cells) => ({
            name: cells[0] || null,
            username: cells[1] || null,
            totalHours: cells[2] || null,
            team: cells[3] || null
        });

        const rows = [];

        const tableRows = Array.from(globalThis.document.querySelectorAll('table tbody tr'))
            .filter(row => row.querySelectorAll('td').length > 0);
        tableRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td')).map(cell => (cell.textContent || '').trim());
            rows.push(toRow(cells));
        });

        const gridRows = Array.from(globalThis.document.querySelectorAll('[role="row"]'))
            .filter(row => row.querySelectorAll('[role="gridcell"]').length > 0);
        gridRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('[role="gridcell"]')).map(cell => (cell.textContent || '').trim());
            rows.push(toRow(cells));
        });

        const found = rows.find(row => normalize(row.username) === target) || null;
        const visibleUsers = rows
            .map(row => row.username)
            .filter(Boolean)
            .slice(0, 15);

        return { found, visibleUsers };
    }, normalizedTarget);

    if (!result.found) {
        const listed = result.visibleUsers.length > 0 ? result.visibleUsers.join(', ') : 'sin usuarios visibles';
        throw new Error(`No encontré al usuario ${targetUsername} en Reportes. Usuarios visibles: ${listed}`);
    }

    if (!result.found.totalHours) {
        throw new Error(`Encontré al usuario ${targetUsername}, pero no pude leer su total de horas.`);
    }

    return result.found;
}

async function stopTimer(username, password) {
    let browser;
    try {
        const launched = await launchKronosPage();
        browser = launched.browser;
        const page = launched.page;

        const findElementByText = async (selector, text) => {
            return page.evaluateHandle((selector, text) => {
                const elements = [...globalThis.document.querySelectorAll(selector)];
                return elements.find(el => el.innerText.includes(text));
            }, selector, text);
        };

        console.log(`[Kronos] Attempting login for user: ${username}`);
        await page.goto(KRONOS_URL, { waitUntil: 'networkidle2' });

        await page.waitForSelector('input[name="user"]');

        await page.type('input[name="user"]', username);
        await page.type('input[name="password"]', password);

        let loginButton = await page.$('button[type="submit"]');
        if (!loginButton) {
            const btnHandle = await findElementByText('button', 'Acceder');
            if (btnHandle.asElement()) loginButton = btnHandle.asElement();
        }

        if (loginButton) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                loginButton.click()
            ]);
        } else {
            throw new Error('Login button not found');
        }

        console.log('[Kronos] Logged in. Checking timer status...');

        await new Promise(r => setTimeout(r, 2000));

        // Buscar botón Detener
        let stopBtn = await page.$('.btn-stop');
        if (!stopBtn) {
            const btnHandle = await findElementByText('button', 'Detener');
            if (btnHandle.asElement()) stopBtn = btnHandle.asElement();
        }

        if (stopBtn) {
            console.log('[Kronos] Stop button found. Clicking...');
            await stopBtn.click();
            await new Promise(r => setTimeout(r, 3000));

            // Verificar si ahora aparece Iniciar
            let startBtnCheck = await page.$('.btn-start');
            if (!startBtnCheck) {
                const btnHandle = await findElementByText('button', 'Iniciar');
                if (btnHandle.asElement()) startBtnCheck = btnHandle.asElement();
            }

            if (startBtnCheck) {
                return { success: true, message: 'Timer stopped successfully.' };
            }
            return { success: true, message: 'Timer stopped (unverified state).' };
        }

        // Buscar botón Iniciar (para ver si ya estaba detenido)
        let startBtn = await page.$('.btn-start');
        if (!startBtn) {
            const btnHandle = await findElementByText('button', 'Iniciar');
            if (btnHandle.asElement()) startBtn = btnHandle.asElement();
        }

        if (startBtn) {
            console.log('[Kronos] Timer was already stopped.');
            return { success: true, message: 'Timer was already stopped.' };
        }

        return { success: false, message: 'Could not find Stop or Start button.' };

    } catch (error) {
        console.error('Kronos Error:', error);
        return { success: false, message: `Error: ${error.message}` };
    } finally {
        if (browser) await browser.close();
    }
}

async function startTimer(username, password) {
    let browser;
    try {
        const launched = await launchKronosPage();
        browser = launched.browser;
        const page = launched.page;

        // Función auxiliar local
        const findElementByText = async (selector, text) => {
            return page.evaluateHandle((selector, text) => {
                const elements = [...globalThis.document.querySelectorAll(selector)];
                return elements.find(el => el.innerText.includes(text));
            }, selector, text);
        };

        console.log(`[Kronos] Attempting START for user: ${username}`);
        await page.goto(KRONOS_URL, { waitUntil: 'networkidle2' });

        await page.waitForSelector('input[name="user"]');

        await page.type('input[name="user"]', username);
        await page.type('input[name="password"]', password);

        // Login
        let loginButton = await page.$('button[type="submit"]');
        if (!loginButton) {
            const btnHandle = await findElementByText('button', 'Acceder');
            if (btnHandle.asElement()) loginButton = btnHandle.asElement();
        }

        if (loginButton) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                loginButton.click()
            ]);
        } else {
            throw new Error('Login button not found');
        }

        console.log('[Kronos] Logged in. Checking timer status for START...');
        await new Promise(r => setTimeout(r, 2000));

        // Buscar botón Iniciar
        let startBtn = await page.$('.btn-start');
        if (!startBtn) {
            const btnHandle = await findElementByText('button', 'Iniciar');
            if (btnHandle.asElement()) startBtn = btnHandle.asElement();
        }

        if (startBtn) {
            console.log('[Kronos] Start button found. Clicking...');
            await startBtn.click();
            return { success: true, message: 'Jornada INICIADA correctamente. ☀️' };
        }

        // Si no hay botón iniciar, quizás ya está iniciado (boton Detener visible)
        let stopBtn = await page.$('.btn-stop');
        if (!stopBtn) {
            const btnHandle = await findElementByText('button', 'Detener');
            if (btnHandle.asElement()) stopBtn = btnHandle.asElement();
        }

        if (stopBtn) {
            return { success: true, message: 'La jornada ya estaba iniciada. ✅' };
        }

        return { success: false, message: 'No se encontró botón Iniciar ni Detener.' };

    } catch (error) {
        console.error('Kronos Start Error:', error);
        return { success: false, message: `Error: ${error.message}` };
    } finally {
        if (browser) await browser.close();
    }
}

async function getWeeklyReportsFirstPerson(username, password) {
    let browser;

    try {
        const launched = await launchKronosPage();
        browser = launched.browser;
        const page = launched.page;

        console.log(`[Kronos] Attempting weekly report extraction for user: ${username}`);

        await loginToKronos(page, username, password);
        await clickSidebarReports(page);
        let firstRow = { name: null, username: null, totalHours: null, team: null };
        try {
            firstRow = await extractFirstReportRow(page, 8000);
        } catch (rowError) {
            console.warn('[Kronos] No se pudo leer la primera fila por selector. Continuando con Ver detalle...', rowError.message);
        }

        const clickedRowData = await openFirstReportDetail(page, 45000);
        const fallback = mergeRowData(clickedRowData || {}, firstRow);
        const detail = await extractUserFromDetail(page, fallback);

        return {
            success: true,
            firstName: detail.name || fallback.name,
            firstUsername: detail.username || fallback.username,
            firstTotalHours: detail.totalHours || fallback.totalHours,
            firstTeam: detail.team || fallback.team,
            detailLabel: detail.detailLabel || fallback.name
        };
    } catch (error) {
        let context = '';
        try {
            if (browser) {
                const pages = await browser.pages();
                const activePage = pages[0];
                if (activePage) {
                    const info = await getPageDebugInfo(activePage);
                    context = ` [URL:${info.url}] [TITLE:${info.title}] [SNIPPET:${info.snippet}]`;
                }
            }
        } catch (ctxError) {
            context = '';
        }

        console.error('Kronos Weekly Report Error:', error);
        return { success: false, message: `Error: ${error.message}${context}` };
    } finally {
        if (browser) await browser.close();
    }
}

async function getWeeklyReportUserHours(username, password, targetUsername) {
    let browser;

    try {
        const launched = await launchKronosPage();
        browser = launched.browser;
        const page = launched.page;

        console.log(`[Kronos] Attempting weekly report lookup for user: ${username}. Target: ${targetUsername}`);

        await loginToKronos(page, username, password);
        await clickSidebarReports(page);

        const row = await extractReportUserByUsername(page, targetUsername, 45000);
        return {
            success: true,
            name: row.name,
            username: row.username,
            totalHours: row.totalHours,
            team: row.team
        };
    } catch (error) {
        let context = '';
        try {
            if (browser) {
                const pages = await browser.pages();
                const activePage = pages[0];
                if (activePage) {
                    const info = await getPageDebugInfo(activePage);
                    context = ` [URL:${info.url}] [TITLE:${info.title}] [SNIPPET:${info.snippet}]`;
                }
            }
        } catch (ctxError) {
            context = '';
        }

        console.error('Kronos Weekly User Lookup Error:', error);
        return { success: false, message: `Error: ${error.message}${context}` };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { stopTimer, startTimer, getWeeklyReportsFirstPerson, getWeeklyReportUserHours };
