import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { SESSION_DIR } from '../config.js';
import { logInfo, logWarn } from '../logger/index.js';
import { resolveBrowserExecutable } from '../utils/browserExecutable.js';
import { getActiveProvider, getProviderAuthMode } from './activeProvider.js';

puppeteer.use(StealthPlugin());

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://chat.deepseek.com';
const DEEPSEEK_API_BASE = `${DEEPSEEK_BASE_URL}/api/v0`;
const DEEPSEEK_PROVIDER_ID = 'deepseek';
const DEEPSEEK_SESSION_DIR = path.resolve(process.cwd(), SESSION_DIR, 'deepseek');
const DEEPSEEK_SESSION_FILE = path.join(DEEPSEEK_SESSION_DIR, 'session.json');
const DEEPSEEK_PROFILE_DIR = path.join(DEEPSEEK_SESSION_DIR, 'browser-profile');
const DEFAULT_DEEPSEEK_MODEL = process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-chat';
const DEEPSEEK_USER_AGENT = process.env.DEEPSEEK_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DEEPSEEK_WASM_URL = 'https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm';

let lastChatSessionId = null;
let lastParentMessageId = null;

const DEEPSEEK_MODELS = [
    {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        object: 'model',
        created: 0,
        owned_by: 'deepseek',
        provider: DEEPSEEK_PROVIDER_ID,
        account_required: true,
        guest_available: false,
        permission: []
    },
    {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        object: 'model',
        created: 0,
        owned_by: 'deepseek',
        provider: DEEPSEEK_PROVIDER_ID,
        account_required: true,
        guest_available: false,
        permission: []
    }
];

function ensureSessionDir() {
    if (!fs.existsSync(DEEPSEEK_SESSION_DIR)) {
        fs.mkdirSync(DEEPSEEK_SESSION_DIR, { recursive: true });
    }
}

function isTruthy(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

import { TokenManager } from '../api/tokenManager.js';
export const deepseekTokenManager = new TokenManager('deepseek');

function getUsableBearerToken(tokenObj) {
    if (!tokenObj) return '';
    return tokenObj.token || tokenObj.bearerToken || '';
}

function getDeepSeekAuthMode() {
    return getProviderAuthMode(DEEPSEEK_PROVIDER_ID);
}

function isDeepSeekGuestMode() {
    return getDeepSeekAuthMode() === 'guest';
}

function cleanBearerHeader(value = '') {
    const token = String(value || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || ['null', 'undefined'].includes(token.toLowerCase())) return '';
    return token;
}

export async function authorizeDeepSeekInteractive() {
    ensureSessionDir();
    fs.mkdirSync(DEEPSEEK_PROFILE_DIR, { recursive: true });
    logInfo('Starting DeepSeek interactive authorization in visible browser...');
    
    let capturedHeaders = {};
    const executablePath = resolveBrowserExecutable();
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: executablePath || undefined,
        userDataDir: DEEPSEEK_PROFILE_DIR,
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
    await page.setUserAgent(DEEPSEEK_USER_AGENT);

    page.on('request', request => {
        if (request.url().includes(`${DEEPSEEK_BASE_URL}/api/`)) {
            const h = request.headers();
            const keys = ['authorization', 'x-app-version', 'x-client-version', 'x-client-platform', 'x-client-locale', 'x-hif-dliq', 'x-hif-leim'];
            for (const key of keys) {
                if (h[key]) capturedHeaders[key] = h[key];
            }
        }
    });

    await page.goto(DEEPSEEK_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
    console.log('------------------------------------------------------');
    console.log(' DeepSeek Chat authorization');
    console.log(` Browser profile: ${DEEPSEEK_PROFILE_DIR}`);
    console.log('------------------------------------------------------');
    console.log('1. Sign in to https://chat.deepseek.com in the opened browser.');
    console.log('2. If verification appears, complete it manually.');
    console.log('3. Send one short test prompt in the official web chat and wait until the answer starts.');
    console.log('4. Return here and press ENTER.');
    console.log('------------------------------------------------------');
    await new Promise(resolve => {
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', () => {
            process.stdin.pause();
            resolve();
        });
    });

    const cookies = await page.cookies(DEEPSEEK_BASE_URL);
    const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    const currentTokens = deepseekTokenManager.listTokens();
    const current = currentTokens.length > 0 ? currentTokens[0] : {};
    const capturedBearer = cleanBearerHeader(capturedHeaders['authorization']);
    const bearerToken = capturedBearer || process.env.DEEPSEEK_BEARER_TOKEN || getUsableBearerToken(current);
    
    const tokenObj = {
        id: 'legacy-deepseek',
        token: bearerToken,
        cookieHeader,
        bearerTokenSource: capturedBearer ? 'request-header' : (process.env.DEEPSEEK_BEARER_TOKEN ? 'env' : current.bearerTokenSource),
        appVersion: capturedHeaders['x-app-version'] || current.appVersion || '',
        clientVersion: capturedHeaders['x-client-version'] || current.clientVersion || '',
        clientPlatform: capturedHeaders['x-client-platform'] || current.clientPlatform || 'web',
        clientLocale: capturedHeaders['x-client-locale'] || current.clientLocale || 'en_US',
        hifDliq: capturedHeaders['x-hif-dliq'] || current.hifDliq || '',
        hifLeim: capturedHeaders['x-hif-leim'] || current.hifLeim || ''
    };
    
    deepseekTokenManager.saveTokens([tokenObj]);
    
    console.log('------------------------------------------------------');
    if (bearerToken) {
        console.log(' Successfully captured DeepSeek token!');
    } else {
        console.log(' Failed to capture Bearer token. Account might be invalid.');
    }
    console.log('------------------------------------------------------');
    
    await browser.close();
}

