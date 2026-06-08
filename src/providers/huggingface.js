import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { SESSION_DIR } from '../config.js';
import { logInfo, logWarn } from '../logger/index.js';
import { resolveBrowserExecutable } from '../utils/browserExecutable.js';
import { getActiveProvider, getProviderAuthMode, getHeadlessMode } from './activeProvider.js';

puppeteer.use(StealthPlugin());

const HF_BASE_URL = 'https://huggingface.co/chat';
const HF_PROVIDER_ID = 'huggingface';
const HF_SESSION_DIR = path.resolve(process.cwd(), SESSION_DIR, 'huggingface');
const HF_SESSION_FILE = path.join(HF_SESSION_DIR, 'session.json');
const HF_PROFILE_DIR = path.join(HF_SESSION_DIR, 'browser-profile');
const DEFAULT_HF_MODEL = 'deepseek-ai/DeepSeek-V4-Pro';

let hfBrowser = null;
let hfPage = null;

const HF_MODELS = [
    { id: 'deepseek-ai/DeepSeek-V4-Pro', name: 'DeepSeek V4 Pro', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'Qwen/Qwen3.6-35B-A3B', name: 'Qwen 3.6 35B', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', name: 'Llama 4 Scout 17B', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'google/gemma-4-31B-it', name: 'Gemma 4 31B', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'CohereLabs/c4ai-command-a-03-2025', name: 'Command A (2025)', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'zai-org/GLM-5.1', name: 'GLM 5.1', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'moonshotai/Kimi-K2.6', name: 'Kimi K2.6', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'MiniMaxAI/MiniMax-M2.7', name: 'MiniMax M2.7', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', object: 'model', provider: HF_PROVIDER_ID }
];

function ensureSessionDir() {
    if (!fs.existsSync(HF_SESSION_DIR)) fs.mkdirSync(HF_SESSION_DIR, { recursive: true });
}

import { TokenManager } from '../api/tokenManager.js';
export const hfTokenManager = new TokenManager('huggingface');

export function isHuggingFaceModel(model = '') {
    return HF_MODELS.some(m => m.id === model) || String(model).toLowerCase().includes('llama') || String(model).toLowerCase().includes('qwen');
}

export function shouldUseHuggingFaceProvider(body = {}) {
    const provider = String(body.provider || body?.metadata?.provider || '').toLowerCase();
    if (['huggingface', 'hf'].includes(provider)) return true;
    if (['zai', 'deepseek', 'minimax'].includes(provider)) return false;
    return getActiveProvider() === 'huggingface';
}

export function getHuggingFaceModels() { return HF_MODELS; }
export function getDefaultHuggingFaceModel() { return DEFAULT_HF_MODEL; }

export function getHuggingFaceSessionStatus() {
    const hasCookie = hfTokenManager.hasValidTokens();
    
    return {
        provider: HF_PROVIDER_ID,
        domain: HF_BASE_URL,
        authMode: 'account',
        available: hasCookie,
        authenticated: hasCookie,
        accountSessionAvailable: hasCookie,
        accountRequired: true,
        guest: false,
        guestAvailable: false,
        hasCookie,
        capabilities: {
            models: true,
            chatCompletions: hasCookie,
            accountChatCompletions: hasCookie,
            guestChatCompletions: false
        },
        savedAt: null,
        message: hasCookie ? 'HuggingFace session is ready.' : 'Run `npm run hf:auth` to authorize.'
    };
}

async function initHuggingFaceBrowser() {
    if (hfBrowser && hfPage) return;
    ensureSessionDir();
    const executablePath = resolveBrowserExecutable();
    hfBrowser = await puppeteer.launch({
        headless: getHeadlessMode() ?? true,
        executablePath: executablePath || undefined,
        userDataDir: HF_PROFILE_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });
    const pages = await hfBrowser.pages();
    hfPage = pages[0] || await hfBrowser.newPage();
    
    if (!global.hfChunkCallbacks) {
        global.hfChunkCallbacks = {};
        await hfPage.exposeFunction('onHfChunk', (reqId, chunk) => {
            if (global.hfChunkCallbacks[reqId]) {
                global.hfChunkCallbacks[reqId](chunk);
            }
        });
        await hfPage.exposeFunction('onHfError', (reqId, err) => {
            if (global.hfChunkCallbacks[reqId]) {
                global.hfChunkCallbacks[reqId](err, true);
            }
        });
    }

    await hfPage.goto(HF_BASE_URL, { waitUntil: 'domcontentloaded' });
}

export async function authorizeHuggingFaceInteractive() {
    ensureSessionDir();
    if (hfBrowser) {
        await hfBrowser.close().catch(() => {});
        hfBrowser = null;
        hfPage = null;
    }
    const executablePath = resolveBrowserExecutable();
    hfBrowser = await puppeteer.launch({
        headless: false,
        executablePath: executablePath || undefined,
        userDataDir: HF_PROFILE_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    const pages = await hfBrowser.pages();
    hfPage = pages[0] || await hfBrowser.newPage();
    await hfPage.goto(HF_BASE_URL, { waitUntil: 'domcontentloaded' });

    console.log('------------------------------------------------------');
    console.log(' HuggingFace Chat authorization');
    console.log('------------------------------------------------------');
    console.log('1. Sign in to https://huggingface.co/chat in the opened browser.');
    console.log('2. Return here and press ENTER.');
    console.log('------------------------------------------------------');
    
    await new Promise(resolve => {
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', () => {
            process.stdin.pause();
            resolve();
        });
    });

    const cookies = await hfPage.cookies(HF_BASE_URL);
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const tokenObj = {
        id: 'legacy-huggingface',
        token: cookieHeader, // HF uses cookie
        cookieHeader
    };
    hfTokenManager.saveTokens([tokenObj]);
    
    await hfBrowser.close();
    hfBrowser = null;
    
    if (!cookieHeader.includes('hf-chat')) {
        throw new Error('Could not find hf-chat cookie. Please make sure you are signed in.');
    }
    return tokenObj;
}

