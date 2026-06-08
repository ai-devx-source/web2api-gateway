import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SESSION_DIR } from '../config.js';
import { logInfo, logWarn, logError } from '../logger/index.js';
import { getActiveProvider, getProviderAuthMode } from './activeProvider.js';
import { TokenManager } from '../api/tokenManager.js';

const PERPLEXITY_BASE_URL = 'https://www.perplexity.ai';
const PERPLEXITY_API_BASE = `${PERPLEXITY_BASE_URL}/rest/sse/perplexity_ask`;
const PERPLEXITY_PROVIDER_ID = 'perplexity';
const PERPLEXITY_SESSION_DIR = path.resolve(process.cwd(), SESSION_DIR, 'perplexity');
const DEFAULT_PERPLEXITY_MODEL = process.env.PERPLEXITY_DEFAULT_MODEL || 'Auto';
const PERPLEXITY_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export const perplexityTokenManager = new TokenManager('perplexity');

const PERPLEXITY_MODELS = [
    { id: 'Auto', name: 'Auto', object: 'model', created: 0, owned_by: 'perplexity', provider: PERPLEXITY_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'Turbo', name: 'Turbo', object: 'model', created: 0, owned_by: 'perplexity', provider: PERPLEXITY_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'PPLX-Pro', name: 'PPLX-Pro', object: 'model', created: 0, owned_by: 'perplexity', provider: PERPLEXITY_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'Gemini-2.5-Pro', name: 'Gemini-2.5-Pro', object: 'model', created: 0, owned_by: 'perplexity', provider: PERPLEXITY_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'Claude-Sonnet-4', name: 'Claude-Sonnet-4', object: 'model', created: 0, owned_by: 'perplexity', provider: PERPLEXITY_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'Claude-Opus-4', name: 'Claude-Opus-4', object: 'model', created: 0, owned_by: 'perplexity', provider: PERPLEXITY_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'Nemotron', name: 'Nemotron', object: 'model', created: 0, owned_by: 'perplexity', provider: PERPLEXITY_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
    { id: 'GPT-5', name: 'GPT-5', object: 'model', created: 0, owned_by: 'perplexity', provider: PERPLEXITY_PROVIDER_ID, account_required: true, guest_available: false, permission: [] },
];

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function getUsableSessionToken(tokenObj) {
    if (!tokenObj) return '';
    return tokenObj.token || tokenObj.sessionToken || '';
}

function getPerplexityAuthMode() {
    return getProviderAuthMode(PERPLEXITY_PROVIDER_ID) || 'account';
}

function isPerplexityGuestMode() {
    return getPerplexityAuthMode() === 'guest';
}

export function getPerplexitySessionStatus() {
    const accountSessionAvailable = perplexityTokenManager.hasValidTokens();
    const authMode = getPerplexityAuthMode();
    const authenticated = authMode === 'account' && accountSessionAvailable;
    return {
        provider: PERPLEXITY_PROVIDER_ID,
        domain: PERPLEXITY_BASE_URL,
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
        message: authenticated ? 'Perplexity session is available.' : 'Perplexity session is missing or expired.'
    };
}

export function getPerplexityModels() {
    return PERPLEXITY_MODELS;
}

export function getDefaultPerplexityModel() {
    return DEFAULT_PERPLEXITY_MODEL;
}

export function isPerplexityModel(model = '') {
    const lower = String(model).toLowerCase();
    return PERPLEXITY_MODELS.some(m => m.id.toLowerCase() === lower || lower.includes('pplx') || lower.includes('perplexity'));
}

export function shouldUsePerplexityProvider(body = {}) {
    const provider = String(body.provider || body?.metadata?.provider || '').toLowerCase();
    if (['perplexity', 'pplx'].includes(provider)) return true;
    if (['qwen', 'zai', 'glm', 'deepseek', 'kimi', 'minimax', 'huggingface'].includes(provider)) return false;
    if (isPerplexityModel(body.model || '')) return true;
    return getActiveProvider() === 'perplexity';
}

function mapModel(model) {
    const directMappings = {
        'Auto': 'turbo',
        'Turbo': 'turbo',
        'PPLX-Pro': 'pplx_pro',
        'GPT-5': 'gpt5',
        'Gemini-2.5-Pro': 'gemini25pro',
        'Claude-Sonnet-4': 'claude4sonnet',
        'Claude-Opus-4': 'claude4opus',
        'Nemotron': 'nemotron'
    };
    if (directMappings[model]) return directMappings[model];
    
    const modelLower = String(model).toLowerCase();
    if (modelLower.includes('turbo')) return 'turbo';
    if (modelLower.includes('gpt5') || modelLower.includes('gpt-5')) return 'gpt5';
    if (modelLower.includes('pplx')) return 'pplx_pro';
    if (modelLower.includes('gemini')) return 'gemini25pro';
    if (modelLower.includes('claude')) {
        if (modelLower.includes('opus')) return 'claude4opus';
        return 'claude4sonnet';
    }
    if (modelLower.includes('nemotron')) return 'nemotron';
    return 'turbo';
}

function messagesToPrompt(messages = []) {
    let systemPrompt = '';
    const conversationParts = [];
    
    for (const msg of messages) {
        if (!msg || !msg.content) continue;
        const text = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map(i => i.text || '').join('\n') : '');
        if (msg.role === 'system') {
            systemPrompt = text;
        } else {
            const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
            conversationParts.push(`[${roleLabel}]: ${text}`);
        }
    }
    
    const conversationHistory = conversationParts.join('\n\n');
    if (systemPrompt && conversationHistory) {
        return `${systemPrompt}\n\n---\n\n${conversationHistory}`;
    }
    return conversationHistory || systemPrompt;
}

