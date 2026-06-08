#!/usr/bin/env node

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { zaiTokenManager } from '../src/providers/zai.js';
import { SESSION_DIR } from '../src/config.js';
import { getBrowserInstallHint, resolveBrowserExecutable } from '../src/utils/browserExecutable.js';

puppeteer.use(StealthPlugin());

const ZAI_BASE_URL = process.env.ZAI_BASE_URL || 'https://chat.z.ai';
const ZAI_PROFILE_DIR = path.resolve(process.cwd(), SESSION_DIR, 'zai', 'browser-profile');
const executablePath = resolveBrowserExecutable();

if (executablePath) {
    console.log(`Using browser executable: ${executablePath}`);
} else {
    console.warn(getBrowserInstallHint());
}

function waitForEnter(message) {
    return new Promise(resolve => {
        process.stdout.write(message);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', () => {
            process.stdin.pause();
            resolve();
        });
    });
}

const browser = await puppeteer.launch({
    headless: false,
    executablePath: executablePath || undefined,
    userDataDir: ZAI_PROFILE_DIR,
    defaultViewport: { width: 1440, height: 950 },
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,950'
    ]
});

const ZAI_SESSION_DIR = path.resolve(process.cwd(), SESSION_DIR, 'zai');
if (!fs.existsSync(ZAI_SESSION_DIR)) fs.mkdirSync(ZAI_SESSION_DIR, { recursive: true });
const wsUrlFile = path.join(ZAI_SESSION_DIR, 'debug-browser.json');
fs.writeFileSync(wsUrlFile, JSON.stringify({ wsEndpoint: browser.wsEndpoint() }));

try {
    const page = await browser.newPage();
    await page.setUserAgent(process.env.ZAI_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    await page.goto(`${ZAI_BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });

    console.log('------------------------------------------------------');
    console.log(' Z.ai / GLM account authorization');
    console.log(` Browser profile: ${ZAI_PROFILE_DIR}`);
    console.log('------------------------------------------------------');
    console.log('1. In the open browser, log in to your Z.ai account.');
    console.log('2. If a captcha/verification appears, complete it manually.');
    console.log('3. Wait for the main chat screen, then return here.');
    console.log('------------------------------------------------------');
    await waitForEnter('After successful login, press ENTER...');

    await page.goto(`${ZAI_BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const session = await page.evaluate(async () => {
        let user = null;
        try {
            const response = await fetch('/api/v1/auths/', { credentials: 'include' });
            if (response.ok) user = await response.json();
        } catch {
            user = null;
        }
        return {
            id: user?.id || null,
            email: user?.email || null,
            role: user?.role || null,
            token: user?.token || localStorage.getItem('token') || null,
            tokenType: user?.token_type || 'Bearer',
            source: 'account'
        };
    });

    const cookies = await page.cookies(`${ZAI_BASE_URL}/`);
    const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    const tokenCookie = cookies.find(cookie => cookie.name === 'token');

    if (!session.token && tokenCookie?.value) {
        session.token = tokenCookie.value;
    }
    session.cookie = cookieHeader;

    if (!session.token) {
        throw new Error('Z.ai token not found. Ensure you are logged in, and repeat npm run zai:auth.');
    }

    if (String(session.role || '').toLowerCase() === 'guest' || session.source === 'guest') {
        throw new Error('Z.ai returned a guest session. Log in with your account in the open browser and repeat npm run zai:auth.');
    }

    const tokens = zaiTokenManager.listTokens();
    const id = session.email || session.id || `acc_${Date.now()}`;
    const tokenObj = {
        id: id,
        token: session.token,
        cookie: session.cookie,
        role: session.role,
        source: session.source,
        resetAt: null,
        createdAt: Date.now()
    };
    
    const existingIdx = tokens.findIndex(t => t.id === id);
    if (existingIdx !== -1) {
        tokens[existingIdx] = tokenObj;
    } else {
        tokens.push(tokenObj);
    }
    
    zaiTokenManager.saveTokens(tokens);
    console.log(`Z.ai session saved: ${session.email || session.id || 'account'} (${session.role || 'unknown role'})`);
    console.log('------------------------------------------------------');
    console.log('Authorization successfully completed!');
    
    const { runProviderTest } = await import('../src/api/tester.js');
    console.log('\nRunning automatic test...');
    await runProviderTest('zai');
    
    console.log('The browser will close automatically...');
} finally {
    if (fs.existsSync(wsUrlFile)) {
        try { fs.unlinkSync(wsUrlFile); } catch (e) {}
    }
    await browser.close();
}
