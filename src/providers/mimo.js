import path from 'path';
import { SESSION_DIR } from '../config.js';
import { logInfo, logWarn, logError } from '../logger/index.js';
import { getActiveProvider, getProviderAuthMode } from './activeProvider.js';
import { TokenManager } from '../api/tokenManager.js';

const MIMO_BASE_URL = 'https://api.xiaomimimo.com';
const MIMO_API_BASE = `${MIMO_BASE_URL}/v1/chat/completions`;
const MIMO_PROVIDER_ID = 'mimo';
const DEFAULT_MIMO_MODEL = process.env.MIMO_DEFAULT_MODEL || 'mimo-v2.5';

export const mimoTokenManager = new TokenManager('mimo');

const MIMO_MODELS = [
    { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', object: 'model', created: 0, owned_by: 'xiaomi', provider: MIMO_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'mimo-v2.5', name: 'MiMo V2.5', object: 'model', created: 0, owned_by: 'xiaomi', provider: MIMO_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', object: 'model', created: 0, owned_by: 'xiaomi', provider: MIMO_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', object: 'model', created: 0, owned_by: 'xiaomi', provider: MIMO_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'mimo-v2-omni', name: 'MiMo V2 Omni', object: 'model', created: 0, owned_by: 'xiaomi', provider: MIMO_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
];

function getMimoAuthMode() {
    return getProviderAuthMode(MIMO_PROVIDER_ID) || 'account';
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
        hasCookie: false,
        hasBearerToken: accountSessionAvailable,
        hasPowResponse: false,
        capabilities: {
            models: authenticated,
            chatCompletions: authenticated,
            accountChatCompletions: authenticated,
            guestChatCompletions: false
        },
        savedAt: null,
        message: authenticated ? 'Xiaomi MIMO API key is available.' : 'MIMO API key is missing. Get one at platform.xiaomimimo.com'
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
        'MiMo-V2-Flash': 'mimo-v2-flash',
        'MiMo-V2-Pro': 'mimo-v2-pro',
        'MiMo-V2-Omni': 'mimo-v2-omni',
    };
    if (directMappings[model]) return directMappings[model];

    const modelLower = String(model).toLowerCase();
    if (modelLower.includes('omni')) return 'mimo-v2-omni';
    if (modelLower.includes('pro') && modelLower.includes('2.5')) return 'mimo-v2.5-pro';
    if (modelLower.includes('pro')) return 'mimo-v2-pro';
    if (modelLower.includes('flash')) return 'mimo-v2-flash';
    if (modelLower.includes('2.5')) return 'mimo-v2.5';
    return DEFAULT_MIMO_MODEL;
}

export async function sendMimoChatCompletion({ messages, model = DEFAULT_MIMO_MODEL, stream = false, onChunk = null, chatId = null }) {
    const session = await mimoTokenManager.getAvailableToken();
    if (!session) {
        throw new Error('MIMO API key is missing. Run scripts/mimo_auth.js to add your key from platform.xiaomimimo.com');
    }

    const apiKey = session.token || session.apiKey || session.sessionToken || '';
    if (!apiKey) {
        throw new Error('MIMO token object has no usable API key field.');
    }

    const mimoModel = mapModel(model);

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'api-key': apiKey,
        'Accept': 'application/json, text/event-stream',
        'User-Agent': 'Web2API-Gateway/1.0'
    };

    const reqBody = {
        model: mimoModel,
        messages,
        stream: stream || false
    };

    logInfo(`[MIMO] Sending request → model=${mimoModel} stream=${reqBody.stream}`);

    const compResp = await fetch(MIMO_API_BASE, {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody)
    });

    if (!compResp.ok) {
        const errText = await compResp.text();
        throw new Error(`MIMO API error: ${compResp.status} ${errText}`);
    }

    // Non-streaming
    if (!reqBody.stream) {
        const data = await compResp.json();
        const content = data?.choices?.[0]?.message?.content || '';
        if (typeof onChunk === 'function' && content) onChunk(content);
        return {
            id: data.id || `chatcmpl-mimo-${Date.now()}`,
            object: 'chat.completion',
            created: data.created || Math.floor(Date.now() / 1000),
            model: data.model || model,
            provider: MIMO_PROVIDER_ID,
            choices: data.choices || [{
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: 'stop'
            }],
            usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
    }

    // Streaming
    const reader = compResp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';

    const parseLine = (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
            const data = JSON.parse(payload);
            const delta = data.choices?.[0]?.delta?.content || '';
            if (delta) {
                fullContent += delta;
                if (typeof onChunk === 'function') onChunk(delta);
            }
        } catch { /* ignore */ }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx).replace(/\r$/, '').trim();
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
            message: { role: 'assistant', content: fullContent },
            finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
}