export async function sendPerplexityChatCompletion({ messages, model = DEFAULT_PERPLEXITY_MODEL, stream = false, onChunk = null, chatId = null }) {
    if (isPerplexityGuestMode()) {
        throw new Error('Perplexity guest mode is not supported.');
    }
    const session = await perplexityTokenManager.getAvailableToken();
    if (!session) {
        throw new Error('Perplexity account session is missing. Add token via auth script.');
    }

    const query = messagesToPrompt(messages);
    if (!query) throw new Error('Perplexity request has no user text.');

    const perplexityModel = mapModel(model);
    const sessionToken = getUsableSessionToken(session);
    const requestId = uuid();

    const headers = {
        'Accept': 'text/event-stream',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Origin': PERPLEXITY_BASE_URL,
        'Referer': `${PERPLEXITY_BASE_URL}/`,
        'User-Agent': PERPLEXITY_USER_AGENT,
        'Sec-Ch-Ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
        'Cookie': `__Secure-next-auth.session-token=${sessionToken}`,
        'x-perplexity-request-reason': 'perplexity-query-state-provider',
        'x-request-id': requestId
    };

    const reqBody = {
        params: {
            attachments: [],
            language: 'en-US',
            timezone: 'America/Los_Angeles',
            search_focus: 'internet',
            sources: ['web'],
            search_recency_filter: null,
            frontend_uuid: uuid(),
            mode: 'copilot',
            model_preference: perplexityModel,
            is_related_query: false,
            is_sponsored: false,
            frontend_context_uuid: uuid(),
            prompt_source: 'user',
            query_source: 'home',
            is_incognito: false,
            time_from_first_type: 18361,
            local_search_enabled: false,
            use_schematized_api: true,
            send_back_text_in_streaming_api: false,
            client_coordinates: null,
            mentions: [],
            dsl_query: query,
            skip_search_enabled: true,
            is_nav_suggestions_disabled: false,
            source: 'default',
            always_search_override: false,
            override_no_search: false,
            should_ask_for_mcp_tool_confirmation: true,
            browser_agent_allow_once_from_toggle: false,
            force_enable_browser_agent: false,
            supported_features: ['browser_agent_permission_banner_v1.1'],
            version: '2.18'
        },
        query_str: query
    };

    const compResp = await fetch(PERPLEXITY_API_BASE, {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody)
    });

    if (!compResp.ok) {
        throw new Error(`Perplexity Completion failed: ${compResp.status} ${await compResp.text()}`);
    }

    const reader = compResp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';

    const parseDataLine = (payload) => {
        if (!payload || payload === '[DONE]') return;
        try {
            const data = JSON.parse(payload);

            // Final SSE message contains `text` field which is a JSON string
            // representing an array of step objects
            if (data.text) {
                let steps;
                try {
                    steps = JSON.parse(data.text);
                } catch {
                    // text is plain string, not JSON steps array
                    if (data.text.length > fullContent.length) {
                        const delta = data.text.substring(fullContent.length);
                        fullContent = data.text;
                        if (delta && typeof onChunk === 'function') onChunk(delta);
                    }
                    return;
                }

                if (Array.isArray(steps)) {
                    for (const step of steps) {
                        if (step?.step_type === 'FINAL') {
                            // content.answer is itself another JSON string
                            let answerText = '';
                            try {
                                const answerObj = typeof step.content?.answer === 'string'
                                    ? JSON.parse(step.content.answer)
                                    : step.content?.answer;
                                answerText = answerObj?.answer || answerObj?.text || '';
                            } catch {
                                answerText = step.content?.answer || '';
                            }
                            if (answerText && answerText.length > fullContent.length) {
                                const delta = answerText.substring(fullContent.length);
                                fullContent = answerText;
                                if (delta && typeof onChunk === 'function') onChunk(delta);
                            }
                        }
                    }
                }
            }

            // Fallback: standard OpenAI-like delta
            if (!data.text && data.choices?.[0]?.delta?.content) {
                const delta = data.choices[0].delta.content;
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
            if (!line || line.startsWith('event:')) continue;
            if (line.startsWith('data:')) {
                parseDataLine(line.slice(5).trim());
            }
        }
    }

    if (buffer.trim() && buffer.trim().startsWith('data:')) {
        parseDataLine(buffer.trim().slice(5).trim());
    }

    return {
        id: `chatcmpl-perplexity-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        provider: PERPLEXITY_PROVIDER_ID,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: fullContent
            },
            finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        chatId: requestId,
        parentId: null
    };
}
