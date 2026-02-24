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

async function extractFirstReportRow(page) {
    await waitForReportsView(page, 20000);

    await page.waitForFunction(() => {
        const rows = Array.from(globalThis.document.querySelectorAll('table tbody tr'));
        return rows.some(row => row.querySelectorAll('td').length > 0);
    }, { timeout: 20000 });

    const rowData = await page.evaluate(() => {
        const rows = Array.from(globalThis.document.querySelectorAll('table tbody tr'));
        const firstRow = rows.find(row => row.querySelectorAll('td').length > 0);
        if (!firstRow) {
            return null;
        }

        const cells = Array.from(firstRow.querySelectorAll('td')).map(cell => (cell.textContent || '').trim());
        return {
            name: cells[0] || null,
            username: cells[1] || null,
            totalHours: cells[2] || null,
            team: cells[3] || null
        };
    });

    if (!rowData || !rowData.name) {
        throw new Error('No se pudo leer la primera fila del reporte.');
    }

    return rowData;
}

async function openFirstReportDetail(page) {
    const currentUrl = page.url();

    const action = await page.evaluate(() => {
        const rows = Array.from(globalThis.document.querySelectorAll('table tbody tr'));
        const firstRow = rows.find(row => row.querySelectorAll('td').length > 0);

        if (!firstRow) {
            return { clicked: false, href: null };
        }

        const candidates = Array.from(firstRow.querySelectorAll('a,button,[role="button"],span,div'));
        const target = candidates.find(el => (el.textContent || '').toLowerCase().includes('ver detalle'));

        if (!target) {
            return { clicked: false, href: null };
        }

        const link = target.closest('a');
        const href = link ? link.getAttribute('href') : null;

        if (!href) {
            const clickable = target.closest('a,button,[role="button"]') || target;
            clickable.click();
        }

        return { clicked: true, href };
    });

    if (!action.clicked) {
        throw new Error('No se encontró la acción "Ver detalle" en la primera fila.');
    }

    if (action.href) {
        const detailUrl = new URL(action.href, KRONOS_BASE_URL).toString();
        await page.goto(detailUrl, { waitUntil: 'networkidle2' });
        return;
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
        const firstRow = await extractFirstReportRow(page);

        await openFirstReportDetail(page);
        const detail = await extractUserFromDetail(page, firstRow);

        return {
            success: true,
            firstName: detail.name || firstRow.name,
            firstUsername: detail.username || firstRow.username,
            firstTotalHours: detail.totalHours || firstRow.totalHours,
            firstTeam: detail.team || firstRow.team,
            detailLabel: detail.detailLabel || firstRow.name
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

module.exports = { stopTimer, startTimer, getWeeklyReportsFirstPerson };