export async function closeDeepSeekBrowser() {
    // No-op, browser runs only during authorize
}

export function getDeepSeekSessionStatus() {
    const accountSessionAvailable = deepseekTokenManager.hasValidTokens();
    const authMode = getDeepSeekAuthMode();
    const authenticated = authMode === 'account' && accountSessionAvailable;
    return {
        provider: DEEPSEEK_PROVIDER_ID,
        domain: DEEPSEEK_BASE_URL,
        authMode,
        available: authenticated,
        authenticated: authenticated,
        accountSessionAvailable: accountSessionAvailable,
        accountRequired: authMode === 'account',
        guest: authMode === 'guest',
        guestAvailable: false,
        hasCookie: accountSessionAvailable,
        hasBearerToken: accountSessionAvailable,
        hasPowResponse: false,
        capabilities: {
            models: authenticated,
            chatCompletions: authenticated,
            accountChatCompletions: authenticated,
            guestChatCompletions: false
        },
        savedAt: null,
        message: authenticated ? 'DeepSeek session is available.' : 'DeepSeek session is missing or expired.'
    };
}

export function getDeepSeekModels() {
    return DEEPSEEK_MODELS;
}

export function getDefaultDeepSeekModel() {
    return DEFAULT_DEEPSEEK_MODEL;
}

export function isDeepSeekModel(model = '') {
    return String(model).toLowerCase().startsWith('deepseek');
}

export function shouldUseDeepSeekProvider(body = {}) {
    const provider = String(body.provider || body?.metadata?.provider || '').toLowerCase();
    if (['deepseek', 'ds'].includes(provider)) return true;
    if (['qwen', 'zai', 'glm'].includes(provider)) return false;
    if (isDeepSeekModel(body.model || '')) return true;
    return getActiveProvider() === 'deepseek';
}

function getDeepSeekHeaders(session) {
    const headers = {
        'Accept': '*/*',
        'Content-Type': 'application/json',
        'Accept-Language': process.env.DEEPSEEK_ACCEPT_LANGUAGE || 'en-US,en;q=0.9',
        'User-Agent': DEEPSEEK_USER_AGENT,
        'X-Client-Locale': session.clientLocale || 'ru_RU',
        'X-Client-Platform': session.clientPlatform || 'web',
        'X-Client-Version': session.clientVersion || '2.0.0',
        'Origin': DEEPSEEK_BASE_URL,
        'Referer': DEEPSEEK_BASE_URL + '/'
    };
    if (session.appVersion) headers['X-App-Version'] = session.appVersion;
    if (session.hifDliq) headers['x-hif-dliq'] = session.hifDliq;
    if (session.hifLeim) headers['x-hif-leim'] = session.hifLeim;
    if (session.cookieHeader) headers['Cookie'] = session.cookieHeader;
    
    const bearerToken = getUsableBearerToken(session);
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
    return headers;
}

