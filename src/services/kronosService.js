const puppeteer = require('puppeteer');

const KRONOS_URL = 'https://kronos.ctdesarrollo-sdr.org/mi-tiempo-hoy';

async function stopTimer(username, password) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        // Función auxiliar para buscar elementos por texto (reemplazo de $x)
        const findElementByText = async (selector, text) => {
            return page.evaluateHandle((selector, text) => {
                // eslint-disable-next-line no-undef
                const elements = [...document.querySelectorAll(selector)];
                return elements.find(el => el.innerText.includes(text));
            }, selector, text);
        };

        console.log(`[Kronos] Attempting login for user: ${username}`);
        await page.goto(KRONOS_URL, { waitUntil: 'networkidle2' });

        await page.waitForSelector('input[name="user"]');

        await page.type('input[name="user"]', username);
        await page.type('input[name="password"]', password);

        // Buscar botón de Acceder
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

module.exports = { stopTimer };
