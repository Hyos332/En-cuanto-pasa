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

    if (!clicked) {
        await page.goto(`${KRONOS_BASE_URL}reportes`, { waitUntil: 'networkidle2' });
    }
}

async function extractFirstReportName(page) {
    await page.waitForFunction(() => {
        const rows = Array.from(globalThis.document.querySelectorAll('table tbody tr'));
        return rows.some(row => row.querySelectorAll('td').length > 0);
    }, { timeout: 20000 });

    const firstName = await page.evaluate(() => {
        const rows = Array.from(globalThis.document.querySelectorAll('table tbody tr'));
        const firstRow = rows.find(row => row.querySelectorAll('td').length > 0);
        if (!firstRow) {
            return null;
        }

        const firstCell = firstRow.querySelector('td');
        return firstCell ? firstCell.textContent.trim() : null;
    });

    if (!firstName) {
        throw new Error('No se pudo leer la primera persona del reporte.');
    }

    return firstName;
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

        const firstName = await extractFirstReportName(page);
        return { success: true, firstName };
    } catch (error) {
        console.error('Kronos Weekly Report Error:', error);
        return { success: false, message: `Error: ${error.message}` };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { stopTimer, startTimer, getWeeklyReportsFirstPerson };
