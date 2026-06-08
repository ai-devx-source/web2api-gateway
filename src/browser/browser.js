import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { saveSession, saveAuthToken } from './session.js';
import { startManualAuthentication } from './auth.js';
import { clearPagePool, getAuthToken } from '../providers/qwen.js';
import fs from 'fs';
import path from 'path';
import { logInfo, logError, logWarn, logDebug } from '../logger/index.js';
import { getBrowserInstallHint, resolveBrowserExecutable } from '../utils/browserExecutable.js';
import {
    CHAT_PAGE_URL, NAVIGATION_TIMEOUT, RETRY_DELAY,
    VIEWPORT_WIDTH, VIEWPORT_HEIGHT, USER_AGENT,
    SESSION_DIR, ACCOUNTS_DIR
} from '../config.js';

puppeteer.use(StealthPlugin());

let browserInstance = null;
let browserContext = null;
export let isAuthenticated = false;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function initBrowser(visibleMode = true, skipManualRestart = false) {
    if (browserInstance) return true;

    logInfo('Initializing browser with Puppeteer Stealth...');
    try {
        const executablePath = resolveBrowserExecutable();
        if (executablePath) {
            logInfo(`Using browser executable: ${executablePath}`);
        } else {
            logWarn(getBrowserInstallHint());
        }

        browserInstance = await puppeteer.launch({
            headless: !visibleMode,
            slowMo: visibleMode ? 30 : 0,
            executablePath: executablePath || undefined,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage', '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
                '--start-maximized', '--disable-infobars',
                '--disable-extensions', '--disable-gpu',
                '--no-first-run', '--no-default-browser-check',
                '--ignore-certificate-errors', '--ignore-certificate-errors-spki-list'
            ],
            defaultViewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
            ignoreHTTPSErrors: true
        });

        const pages = await browserInstance.pages();
        const page = pages.length > 0 ? pages[0] : await browserInstance.newPage();

        await page.setUserAgent(USER_AGENT);
        await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, deviceScaleFactor: 1 });
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
            Object.defineProperty(navigator, 'plugins', {
                get: () => [{ 0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' }, description: 'Portable Document Format', filename: 'internal-pdf-viewer', length: 1, name: 'Chrome PDF Plugin' }]
            });
            Object.defineProperty(navigator, 'connection', {
                get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false })
            });
            if (!navigator.getBattery) {
                navigator.getBattery = () => Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 });
            }

            const originalAddEventListener = EventTarget.prototype.addEventListener;
            EventTarget.prototype.addEventListener = function (type, listener, options) {
                if (type === 'mousemove' || type === 'mousedown' || type === 'mouseup') {
                    const wrappedListener = function (event) { setTimeout(() => listener.call(this, event), Math.random() * 3); };
                    return originalAddEventListener.call(this, type, wrappedListener, options);
                }
                return originalAddEventListener.call(this, type, listener, options);
            };

            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function (type) {
                const context = this.getContext('2d');
                if (context) {
                    const imageData = context.getImageData(0, 0, this.width, this.height);
                    const data = imageData.data;
                    for (let i = 0; i < data.length; i += 4) {
                        const noise = Math.floor(Math.random() * 5) - 2;
                        data[i] = Math.max(0, Math.min(255, data[i] + noise));
                        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
                        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
                    }
                    context.putImageData(imageData, 0, 0);
                }
                return originalToDataURL.apply(this, arguments);
            };
        });

        browserContext = page;
        logInfo('Browser initialized with maximum detection evasion');

        if (visibleMode) {
            await startManualAuthenticationPuppeteer(page, skipManualRestart);
        }
        // loadSessionPuppeteer removed — was dead code (always returned false)

        return true;
    } catch (error) {
        if (error.message === 'BROWSER_CLOSED_BY_USER') {
            logWarn('Browser initialization aborted by user.');
            return false;
        }
        logError('Error initializing browser', error);
        return false;
    }
}

