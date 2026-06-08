import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { SESSION_DIR } from '../config.js';
import { logInfo, logWarn } from '../logger/index.js';
import { resolveBrowserExecutable } from '../utils/browserExecutable.js';
import { getActiveProvider, getProviderAuthMode } from './activeProvider.js';

puppeteer.use(StealthPlugin());

const KIMI_BASE_URL = process.env.KIMI_BASE_URL || 'https://kimi.com';
const KIMI_API_BASE = 'https://kimi.moonshot.cn/api';
const KIMI_PROVIDER_ID = 'kimi';
const KIMI_SESSION_DIR = path.resolve(process.cwd(), SESSION_DIR, 'kimi');
const KIMI_SESSION_FILE = path.join(KIMI_SESSION_DIR, 'session.json');
const KIMI_PROFILE_DIR = path.join(KIMI_SESSION_DIR, 'browser-profile');
const DEFAULT_KIMI_MODEL = process.env.KIMI_DEFAULT_MODEL || 'kimi-k2.6';
const KIMI_USER_AGENT = process.env.KIMI_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let lastChatSessionId = null;

const KIMI_MODELS = [
    { id: 'kimi-k2.6', name: 'Kimi K2.6', object: 'model', created: 0, owned_by: 'moonshot', provider: 'kimi', account_required: true, guest_available: false, permission: [] },
    { id: 'kimi-k2.5', name: 'Kimi K2.5', object: 'model', created: 0, owned_by: 'moonshot', provider: 'kimi', account_required: true, guest_available: false, permission: [] },
    { id: 'kimi-k2', name: 'Kimi K2', object: 'model', created: 0, owned_by: 'moonshot', provider: 'kimi', account_required: true, guest_available: false, permission: [] },
    { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K', object: 'model', created: 0, owned_by: 'moonshot', provider: 'kimi', account_required: true, guest_available: false, permission: [] },
    { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K', object: 'model', created: 0, owned_by: 'moonshot', provider: 'kimi', account_required: true, guest_available: false, permission: [] },
    { id: 'moonshot-v1-8k', name: 'Moonshot V1 8K', object: 'model', created: 0, owned_by: 'moonshot', provider: 'kimi', account_required: true, guest_available: false, permission: [] }
];

const KIMI_MODEL_PREFIXES = ['kimi-', 'moonshot-', 'k2'];

function ensureSessionDir() {
    if (!fs.existsSync(KIMI_SESSION_DIR)) {
        fs.mkdirSync(KIMI_SESSION_DIR, { recursive: true });
    }
}

import { TokenManager } from '../api/tokenManager.js';
export const kimiTokenManager = new TokenManager('kimi');

function getUsableBearerToken(tokenObj) {
    if (!tokenObj) return '';
    return tokenObj.token || tokenObj.bearerToken || '';
}

function getKimiAuthMode() {
    return getProviderAuthMode(KIMI_PROVIDER_ID);
}

function isKimiGuestMode() {
    return getKimiAuthMode() === 'guest';
}

function cleanBearerHeader(value = '') {
    const token = String(value || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || ['null', 'undefined'].includes(token.toLowerCase())) return '';
    return token;
}

export async function authorizeKimiInteractive() {
    ensureSessionDir();
    fs.mkdirSync(KIMI_PROFILE_DIR, { recursive: true });
    logInfo('Starting Kimi interactive authorization in visible browser...');
    
    let capturedHeaders = {};
    const executablePath = resolveBrowserExecutable();
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: executablePath || undefined,
        userDataDir: KIMI_PROFILE_DIR,
        defaultViewport: { width: 1440, height: 1000 },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1440,1000'
        ]
    });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    await page.setUserAgent(KIMI_USER_AGENT);

    page.on('request', request => {
        const url = request.url();
        if (url.includes('/api/') || url.includes('/apiv2/') || url.includes('kimi.chat.v1')) {
            const h = request.headers();
            const keys = ['authorization', 'x-msh-device-id', 'x-msh-session-id', 'x-traffic-id'];
            for (const key of keys) {
                if (h[key]) capturedHeaders[key] = h[key];
            }
        }
    });

    await page.goto(KIMI_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
    console.log('------------------------------------------------------');
    console.log(' Kimi Chat authorization');
    console.log(` Browser profile: ${KIMI_PROFILE_DIR}`);
    console.log('------------------------------------------------------');
    console.log('1. Sign in to https://kimi.moonshot.cn in the opened browser.');
    console.log('2. Send one short test prompt in the official web chat and wait until the answer starts.');
    console.log('3. Return here and press ENTER.');
    console.log('------------------------------------------------------');
    await new Promise(resolve => {
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', () => {
            process.stdin.pause();
            resolve();
        });
    });

    const cookies = await page.cookies(KIMI_BASE_URL);
    const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    const currentTokens = kimiTokenManager.listTokens();
    const current = currentTokens.length > 0 ? currentTokens[0] : {};
    const capturedBearer = cleanBearerHeader(capturedHeaders['authorization']);
    const bearerToken = capturedBearer || getUsableBearerToken(current);
    
    // Auto-generate missing IDs to emulate Kimi client
    const deviceId = capturedHeaders['x-msh-device-id'] || current.mshDeviceId || String(Math.floor(Math.random() * 999999999999999999 + 7000000000000000000));
    const sessionId = capturedHeaders['x-msh-session-id'] || current.mshSessionId || String(Math.floor(Math.random() * 99999999999999999 + 1700000000000000000));

    const tokenObj = {
        id: 'legacy-kimi',
        token: bearerToken,
        cookieHeader,
        mshDeviceId: deviceId,
        mshSessionId: sessionId
    };
    kimiTokenManager.saveTokens([tokenObj]);

    console.log('------------------------------------------------------');
    if (bearerToken) {
        console.log(' Successfully captured Kimi token!');
    } else {
        console.log(' Failed to capture Bearer token. Account might be invalid.');
    }
    console.log('------------------------------------------------------');

    await browser.close().catch(() => {});
}