async function solveDeepSeekPOW(challengeParams) {
    const resp = await fetch(DEEPSEEK_WASM_URL);
    if (!resp.ok) throw new Error(`WASM fetch failed: ${resp.status}`);
    const wasmBytes = await resp.arrayBuffer();
    const mod = await WebAssembly.instantiate(wasmBytes, { wbg: {} });
    const e = mod.instance.exports;
    const encoder = new TextEncoder();
    const prefix = challengeParams.salt + '_' + challengeParams.expire_at + '_';
    const cBytes = encoder.encode(challengeParams.challenge);
    const pBytes = encoder.encode(prefix);
    
    const cP = e.__wbindgen_export_0(cBytes.length, 1) >>> 0;
    const pP = e.__wbindgen_export_0(pBytes.length, 1) >>> 0;
    new Uint8Array(e.memory.buffer, cP, cBytes.length).set(cBytes);
    new Uint8Array(e.memory.buffer, pP, pBytes.length).set(pBytes);
    
    const sp = e.__wbindgen_add_to_stack_pointer(-16);
    e.wasm_solve(sp, cP, cBytes.length, pP, pBytes.length, challengeParams.difficulty);
    
    const dv = new DataView(e.memory.buffer);
    const code = dv.getInt32(sp, true);
    const ans = dv.getFloat64(sp + 8, true);
    e.__wbindgen_add_to_stack_pointer(16);
    
    if (code === 0 || !Number.isFinite(ans) || ans <= 0) {
        throw new Error('POW failed: ' + code);
    }
    return Math.floor(ans);
}

async function createDeepSeekChatSession(headers) {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat_session/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ character_id: null })
    });
    if (!response.ok) throw new Error(`Failed to create chat session: ${response.status} ${await response.text()}`);
    const json = await response.json();
    const id = json?.data?.biz_data?.chat_session?.id ||
        json?.data?.biz_data?.chat_session_id ||
        json?.data?.biz_data?.id ||
        json?.data?.id;
    if (!id) throw new Error(`DeepSeek did not return chat session id`);
    lastChatSessionId = id;
    lastParentMessageId = null;
    return id;
}

function contentToText(content) {
    if (content === null || content === undefined) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(item => {
            if (typeof item === 'string') return item;
            if (item?.type === 'text') return item.text || '';
            if (item?.type === 'image_url') return `[image: ${item.image_url?.url || ''}]`;
            return item?.text || item?.content || '';
        }).filter(Boolean).join('\n');
    }
    return JSON.stringify(content);
}

function messagesToPrompt(messages = []) {
    const parts = [];
    for (const message of messages) {
        if (!message || message.role === 'assistant') continue;
        const text = contentToText(message.content).trim();
        if (!text) continue;
        if (message.role === 'system') parts.push(`System instruction:\n${text}`);
        else if (message.role === 'tool') parts.push(`Tool result:\n${text}`);
        else parts.push(text);
    }
    return parts.join('\n\n').trim();
}

