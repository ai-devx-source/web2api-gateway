import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { SESSION_DIR } from '../config.js';
import { logInfo, logWarn } from '../logger/index.js';
import { resolveBrowserExecutable } from '../utils/browserExecutable.js';
import { getActiveProvider, getProviderAuthMode } from './activeProvider.js';

puppeteer.use(StealthPlugin());

const HF_BASE_URL = 'https://huggingface.co/chat';
const HF_PROVIDER_ID = 'huggingface';
const HF_SESSION_DIR = path.resolve(process.cwd(), SESSION_DIR, 'huggingface');
const HF_SESSION_FILE = path.join(HF_SESSION_DIR, 'session.json');
const HF_PROFILE_DIR = path.join(HF_SESSION_DIR, 'browser-profile');
const DEFAULT_HF_MODEL = 'Qwen/Qwen2.5-72B-Instruct';

let hfBrowser = null;
let hfPage = null;

const HF_MODELS = [
    { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct', name: 'Llama 3.1 70B', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'CohereForAI/c4ai-command-r-plus-08-2024', name: 'Command R+', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', name: 'Mixtral 8x7B', object: 'model', provider: HF_PROVIDER_ID },
    { id: 'NousResearch/Hermes-3-Llama-3.1-8B', name: 'Hermes 3', object: 'model', provider: HF_PROVIDER_ID }
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

export async function authorizeHuggingFaceInteractive() {
    ensureSessionDir();
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

    const headers = {
        'Cookie': session.cookieHeader,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    };

    // 1. Create conversation
    logInfo(`[HuggingFace] Creating conversation for model: ${model}`);
    const createRes = await fetch(`${HF_BASE_URL}/conversation`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model })
    });

    if (!createRes.ok) {
        throw new Error(`Failed to create conversation: HTTP ${createRes.status} ${await createRes.text()}`);
    }
    
    const { conversationId } = await createRes.json();
    if (!conversationId) throw new Error('Did not receive conversationId from HuggingFace');

    // 2. Format inputs
    const prompt = messages.map(m => m.content).join('\n\n');
    const payload = {
        inputs: prompt,
        id: crypto.randomUUID(),
        is_retry: false,
        is_continue: false,
        web_search: false,
        tools: []
    };

    // 3. Send message
    logInfo(`[HuggingFace] Sending message to conversation ${conversationId}`);
    const msgRes = await fetch(`${HF_BASE_URL}/conversation/${conversationId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });

    if (!msgRes.ok) {
        throw new Error(`Failed to send message: HTTP ${msgRes.status} ${await msgRes.text()}`);
    }

    const reader = msgRes.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let content = '';
    let error = null;

    let finished = false;
    for (;;) {
        if (finished) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        
        for (const rawEvent of events) {
            const line = rawEvent.split('\n').find(item => item.startsWith('data:'));
            if (!line) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            
            try {
                const event = JSON.parse(data);
                if (event.type === 'stream') {
                    const delta = event.token || '';
                    content += delta;
                    if (delta && onChunk) onChunk(delta);
                } else if (event.type === 'finalAnswer') {
                    finished = true;
                    break;
                } else if (event.type === 'error') {
                    error = event.message || 'Unknown error';
                }
            } catch {
                // Ignore
            }
        }
    }

    // 4. Delete conversation (cleanup)
    fetch(`${HF_BASE_URL}/conversation/${conversationId}`, {
        method: 'DELETE',
        headers
    }).catch(() => {});

    if (error && !content) {
        return { error, model, chatId: conversationId };
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