export function getKimiSessionStatus() {
    const accountSessionAvailable = kimiTokenManager.hasValidTokens();
    const authMode = getKimiAuthMode();
    const authenticated = authMode === 'account' && accountSessionAvailable;
    
    return {
        provider: KIMI_PROVIDER_ID,
        domain: KIMI_BASE_URL,
        authMode,
        available: authenticated,
        authenticated: authenticated,
        accountSessionAvailable: accountSessionAvailable,
        accountRequired: true,
        guest: false,
        guestAvailable: false,
        capabilities: {
            models: authenticated,
            chatCompletions: authenticated,
            accountChatCompletions: authenticated,
            guestChatCompletions: false
        },
        savedAt: null,
        message: authenticated ? 'Kimi session is available.' : 'Kimi requires authentication.'
    };
}

export function getKimiModels() {
    return KIMI_MODELS;
}

export function getDefaultKimiModel() {
    return DEFAULT_KIMI_MODEL;
}

export function isKimiModel(model = '') {
    const lowerModel = String(model).toLowerCase();
    return KIMI_MODEL_PREFIXES.some(prefix => lowerModel.startsWith(prefix.toLowerCase()));
}

export function shouldUseKimiProvider(body = {}) {
    const provider = String(body.provider || body?.metadata?.provider || '').toLowerCase();
    if (['kimi', 'moonshot'].includes(provider)) return true;
    if (['qwen', 'zai', 'glm', 'deepseek', 'ds', 'minimax', 'mm'].includes(provider)) return false;
    if (isKimiModel(body.model || '')) return true;
    return getActiveProvider() === 'kimi';
}

function getKimiHeaders(session) {
    const headers = {
        'Accept': '*/*',
        'Content-Type': 'application/json',
        'User-Agent': KIMI_USER_AGENT,
        'Origin': KIMI_BASE_URL,
        'Referer': KIMI_BASE_URL + '/chat',
        'X-Msh-Platform': 'web',
        'R-Timezone': 'Asia/Shanghai'
    };
    if (session.mshDeviceId) headers['X-Msh-Device-Id'] = session.mshDeviceId;
    if (session.mshSessionId) headers['X-Msh-Session-Id'] = session.mshSessionId;
    if (session.trafficId) headers['X-Traffic-Id'] = session.trafficId;
    if (session.cookieHeader) headers['Cookie'] = session.cookieHeader;
    
    const bearerToken = getUsableBearerToken(session);
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
    return headers;
}