export async function sendDeepSeekChatCompletion({ messages, model = DEFAULT_DEEPSEEK_MODEL, stream = false, onChunk = null, chatId = null, parentId = null }) {
    if (isDeepSeekGuestMode()) {
        throw new Error('DeepSeek guest mode is not supported. Use account mode.');
    }
    const session = await deepseekTokenManager.getAvailableToken();
    if (!session) {
        throw new Error('DeepSeek account session is missing. Run `npm run deepseek:auth` first.');
    }

    const prompt = messagesToPrompt(messages);
    if (!prompt) throw new Error('DeepSeek request has no user text.');

    const headers = getDeepSeekHeaders(session);

    const chalResp = await fetch(`${DEEPSEEK_API_BASE}/chat/create_pow_challenge`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ target_path: '/api/v0/chat/completion' })
    });
    if (!chalResp.ok) throw new Error(`POW Challenge failed: ${chalResp.status} ${await chalResp.text()}`);
    const chalJson = await chalResp.json();
    if (!chalJson?.data?.biz_data?.challenge) throw new Error('Invalid POW challenge response from DeepSeek');
    const challenge = chalJson.data.biz_data.challenge;

    const answer = await solveDeepSeekPOW(challenge);

    const powB64 = Buffer.from(JSON.stringify({
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        salt: challenge.salt,
        answer: answer,
        signature: challenge.signature,
        target_path: '/api/v0/chat/completion'
    })).toString('base64');
    
    headers['X-DS-PoW-Response'] = powB64;

    const sessionId = chatId || lastChatSessionId || await createDeepSeekChatSession(headers);
    
    const reqBody = {
        chat_session_id: sessionId,
        parent_message_id: parentId || lastParentMessageId || null,
        prompt,
        ref_file_ids: [],
        thinking_enabled: model === 'deepseek-reasoner' || isTruthy(process.env.DEEPSEEK_THINKING),
        search_enabled: isTruthy(process.env.DEEPSEEK_SEARCH),
        model_type: 'default'
    };

    const compResp = await fetch(`${DEEPSEEK_API_BASE}/chat/completion`, {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody)
    });

    if (!compResp.ok) {
        throw new Error(`DeepSeek Completion failed: ${compResp.status} ${await compResp.text()}`);
    }

    const reader = compResp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    let fullContent = '';
    let fullReasoning = '';
    let finalParentId = null;

    let currentTarget = 'IGNORE';

    const parseLine = (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
            const data = JSON.parse(payload);
            const eventError = data?.error || data?.data?.error;
            if (eventError) {
                return;
            }

            let deltaContent = '';
            let deltaReasoning = '';

            // 1. Classic format fallback
            const biz = data?.biz_data || data;
            const choices = biz?.choices || data?.choices;
            if (choices && choices[0]) {
                const delta = choices[0]?.delta || choices[0]?.message;
                if (delta?.content) deltaContent += delta.content;
                if (delta?.reasoning_content) deltaReasoning += delta.reasoning_content;
                if (delta?.content) currentTarget = 'RESPONSE';
            }

            // 2. New JSONPatch format (Bytedance-like)
            if (data.v?.response?.fragments) {
                for (const f of data.v.response.fragments) {
                    if (f.type === 'THINKING' && f.content) {
                        deltaReasoning += f.content;
                    } else if (f.content) {
                        deltaContent += f.content;
                    }
                }
                currentTarget = 'RESPONSE'; // Implicitly usually ends with response
            }

            if (data.p) {
                if (data.p.includes('reasoning') || data.p.includes('thinking')) currentTarget = 'THINKING';
                else if (data.p.includes('content')) currentTarget = 'RESPONSE';
                else currentTarget = 'IGNORE';
            }

            if (typeof data.v === 'string' && (!data.p || data.p.includes('content') || data.p.includes('thinking') || data.p.includes('reasoning'))) {
                if (currentTarget === 'THINKING') deltaReasoning += data.v;
                else if (currentTarget === 'RESPONSE') deltaContent += data.v;
            }

            if (deltaContent) {
                fullContent += deltaContent;
                if (typeof onChunk === 'function') onChunk(deltaContent);
            }
            if (deltaReasoning) {
                fullReasoning += deltaReasoning;
                // We don't stream reasoning right now to `onChunk` because the client might not expect it,
                // but we accumulate it for the final response
            }

            finalParentId = data.v?.response?.message_id || biz?.message_id || data?.message_id || data?.id || finalParentId;
        } catch {
            // ignore JSON error
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

    if (finalParentId) lastParentMessageId = finalParentId;

    return {
        id: `chatcmpl-deepseek-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        provider: DEEPSEEK_PROVIDER_ID,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: fullContent || fullReasoning || '',
                ...(fullReasoning ? { reasoning_content: fullReasoning } : {})
            },
            finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        chatId: sessionId,
        parentId: finalParentId || lastParentMessageId || null
    };
}
