import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logInfo, logError, logWarn } from '../logger/index.js';
import { SESSION_DIR } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SESSION_PATH = path.resolve(__dirname, '..', '..', SESSION_DIR);
const TOKEN_FILE = path.join(SESSION_PATH, 'auth_token.txt');

function getSessionFilePath(accountId, fileName) {
    return accountId
        ? path.join(SESSION_PATH, 'accounts', accountId, fileName)
        : path.join(SESSION_PATH, fileName);
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

export function initSessionDirectory() {
    ensureDir(SESSION_PATH);
}

export async function saveSession(context, accountId = null) {
    try {
        initSessionDirectory();
        const isPuppeteer = context && typeof context.goto === 'function';
        const isPlaywright = context && typeof context.storageState === 'function';

        if (isPuppeteer) {
            const cookies = await context.cookies();
            const sessionPath = getSessionFilePath(accountId, 'cookies.json');
            ensureDir(path.dirname(sessionPath));
            fs.writeFileSync(sessionPath, JSON.stringify(cookies, null, 2));
            logInfo('Puppeteer session saved');
            return true;
        }

        if (isPlaywright && context.browser()) {
            const sessionPath = getSessionFilePath(accountId, 'state.json');
            ensureDir(path.dirname(sessionPath));
            await context.storageState({ path: sessionPath });
            logInfo('Playwright session saved');
            return true;
        }

        logError('Unknown browser context type');
        return false;
    } catch (error) {
        logError('Error saving session', error);
        return false;
    }
}

export async function loadSession(context, accountId = null) {
    try {
        const isPuppeteer = context && typeof context.goto === 'function';
        const isPlaywright = context && typeof context.storageState === 'function';

        if (isPuppeteer) {
            const sessionPath = getSessionFilePath(accountId, 'cookies.json');
            if (fs.existsSync(sessionPath)) {
                const cookies = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                await context.setCookie(...cookies);
                logInfo('Puppeteer session loaded');
                return true;
            }
        } else if (isPlaywright) {
            const sessionPath = getSessionFilePath(accountId, 'state.json');
            if (fs.existsSync(sessionPath)) {
                await context.storageState({ path: sessionPath });
                logInfo('Playwright session loaded');
                return true;
            }
        }
    } catch (error) {
        logError('Error loading session', error);
    }
    return false;
}

export function clearSession(accountId = null) {
    try {
        const paths = [
            getSessionFilePath(accountId, 'state.json'),
            getSessionFilePath(accountId, 'cookies.json')
        ];
        let cleared = false;
        for (const p of paths) {
            if (fs.existsSync(p)) { fs.unlinkSync(p); cleared = true; }
        }
        if (cleared) logInfo('Session cleared');
        return cleared;
    } catch (error) {
        logError('Error clearing session', error);
        return false;
    }
}

export function hasSession(accountId = null) {
    return [
        getSessionFilePath(accountId, 'state.json'),
        getSessionFilePath(accountId, 'cookies.json')
    ].some(p => fs.existsSync(p));
}

export function saveAuthToken(token) {
    try {
        initSessionDirectory();
        if (token) {
            fs.writeFileSync(TOKEN_FILE, token, 'utf8');
            logInfo('Authorization token saved');
            return true;
        }
    } catch (error) {
        logError('Error saving authorization token', error);
    }
    return false;
}

export function loadAuthToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            const token = fs.readFileSync(TOKEN_FILE, 'utf8');
            logInfo('Authorization token loaded');
            return token;
        }
    } catch (error) {
        logError('Error loading authorization token', error);
    }
    return null;
}
