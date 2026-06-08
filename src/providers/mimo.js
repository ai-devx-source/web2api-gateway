import fs from 'fs';
import path from 'path';
import { SESSION_DIR } from '../config.js';
import { logInfo, logWarn, logError } from '../logger/index.js';
import { getActiveProvider, getProviderAuthMode } from './activeProvider.js';
import { TokenManager } from '../api/tokenManager.js';

const MIMO_BASE_URL = 'https://aistudio.xiaomimimo.com';
const MIMO_API_BASE = `${MIMO_BASE_URL}/open-apis/bot/chat`;
const MIMO_PROVIDER_ID = 'mimo';
const MIMO_SESSION_DIR = path.resolve(process.cwd(), SESSION_DIR, 'mimo');
const DEFAULT_MIMO_MODEL = process.env.MIMO_DEFAULT_MODEL || 'MiMo-V2.5';
const MIMO_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

export const mimoTokenManager = new TokenManager('mimo');

const MIMO_MODELS = [
    { id: 'MiMo-V2.5-Pro', name: 'MiMo V2.5 Pro', object: 'model', created: 0, owned_by: 'xiaomi', provider: MIMO_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'MiMo-V2.5', name: 'MiMo V2.5', object: 'model', created: 0, owned_by: 'xiaomi', provider: MIMO_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'MiMo-V2-Flash', name: 'MiMo V2 Flash', object: 'model', created: 0, owned_by: 'xiaomi', provider: MIMO_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
];

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function getUsableTokens(tokenObj) {
    if (!tokenObj) return {};
    return {
        serviceToken: tokenObj.serviceToken || '',
        userId: tokenObj.userId || '',
        phToken: tokenObj.phToken || ''
    };
}

function getMimoAuthMode() {
    return getProviderAuthMode(MIMO_PROVIDER_ID) || 'account';
}

function isMimoGuestMode() {
    return getMimoAuthMode() === 'guest';
}

export function getMimoSessionStatus() {
    const accountSessionAvailable = mimoTokenManager.hasValidTokens();
    const authMode = getMimoAuthMode();
    const authenticated = authMode === 'account' && accountSessionAvailable;
    return {
        provider: MIMO_PROVIDER_ID,
        domain: MIMO_BASE_URL,
        authMode,
        available: authenticated,
        authenticated: authenticated,
        accountSessionAvailable: accountSessionAvailable,
        accountRequired: true,
        guest: false,
        guestAvailable: false,
        hasCookie: accountSessionAvailable,
        hasBearerToken: false,
        hasPowResponse: false,
        capabilities: {
            models: authenticated,
            chatCompletions: authenticated,
            accountChatCompletions: authenticated,
            guestChatCompletions: false
        },
        savedAt: null,
        message: authenticated ? 'Xiaomi MIMO session is available.' : 'MIMO session is missing or expired.'
    };
}

export function getMimoModels() {
    return MIMO_MODELS;
}

export function getDefaultMimoModel() {
    return DEFAULT_MIMO_MODEL;
}

export function isMimoModel(model = '') {
    const lower = String(model).toLowerCase();
    return MIMO_MODELS.some(m => m.id.toLowerCase() === lower || lower.includes('mimo'));
}

export function shouldUseMimoProvider(body = {}) {
    const provider = String(body.provider || body?.metadata?.provider || '').toLowerCase();
    if (['mimo', 'xiaomi'].includes(provider)) return true;
    if (['qwen', 'zai', 'glm', 'deepseek', 'kimi', 'minimax', 'huggingface', 'perplexity'].includes(provider)) return false;
    if (isMimoModel(body.model || '')) return true;
    return getActiveProvider() === 'mimo';
}

function mapModel(model) {
    const directMappings = {
        'MiMo-V2.5-Pro': 'mimo-v2.5-pro',
        'MiMo-V2.5': 'mimo-v2.5',
        'MiMo-V2-Flash': 'mimo-v2-flash'
    };
    if (directMappings[model]) return directMappings[model];
    
    const modelLower = String(model).toLowerCase();
    if (modelLower.includes('pro')) return 'mimo-v2.5-pro';
    if (modelLower.includes('flash')) return 'mimo-v2-flash';
    return 'mimo-v2.5';
}

function messagesToMimoFormat(messages = []) {
    const converted = [];
    for (const msg of messages) {
        if (!msg || !msg.content) continue;
        const text = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map(i => i.text || '').join('\n') : '');
        if (msg.role === 'system') {
            // Prepend system to the next user message or first message
            if (converted.length === 0) {
                converted.push({ role: 'user', content: `[System Instruction]\n${text}` });
            } else {
                converted[0].content = `[System Instruction]\n${text}\n\n` + converted[0].content;
            }
        } else {
            converted.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: text
            });
        }
    }
    return converted;
}

export async function sendMimoChatCompletion({ messages, model = DEFAULT_MIMO_MODEL, stream = false, onChunk = null, chatId = null }) {
    if (isMimoGuestMode()) {
        throw new Error('MIMO guest mode is not supported.');
    }
    const session = await mimoTokenManager.getAvailableToken();
    if (!session) {
        throw new Error('MIMO account session is missing. Add token via auth script.');
    }

    const mimoMessages = messagesToMimoFormat(messages);
    if (mimoMessages.length === 0) throw new Error('MIMO request has no valid messages.');

    const mimoModel = mapModel(model);
    const { serviceToken, userId, phToken } = getUsableTokens(session);

    const headers = {
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Origin': MIMO_BASE_URL,
        'Referer': `${MIMO_BASE_URL}/`,
        'User-Agent': MIMO_USER_AGENT,
        'Sec-Ch-Ua': '"Chromium";v="144", "Not(A:Brand";v="8", "Google Chrome";v="144"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
        'Cookie': `serviceToken=${serviceToken}; userId=${userId}; xiaomichatbot_ph=${phToken}`
    };

    const reqBody = {
        model: mimoModel,
        messages: mimoMessages,
        stream: true
    };

    const compResp = await fetch(MIMO_API_BASE, {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody)
    });

    if (!compResp.ok) {
        throw new Error(`MIMO Completion failed: ${compResp.status} ${await compResp.text()}`);
    }

    const reader = compResp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';
    let finalId = uuid();

    const parseLine = (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
            const data = JSON.parse(payload);
            let deltaContent = '';
            
            if (data.choices && data.choices[0]?.delta?.content) {
                deltaContent = data.choices[0].delta.content;
            }

            if (deltaContent) {
                fullContent += deltaContent;
                if (typeof onChunk === 'function') onChunk(deltaContent);
            }
        } catch {
            // ignore
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
        id: `chatcmpl-mimo-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        provider: MIMO_PROVIDER_ID,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: fullContent
            },
            finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        chatId: chatId || finalId,
        parentId: null
    };
}
