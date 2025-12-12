const puppeteer = require('puppeteer');

const KRONOS_URL = 'https://kronos.ctdesarrollo-sdr.org/mi-tiempo-hoy';

async function stopTimer(username, password) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        console.log(`[Kronos] Attempting login for user: ${username}`);
        await page.goto(KRONOS_URL, { waitUntil: 'networkidle2' });

        await page.waitForSelector('input[name="user"]');

        await page.type('input[name="user"]', username);
        await page.type('input[name="password"]', password);

        const loginButton = await page.$('button[type="submit"]') ||
            (await page.$x('//button[contains(., "Acceder")]'))[0];

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

        const stopBtn = await page.$('.btn-stop') ||
            (await page.$x('//button[contains(., "Detener")]'))[0];

        if (stopBtn) {
            console.log('[Kronos] Stop button found. Clicking...');
            await stopBtn.click();
            await new Promise(r => setTimeout(r, 3000));

            const startBtnCheck = await page.$('.btn-start') ||
                (await page.$x('//button[contains(., "Iniciar")]'))[0];

            if (startBtnCheck) {
                return { success: true, message: 'Timer stopped successfully.' };
            }
            return { success: true, message: 'Timer stopped (unverified state).' };
        }

        const startBtn = await page.$('.btn-start') ||
            (await page.$x('//button[contains(., "Iniciar")]'))[0];

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
