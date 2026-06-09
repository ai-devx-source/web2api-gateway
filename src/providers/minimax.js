import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { SESSION_DIR } from '../config.js';
import { logInfo, logWarn, logError } from '../logger/index.js';
import { resolveBrowserExecutable } from '../utils/browserExecutable.js';
import { getActiveProvider, getProviderAuthMode, getProviderTransportMode, getHeadlessMode } from './activeProvider.js';
import { TokenManager } from '../api/tokenManager.js';

puppeteer.use(StealthPlugin());

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://agent.minimax.io';
const MINIMAX_PROVIDER_ID = 'minimax';
const MINIMAX_SESSION_DIR = path.resolve(process.cwd(), SESSION_DIR, 'minimax');
const MINIMAX_PROFILE_DIR = path.join(MINIMAX_SESSION_DIR, 'browser-profile');
const DEFAULT_MINIMAX_MODEL = process.env.MINIMAX_DEFAULT_MODEL || 'MiniMax-M2.7';
const MINIMAX_USER_AGENT = process.env.MINIMAX_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

export const minimaxTokenManager = new TokenManager('minimax');

const MINIMAX_MODELS = [
    { id: 'MiniMax-M3', name: 'MiniMax M3', object: 'model', created: 0, owned_by: 'minimax', provider: 'minimax', account_required: true, guest_available: false, permission: [] },
    { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', object: 'model', created: 0, owned_by: 'minimax', provider: 'minimax', account_required: true, guest_available: false, permission: [] },
    { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', object: 'model', created: 0, owned_by: 'minimax', provider: 'minimax', account_required: true, guest_available: false, permission: [] }
];

const MINIMAX_MODEL_PREFIXES = ['minimax-', 'MiniMax-'];

function ensureSessionDir() {
    if (!fs.existsSync(MINIMAX_SESSION_DIR)) {
        fs.mkdirSync(MINIMAX_SESSION_DIR, { recursive: true });
    }
}

function getMinimaxAuthMode() {
    return getProviderAuthMode(MINIMAX_PROVIDER_ID);
}

function getMinimaxTransportMode() {
    return getProviderTransportMode(MINIMAX_PROVIDER_ID);
}

function isMinimaxGuestMode() {
    return getMinimaxAuthMode() === 'guest';
}

function md5(input) {
    return crypto.createHash('md5').update(input).digest('hex');
}

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function unixTimestamp() {
    return Math.floor(Date.now() / 1000);
}

const deviceInfoCache = new Map();
const DEVICE_INFO_EXPIRES = 10800; // 3 hours

const FAKE_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    'Origin': MINIMAX_BASE_URL,
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': MINIMAX_USER_AGENT
};

const FAKE_USER_DATA = {
    device_platform: 'web',
    biz_id: '3',
    app_id: '3001',
    version_code: '22201',
    uuid: null,
    device_id: null,
    os_name: 'Mac',
    browser_name: 'chrome',
    device_memory: 8,
    cpu_core_num: 11,
    browser_language: 'zh-CN',
    browser_platform: 'MacIntel',
    user_id: null,
    screen_width: 1920,
    screen_height: 1080,
    unix: null,
    lang: 'zh',
    token: null,
    timezone_offset: 28800,
    sys_language: 'zh',
    client: 'web'
};

async function requestDeviceInfo(jwtToken, realUserID) {
    const cacheKey = jwtToken;
    let result = deviceInfoCache.get(cacheKey);
    if (result && result.refreshTime > unixTimestamp()) {
        return result;
    }

    const randomUuid = uuid();
    const unix = String(Date.now());
    const timestamp = unixTimestamp();

    const userData = { ...FAKE_USER_DATA };
    userData.uuid = randomUuid;
    userData.user_id = realUserID;
    userData.unix = unix;
    userData.token = jwtToken;

    let queryStr = '';
    for (const key in userData) {
        if (userData[key] === undefined || userData[key] === null) continue;
        queryStr += `&${key}=${userData[key]}`;
    }

    const dataJson = JSON.stringify({ uuid: randomUuid });
    const fullUri = `/v1/api/user/device/register?${queryStr}`;
    const yy = md5(`${encodeURIComponent(fullUri)}_${dataJson}${md5(unix)}ooui`);
    const signature = md5(`${timestamp}${jwtToken}${dataJson}`);

    logInfo(`[MiniMax] Registering device - randomUuid: ${randomUuid}, realUserID: ${realUserID}`);

    const headers = {
        ...FAKE_HEADERS,
        'Content-Type': 'application/json',
        'Referer': `${MINIMAX_BASE_URL}/`,
        'token': jwtToken,
        'x-timestamp': String(timestamp),
        'x-signature': signature,
        'yy': yy
    };

    const response = await fetch(`${MINIMAX_BASE_URL}${fullUri}`, {
        method: 'POST',
        headers,
        body: dataJson
    });

    if (!response.ok) {
        throw new Error(`Failed to register MiniMax device: ${response.status} ${await response.text()}`);
    }

    const json = await response.json();
    if (json?.statusInfo?.code !== 0) {
        throw new Error(`Failed to register MiniMax device: ${json?.statusInfo?.message || JSON.stringify(json)}`);
    }

    const data = json.data;
    result = {
        deviceId: data?.deviceIDStr || '',
        userId: realUserID,
        realUserID: data?.realUserID || realUserID,
        jwtToken: jwtToken,
        refreshTime: unixTimestamp() + DEVICE_INFO_EXPIRES,
        uuid: randomUuid
    };

    console.log(result); deviceInfoCache.set(cacheKey, result);
    return result;
}

async function minimaxRequest(method, uri, bodyData, deviceInfo) {
    const unix = String(Date.now());
    const timestamp = unixTimestamp();

    const userData = { ...FAKE_USER_DATA };
    const realUserID = deviceInfo.realUserID || deviceInfo.userId;
    userData.uuid = realUserID;
    userData.device_id = deviceInfo.deviceId || undefined;
    userData.user_id = realUserID;
    userData.unix = unix;
    userData.token = deviceInfo.jwtToken;

    let queryStr = '';
    for (const key in userData) {
        if (userData[key] === undefined || userData[key] === null) continue;
        queryStr += `&${key}=${userData[key]}`;
    }
    queryStr = queryStr.substring(1); // remove leading &

    const dataJson = JSON.stringify(bodyData || {});
    const fullUri = `${uri}${uri.lastIndexOf('?') !== -1 ? '&' : '?'}${queryStr}`;
    const yy = md5(`${encodeURIComponent(fullUri)}_${dataJson}${md5(unix)}ooui`);
    const signature = md5(`${timestamp}${deviceInfo.jwtToken}${dataJson}`);

    const headers = {
        ...FAKE_HEADERS,
        'Content-Type': 'application/json',
        'Referer': `${MINIMAX_BASE_URL}/`,
        'token': deviceInfo.jwtToken,
        'x-timestamp': String(timestamp),
        'x-signature': signature,
        'yy': yy
    };

    return fetch(`${MINIMAX_BASE_URL}${fullUri}`, {
        method,
        headers,
        body: method === 'GET' ? undefined : dataJson
    });
}

export async function authorizeMinimaxInteractive() {
    ensureSessionDir();
    fs.mkdirSync(MINIMAX_PROFILE_DIR, { recursive: true });
    logInfo('Starting MiniMax interactive authorization...');

    let capturedToken = '';
    let capturedUserId = '';

    const executablePath = resolveBrowserExecutable();
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: executablePath || undefined,
        userDataDir: MINIMAX_PROFILE_DIR,
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
    await page.setUserAgent(MINIMAX_USER_AGENT);

    await page.evaluateOnNewDocument(() => {
        const originalEncode = window.encodeURIComponent;
        window.encodeURIComponent = function(str) {
            if (typeof str === 'string' && (str.includes('/v1/api/config/') || str.includes('send_msg'))) {
                console.log('--- ENCODE HOOK ---');
                console.log('URI:', str);
                console.log('-------------------');
            }
            return originalEncode.apply(this, arguments);
        };
        
        // Hook crypto subtle digest if they use WebCrypto
        if (window.crypto && window.crypto.subtle) {
            const originalDigest = window.crypto.subtle.digest;
            window.crypto.subtle.digest = async function(algo, data) {
                const result = await originalDigest.apply(this, arguments);
                try {
                    const decoded = new TextDecoder().decode(data);
                    if (decoded.includes('/v1/api/config') || decoded.includes('send_msg')) {
                        console.log('--- HASH HOOK ---');
                        console.log('Hashing:', decoded);
                        console.log('-----------------');
                    }
                } catch(e) {}
                return result;
            };
        }
    });

    page.on('console', msg => {
        if (msg.text().includes('HOOK')) {
            console.log('\x1b[33m[BROWSER HOOK]\x1b[0m', msg.text());
        } else if (msg.text().includes('URI:') || msg.text().includes('Hashing:')) {
            console.log('\x1b[32m[BROWSER DATA]\x1b[0m', msg.text());
        }
    });

    page.on('request', request => {
        const url = request.url();
        if (url.includes('/api/') || url.includes('/matrix/')) {
            const h = request.headers();
            if (h['token']) capturedToken = h['token'];
            if (h['yy']) {
                console.log('\x1b[36m[OBSERVED yy]\x1b[0m', h['yy']);
            }
            if (h['x-signature']) {
                console.log('\x1b[36m[OBSERVED x-signature]\x1b[0m', h['x-signature']);
            }
            
            try {
                const urlObj = new URL(url);
                const uid = urlObj.searchParams.get('user_id');
                if (uid && uid !== 'null' && uid !== 'undefined') {
                    capturedUserId = uid;
                }
            } catch (e) {}
        }
    });

    await page.goto(MINIMAX_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
    console.log('------------------------------------------------------');
    console.log(' MiniMax Chat authorization');
    console.log('------------------------------------------------------');
    console.log('1. Sign in to https://agent.minimaxi.com in the opened browser.');
    console.log('2. Send one short test prompt in the web chat and wait for a response.');
    console.log('   Watch this console to see hooked salt values!');
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

    if (!capturedToken) {
        console.log('Failed to capture JWT Token. Did you send a test message?');
    } else {
        const tokenObj = {
            id: 'legacy-minimax',
            token: capturedToken,
            realUserID: capturedUserId
        };
        minimaxTokenManager.saveTokens([tokenObj]);
        console.log('Successfully captured MiniMax Token and UserID!');
    }

    await browser.close().catch(() => {});
}

export function getMinimaxSessionStatus() {
    const accountSessionAvailable = minimaxTokenManager.hasValidTokens();
    const authMode = getMinimaxAuthMode();
    const authenticated = authMode === 'account' && accountSessionAvailable;
    
    return {
        provider: MINIMAX_PROVIDER_ID,
        domain: MINIMAX_BASE_URL,
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
        message: authenticated ? 'MiniMax session is available.' : 'MiniMax requires authentication.'
    };
}

export function getMinimaxModels() { return MINIMAX_MODELS; }
export function getDefaultMinimaxModel() { return DEFAULT_MINIMAX_MODEL; }
export function isMinimaxModel(model = '') {
    const lowerModel = String(model).toLowerCase();
    return MINIMAX_MODEL_PREFIXES.some(prefix => lowerModel.startsWith(prefix.toLowerCase()));
}
export function shouldUseMinimaxProvider(body = {}) {
    const provider = String(body.provider || body?.metadata?.provider || '').toLowerCase();
    if (['minimax', 'mm'].includes(provider)) return true;
    if (['qwen', 'zai', 'glm', 'deepseek', 'ds', 'kimi', 'moonshot'].includes(provider)) return false;
    if (isMinimaxModel(body.model || '')) return true;
    return getActiveProvider() === 'minimax';
}

function contentToText(content) {
    if (content === null || content === undefined) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(item => {
            if (typeof item === 'string') return item;
            if (item?.type === 'text') return item.text || '';
            return item?.text || item?.content || '';
        }).filter(Boolean).join('\\n');
    }
    return JSON.stringify(content);
}

function messagesToPrompt(messages = []) {
    let content = '';
    const otherMessages = [];
    let systemContent = '';

    for (const msg of messages) {
        if (!msg) continue;
        const text = contentToText(msg.content).trim();
        if (!text) continue;
        
        if (msg.role === 'system') {
            systemContent += (systemContent ? '\\n\\n' : '') + text;
        } else {
            otherMessages.push({ role: msg.role === 'tool' ? 'user' : msg.role, text });
        }
    }

    if (systemContent) {
        content += `<system_instructions>\\n${systemContent}\\n</system_instructions>\\n`;
    }

    if (otherMessages.length > 0) {
        for (const msg of otherMessages) {
            content += `${msg.role}:${msg.text}\\n`;
        }
    } else {
        content += 'user: \\n';
    }

    content += 'assistant:\\n';
    content = content.trim();

    return {
        msg_type: 1,
        text: content,
        chat_type: 1,
        attachments: [],
        selected_mcp_tools: [],
        backend_config: {},
        sub_agent_ids: []
    };
}

function messagesToTextProxy(messages = []) {
    let content = '';
    for (const msg of messages) {
        if (!msg) continue;
        const text = contentToText(msg.content).trim();
        if (!text) continue;
        content += `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${text}\n\n`;
    }
    return content.trim();
}

async function sendMinimaxChatCompletionDomProxy({ messages, model = DEFAULT_MINIMAX_MODEL, stream = false, onChunk = null, chatId = null }) {
    ensureSessionDir();
    
    const executablePath = resolveBrowserExecutable();
    const headlessMode = getHeadlessMode();
    const browser = await puppeteer.launch({
        headless: headlessMode,
        executablePath: executablePath || undefined,
        userDataDir: MINIMAX_PROFILE_DIR,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(MINIMAX_USER_AGENT);

        // --- Auth injection ---
        // Navigate to a blank page on the target domain first to set localStorage
        const domainBase = MINIMAX_BASE_URL.includes('agent.minimax.io')
            ? 'https://agent.minimax.io'
            : MINIMAX_BASE_URL;
        
        const tokenObj = await minimaxTokenManager.getAvailableToken();
        if (tokenObj && tokenObj.token) {
            logInfo('[MiniMax] Injecting JWT token into localStorage for DOM proxy...');
            await page.goto(`${domainBase}/404`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            await page.evaluate((token, uid) => {
                localStorage.setItem('_token', token);
                if (uid) localStorage.setItem('user_detail_agent', JSON.stringify({ realUserID: uid }));
            }, tokenObj.token, tokenObj.realUserID || tokenObj.userId || null);
        }

        // --- Navigate to chat ---
        let targetUrl;
        if (MINIMAX_BASE_URL.includes('agent.minimax.io')) {
            targetUrl = `${domainBase}/mavis?id=407176432079153`;
        } else {
            targetUrl = `${MINIMAX_BASE_URL}/`;
        }
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Give the SPA time to render
        await new Promise(r => setTimeout(r, 5000));
        
        const textPrompt = messagesToTextProxy(messages);
        
        // Wait for textarea
        await page.waitForSelector('[data-testid="message-textarea"]', { timeout: 30000 });
        
        // Focus and type using execCommand (works with ProseMirror/Tiptap)
        await page.click('[data-testid="message-textarea"]');
        await new Promise(r => setTimeout(r, 300));
        
        const inserted = await page.evaluate((text) => {
            const el = document.querySelector('[data-testid="message-textarea"]');
            if (!el) return false;
            el.focus();
            return document.execCommand('insertText', false, text);
        }, textPrompt);
        
        if (!inserted) {
            // Fallback: type character by character
            await page.type('[data-testid="message-textarea"]', textPrompt, { delay: 20 });
        }
        
        await new Promise(r => setTimeout(r, 500));
        
        // Verify text was entered and send button is active
        const canSend = await page.evaluate(() => {
            const btn = document.querySelector('[data-testid="send-button"]');
            return btn && btn.getAttribute('aria-disabled') !== 'true';
        });
        
        if (canSend) {
            logInfo('[MiniMax] Clicking send button...');
            await page.click('[data-testid="send-button"]');
        } else {
            logInfo('[MiniMax] Send button disabled, pressing Enter...');
            await page.keyboard.press('Enter');
        }

        // Brief wait after send
        await new Promise(r => setTimeout(r, 2000));

        let fullContent = '';
        let done = false;
        const maxPolls = 120;
        let pollCount = 0;
        let responseContent = '';
        
        // Count initial bubbles
        const initialBubblesCount = (await page.$$('div.markdown-body, div.matrix-markdown.message-content')).length;

        while (pollCount < maxPolls) {
            await new Promise(r => setTimeout(r, 1000));
            pollCount++;

            try {
                // Wait for response bubble to appear
                const bubbles = await page.$$('div.markdown-body, div.matrix-markdown.message-content');
                if (bubbles.length > initialBubblesCount) {
                    const lastBubble = bubbles[bubbles.length - 1];
                    const currentContent = await page.evaluate(el => el.innerText, lastBubble);
                    
                    if (currentContent && currentContent.length > responseContent.length) {
                        const newChunk = currentContent.substring(responseContent.length);
                        responseContent = currentContent;
                        fullContent = currentContent;
                        
                        if (stream) {
                            onChunk({ content: newChunk, role: 'assistant' });
                        }
                    }
                }
                
                // Check if generation is finished
                const isGenerating = await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    // Check for Stop button or any button that indicates generation is still in progress
                    return btns.some(b => (b.innerText && b.innerText.includes('Stop')) || b.querySelector('svg circle.animate-spin') || b.getAttribute('data-testid') === 'stop-button');
                });
                
                if (bubbles.length > initialBubblesCount && !isGenerating && pollCount > 4 && responseContent.length > 0) {
                    done = true;
                    break;
                }
            } catch (e) {
                // ignore execution context destroyed errors during navigation
                if (e.message.includes('Execution context was destroyed') || e.message.includes('detached Frame')) continue;
                console.error('[MiniMax] Polling error:', e.message);
            }
        }

        return {
            id: `chatcmpl-minimax-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            provider: MINIMAX_PROVIDER_ID,
            choices: [{
                index: 0,
                message: { role: 'assistant', content: fullContent },
                finish_reason: 'stop'
            }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            chatId: chatId || `proxy-${Date.now()}`
        };
    } finally {
        await browser.close().catch(() => {});
    }
}

export async function sendMinimaxChatCompletion({ messages, model = DEFAULT_MINIMAX_MODEL, stream = false, onChunk = null, chatId = null }) {
    if (isMinimaxGuestMode()) {
        throw new Error('MiniMax guest mode is not supported. Use account mode.');
    }
    
    let transportMode = getMinimaxTransportMode();
    if (MINIMAX_BASE_URL.includes('agent.minimax.io')) {
        logInfo('[MiniMax] Forcing DOM Proxy mode because native Archon API signature generation is currently unsupported.');
        transportMode = 'dom';
    }

    if (transportMode === 'dom') {
        logInfo('[MiniMax] Routing request via Browser DOM Proxy');
        return sendMinimaxChatCompletionDomProxy({ messages, model, stream, onChunk, chatId });
    }

    logInfo('[MiniMax] Routing request via Native API');
    
    const sessionToken = await minimaxTokenManager.getAvailableToken();
    if (!sessionToken || !sessionToken.token) {
        throw new Error('MiniMax auth missing. Run `npm run minimax:auth`.');
    }

    const jwtToken = sessionToken.token;
    let realUserID = sessionToken.realUserID;
    if (!realUserID) {
        try {
            const payload = JSON.parse(Buffer.from(jwtToken.split('.')[1], 'base64').toString());
            realUserID = payload?.user?.id || '';
        } catch(e) {}
    }
    if (!realUserID) {
        throw new Error('MiniMax User ID is missing in session. Please re-authenticate.');
    }

    const deviceInfo = await requestDeviceInfo(jwtToken, realUserID);
    const requestBody = messagesToPrompt(messages);
    // requestBody.model = model;

    let msgId = '';
    let finalChatId = chatId || '';

    if (finalChatId) {
        const sendResp = await minimaxRequest('POST', '/matrix/api/v1/chat/send_msg', { ...requestBody, chat_id: finalChatId }, deviceInfo);
        if (!sendResp.ok) {
            const t = await sendResp.text();
            console.error('SEND_MSG 401 RESP:', t);
            throw new Error(`MiniMax send_msg failed: ${sendResp.status} ${t}`);
        }
        const json = await sendResp.json();
        if (json.base_resp?.status_code !== 0) throw new Error(`MiniMax Error: ${json.base_resp?.status_msg}`);
        msgId = json.msg_id;
    } else {
        const sendResp = await minimaxRequest('POST', '/matrix/api/v1/chat/send_msg', requestBody, deviceInfo);
        if (!sendResp.ok) {
            const t = await sendResp.text();
            console.error('SEND_MSG 401 RESP:', t);
            throw new Error(`MiniMax send_msg failed: ${sendResp.status} ${t}`);
        }
        const json = await sendResp.json();
        if (json.base_resp?.status_code !== 0) throw new Error(`MiniMax Error: ${json.base_resp?.status_msg}`);
        finalChatId = json.chat_id;
        msgId = json.msg_id;
    }

    if (stream) {
        let fullContent = '';
        const maxPolls = 120;
        let pollCount = 0;
        let sentRole = false;
        
        while (pollCount < maxPolls) {
            await new Promise(r => setTimeout(r, 600));
            pollCount++;

            const detailResp = await minimaxRequest('POST', '/matrix/api/v1/chat/get_chat_detail', { chat_id: finalChatId }, deviceInfo);
            if (!detailResp.ok) continue;

            const json = await detailResp.json();
            if (json.base_resp?.status_code !== 0) continue;

            const aiMessages = (json.messages || []).filter(m => m.msg_type === 2);
            const latestMsg = aiMessages.length > 0 ? aiMessages[aiMessages.length - 1] : null;

            if (latestMsg && latestMsg.msg_id === msgId && latestMsg.msg_content !== undefined) {
                const currentContent = latestMsg.msg_content || '';
                if (currentContent.length > fullContent.length) {
                    const chunk = currentContent.substring(fullContent.length);
                    if (!sentRole && onChunk) {
                        onChunk('', 'assistant');
                        sentRole = true;
                    }
                    if (onChunk && chunk) onChunk(chunk);
                    fullContent = currentContent;
                }

                const status = json.chat?.chat_status || 0;
                if (status === 1 || status === 0) {
                    if (pollCount > 2) {
                        break;
                    }
                }
            }
        }
        
        return { error: null, model, chatId: finalChatId };
    } else {
        let finalContent = '';
        for (let i=0; i<60; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const detailResp = await minimaxRequest('POST', '/matrix/api/v1/chat/get_chat_detail', { chat_id: finalChatId }, deviceInfo);
            if (!detailResp.ok) continue;
            const json = await detailResp.json();
            
            const aiMessages = (json.messages || []).filter(m => m.msg_type === 2);
            const latestMsg = aiMessages.length > 0 ? aiMessages[aiMessages.length - 1] : null;

            if (latestMsg && latestMsg.msg_id === msgId) {
                finalContent = latestMsg.msg_content || '';
                const status = json.chat?.chat_status || 0;
                if (status === 1 || status === 0) {
                    break;
                }
            }
        }

        return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{
                index: 0,
                message: { role: 'assistant', content: finalContent },
                finish_reason: 'stop'
            }],
            chatId: finalChatId
        };
    }
}