async function saveSessionPuppeteer(page) {
    try {
        const cookies = await page.cookies();
        const sessionDir = path.join(process.cwd(), SESSION_DIR, ACCOUNTS_DIR);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

        const accountId = `acc_${Date.now()}`;
        const accountDir = path.join(sessionDir, accountId);
        if (!fs.existsSync(accountDir)) fs.mkdirSync(accountDir, { recursive: true });

        fs.writeFileSync(path.join(accountDir, 'cookies.json'), JSON.stringify(cookies, null, 2));
        logInfo(`Cookies saved for account ${accountId}`);
        return accountId;
    } catch (error) {
        logError('Error saving session', error);
        return null;
    }
}

async function startManualAuthenticationPuppeteer(page, skipManualRestart) {
    try {
        logInfo('Opening page for manual authorization...');
        await page.goto(CHAT_PAGE_URL, { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT });
        await delay(5000);

        console.log('\n======================================================');
        console.log('               AUTHORIZATION REQUIRED');
        console.log('======================================================');
        console.log('Please follow these steps:');
        console.log('1. Log in to the system in the open browser');
        console.log('2. IMPORTANT: Move your mouse naturally, do not rush');
        console.log('3. If a CAPTCHA slider appears - solve it slowly');
        console.log('4. Wait for the main page to fully load');
        console.log('5. After successful login, press ENTER in the console');
        console.log('======================================================');
        console.log('After successful login, press ENTER to continue...');

        await new Promise((resolve) => {
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            process.stdin.resume();
            process.stdin.setEncoding('utf8');
            const onData = (key) => {
                if (key === '\n' || key === '\r' || key.charCodeAt(0) === 13) {
                    process.stdin.pause();
                    process.stdin.removeListener('data', onData);
                    logInfo('Confirmation received, continuing...');
                    resolve();
                }
            };
            process.stdin.on('data', onData);
        });

        const cookies = await page.cookies();
        logInfo(`Saved ${cookies.length} cookies`);

        const token = await page.evaluate(() =>
            localStorage.getItem('token') || localStorage.getItem('auth_token') ||
            localStorage.getItem('access_token') || sessionStorage.getItem('token') ||
            sessionStorage.getItem('auth_token') || null
        );

        if (token) {
            logInfo('Token found and will be saved');
            saveAuthToken(token);
        } else {
            logWarn('Token not found in localStorage/sessionStorage');
            logInfo('Attempting to extract token from cookies...');
            const tokenCookie = cookies.find(c => c.name.toLowerCase().includes('token') || c.name.toLowerCase().includes('auth'));
            if (tokenCookie) {
                logInfo(`Token found in cookie: ${tokenCookie.name}`);
                saveAuthToken(tokenCookie.value);
            }
        }

        const accountId = await saveSessionPuppeteer(page);
        if (accountId) logInfo(`Session saved with ID: ${accountId}`);

        setAuthenticationStatus(true);
        logInfo('Authorization completed successfully');

        if (!skipManualRestart) await restartBrowserInHeadlessMode();
    } catch (error) {
        if (error.message && (error.message.includes('Session closed') || error.message.includes('Target closed') || error.message.includes('Browser closed'))) {
            logWarn('Manual authorization cancelled: Browser was closed by the user.');
            throw new Error('BROWSER_CLOSED_BY_USER');
        }
        logError('Error during manual authorization', error);
        throw error;
    }
}

export async function restartBrowserInHeadlessMode() {
    logInfo('Restarting browser in background mode...');
    const token = getAuthToken();
    if (token) { logDebug('Saving token...'); saveAuthToken(token); await delay(1000); }
    await shutdownBrowser();
    await delay(RETRY_DELAY);
    const success = await initBrowser(false);
    logInfo(success ? 'Browser restarted in background mode' : 'Error restarting browser');
}

export async function shutdownBrowser() {
    try {
        try { await clearPagePool(); } catch (e) { logError('Error clearing page pool', e); }
        if (browserInstance) {
            try {
                const pages = await browserInstance.pages();
                for (const page of pages) await page.close().catch(() => {});
                await browserInstance.close();
            } catch (e) { logError('Error closing browser', e); }
        }
        browserContext = null;
        browserInstance = null;
        logInfo('Browser closed');
    } catch (error) {
        logError('Error during browser shutdown', error);
    }
}

export function getBrowserContext() { return browserContext; }
export function setAuthenticationStatus(status) { isAuthenticated = status; }
export function getAuthenticationStatus() { return isAuthenticated; }