export async function sendHuggingFaceChatCompletion({ messages, model = DEFAULT_HF_MODEL, stream = false, onChunk = null }) {
    const session = await hfTokenManager.getAvailableToken();
    if (!session || !session.cookieHeader || !session.cookieHeader.includes('hf-chat')) {
        throw new Error('Missing HuggingFace session. Run `npm run hf:auth` first.');
    }

    await initHuggingFaceBrowser();

    // Inject cookies into the browser context to ensure authentication
    const cookiesArray = session.cookieHeader.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return { name, value: rest.join('='), domain: '.huggingface.co', path: '/' };
    });
    await hfPage.setCookie(...cookiesArray);
    
    // Ensure we are on the chat page to execute authenticated fetch requests
    if (!hfPage.url().includes('/chat')) {
        await hfPage.goto('https://huggingface.co/chat/', { waitUntil: 'domcontentloaded' });
    }

    const prompt = messages.map(m => m.content).join('\n\n');
    const payload = {
        inputs: prompt,
        id: crypto.randomUUID(),
        is_retry: false,
        is_continue: false,
        web_search: false,
        tools: [],
        files: []
    };

    const reqId = crypto.randomUUID();
    let content = '';
    let error = null;

    global.hfChunkCallbacks[reqId] = (data, isError = false) => {
        if (isError) {
            error = data;
        } else {
            content += data;
            if (data && onChunk) onChunk(data);
        }
    };

    logInfo(`[HuggingFace] Processing via pure DOM interaction...`);

    try {
        // Wait for page load and dismiss any welcome modals (e.g. "Start chatting" Omni modal)
        await hfPage.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const startBtn = btns.find(b => b.innerText && b.innerText.includes('Start chatting'));
            if (startBtn) startBtn.click();
        });

        await hfPage.waitForSelector('textarea', { timeout: 15000 });
        
        // Wait for generation to be idle before typing (if continuing a chat)
        await hfPage.waitForFunction(() => {
            const btn = document.querySelector('button[type="submit"], button[name="submit"]');
            return btn !== null;
        }, { timeout: 10000 });

        // Clear textarea if needed
        await hfPage.evaluate(() => {
            const ta = document.querySelector('textarea');
            if (ta) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
        });

        // Type the prompt like a human
        await hfPage.type('textarea', prompt, { delay: 5 });

        // Wait for submit to be enabled
        await hfPage.waitForFunction(() => {
            const btn = document.querySelector('button[type="submit"], button[name="submit"]');
            return btn && !btn.disabled;
        }, { timeout: 10000 });

        // Click submit
        await hfPage.click('button[type="submit"], button[name="submit"]');

        // Evaluate scraping loop
        await hfPage.evaluate(async (reqId) => {
            try {
                let isDone = false;
                let lastContent = '';
                let idleLoops = 0;
                
                while (!isDone) {
                    await new Promise(r => setTimeout(r, 300));
                    
                    const blocks = document.querySelectorAll('.prose');
                    if (blocks && blocks.length > 0) {
                        const lastBlock = blocks[blocks.length - 1];
                        const currentContent = lastBlock.innerText;
                        
                        if (currentContent && currentContent !== lastContent) {
                            const delta = currentContent.slice(lastContent.length);
                            lastContent = currentContent;
                            await window.onHfChunk(reqId, delta);
                            idleLoops = 0;
                        } else {
                            idleLoops++;
                        }
                    }
                    
                    // Generation is done if:
                    // 1. We have received some text AND it hasn't changed for 3 seconds (10 loops).
                    // 2. OR we see the "Stop generating" button disappear (tricky to track without exact selector).
                    // The safest fallback is idle loops.
                    if (lastContent.length > 0 && idleLoops > 10) {
                        await new Promise(r => setTimeout(r, 500));
                        // Final capture
                        const finalBlocks = document.querySelectorAll('.prose');
                        if (finalBlocks && finalBlocks.length > 0) {
                            const finalBlock = finalBlocks[finalBlocks.length - 1];
                            const finalContent = finalBlock.innerText;
                            if (finalContent !== lastContent) {
                                const delta = finalContent.slice(lastContent.length);
                                await window.onHfChunk(reqId, delta);
                            }
                        }
                        isDone = true;
                    }
                }
            } catch (e) {
                await window.onHfError(reqId, e.message);
            }
        }, reqId);

    } catch (e) {
        error = `DOM Error: ${e.message}`;
    }

    delete global.hfChunkCallbacks[reqId];

    if (error && !content) {
        return { error, model, chatId: reqId };
    }

    return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        provider: HF_PROVIDER_ID,
        choices: [{
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
}