async function createKimiChatSession(model, headers) {
    const response = await fetch(`${KIMI_API_BASE}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            enter_method: 'new_chat',
            is_example: false,
            kimiplus_id: model === 'kimi-k2.6' ? 'kimi' : model,
            name: 'New Chat'
        })
    });
    if (!response.ok) throw new Error(`Failed to create chat session: ${response.status} ${await response.text()}`);
    const json = await response.json();
    const id = json?.id;
    if (!id) throw new Error(`Kimi did not return chat session id`);
    lastChatSessionId = id;
    return id;
}

function contentToText(content) {
    if (content === null || content === undefined) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(item => {
            if (typeof item === 'string') return item;
            if (item?.type === 'text') return item.text || '';
            return item?.text || item?.content || '';
        }).filter(Boolean).join('\n');
    }
    return JSON.stringify(content);
}

function messagesToPrompt(messages = []) {
    const kMessages = [];
    let systemPrompt = '';
    
    for (const message of messages) {
        if (!message) continue;
        const text = contentToText(message.content).trim();
        if (!text) continue;
        
        let role = message.role;
        if (role === 'system') {
            systemPrompt += (systemPrompt ? '\n\n' : '') + text;
            continue;
        } else if (role === 'assistant') {
            role = 'assistant';
        } else {
            role = 'user';
        }
        
        kMessages.push({ role, content: text });
    }
    return { kMessages, systemPrompt };
}

export async function sendKimiChatCompletion({ messages, model = DEFAULT_KIMI_MODEL, stream = false, onChunk = null, chatId = null }) {
    if (isKimiGuestMode()) {
        throw new Error('Kimi guest mode is not supported. Use account mode.');
    }
    const session = await kimiTokenManager.getAvailableToken();
    if (!session) {
        throw new Error('Kimi account session is missing. Run `npm run kimi:auth` first.');
    }

    const { kMessages, systemPrompt } = messagesToPrompt(messages);
    if (!kMessages.length) throw new Error('Kimi request has no user text.');

    const headers = getKimiHeaders(session);
    const sessionId = chatId || lastChatSessionId || await createKimiChatSession(model, headers);
    
    const reqBody = {
        kimiplus_id: model === 'kimi-k2.6' ? 'kimi' : model,
        messages: kMessages,
        refs: [],
        refs_file: [],
        use_math: false,
        use_research: false,
        use_search: false,
        extend: { sidebar: true }
    };
    if (systemPrompt) reqBody.extend.system_prompt = systemPrompt;

    const compResp = await fetch(`${KIMI_API_BASE}/chat/${sessionId}/completion/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody)
    });

    if (!compResp.ok) {
        const errText = await compResp.text();
        if (compResp.status === 401) {
            writeSession({ bearerToken: '' }); // invalidate
        }
        throw new Error(`Kimi Completion failed: ${compResp.status} ${errText}`);
    }

    const reader = compResp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';

    const parseLine = (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload) return;
        try {
            const data = JSON.parse(payload);
            if (data.event === 'cmpl' || data.event === 'text') {
                const delta = data.text || '';
                if (delta) {
                    fullContent += delta;
                    if (typeof onChunk === 'function') onChunk(delta);
                }
            } else if (data.event === 'error') {
                console.error("Kimi stream error:", data);
                if (!fullContent) fullContent = `Error: ${data.message || JSON.stringify(data)}`;
            } else {
                console.log("Kimi event:", data.event);
            }
        } catch (e) {
            console.error("Kimi parse error:", e.message, "Payload:", payload);
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            parseLine(line);
        }
    }
    
    if (buffer.trim()) parseLine(buffer.trim());

    return {
        id: `chatcmpl-kimi-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        provider: KIMI_PROVIDER_ID,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: fullContent || ''
            },
            finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        chatId: sessionId
    };
}
