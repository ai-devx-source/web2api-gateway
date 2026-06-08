import { getBrowserContext, getAuthenticationStatus, setAuthenticationStatus } from '../browser/browser.js';
import { checkAuthentication, checkVerification } from '../browser/auth.js';
import { shutdownBrowser, initBrowser } from '../browser/browser.js';
import { saveAuthToken } from '../browser/session.js';
import { getAvailableToken, markRateLimited, removeInvalidToken } from '../api/tokenManager.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logInfo, logError, logWarn, logDebug, logRaw } from '../logger/index.js';
import crypto from 'crypto';
import {
    CHAT_API_URL, CREATE_CHAT_URL, CHAT_PAGE_URL, TASK_STATUS_URL,
    PAGE_TIMEOUT, RETRY_DELAY, PAGE_POOL_SIZE,
    DEFAULT_MODEL, MAX_RETRY_COUNT,
    TASK_POLL_MAX_ATTEMPTS, TASK_POLL_INTERVAL
} from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODELS_FILE = path.join(__dirname, '..', 'AvailableModels.txt');
const AUTH_KEYS_FILE = path.join(__dirname, '..', 'Authorization.txt');

let authToken = null;
let availableModels = null;
let authKeys = null;
let browserTokenRateLimited = false;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Page helpers ────────────────────────────────────────────────────────────

async function getPage(context) {
    if (context && typeof context.newPage === 'function') {
        return await context.newPage();
    }

    if (context && typeof context.goto === 'function') {
        // If a Puppeteer Page is provided, do not reuse it as the working page:
        // Create a separate tab from the same browser to avoid race conditions
        // and accidental closure of the base page.
        if (typeof context.browser === 'function') {
            try {
                const browser = context.browser();
                if (browser && typeof browser.newPage === 'function') {
                    return await browser.newPage();
                }
            } catch (error) {
                logWarn(`Failed to create new page from current context: ${error.message}`);
            }
        }

        if (typeof context.isClosed === 'function' && context.isClosed()) {
            throw new Error('Base browser page is closed');
        }

        return context;
    }

    throw new Error('Invalid context: neither a Puppeteer Page nor a Playwright Context');
}

export const pagePool = {
    pages: [],
    maxSize: PAGE_POOL_SIZE,

    async getPage(context) {
        const baseContext = getBrowserContext();
        while (this.pages.length > 0) {
            const page = this.pages.pop();
            try {
                if (page === baseContext) {
                    logWarn('Base page should not be in pool, skipping');
                    continue;
                }
                if (page.isClosed()) {
                    logWarn('Pooled page is closed, skipping');
                    continue;
                }
                await page.evaluate(() => document.readyState);
                return page;
            } catch (e) {
                logWarn(`Pooled page expired (${e.message?.substring(0, 60)}), creating new one`);
                if (page !== baseContext) {
                    try { await page.close(); } catch { /* already dead */ }
                }
            }
        }

        const newPage = await getPage(context);
        await newPage.goto(CHAT_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        if (!authToken) {
            try {
                authToken = await newPage.evaluate(() => localStorage.getItem('token'));
                logInfo('Authorization token retrieved from browser');
                if (authToken) {
                    saveAuthToken(authToken);
                }
            } catch (e) {
                logError('Error retrieving authorization token', e);
            }
        }

        return newPage;
    },

    releasePage(page) {
        try {
            if (page.isClosed()) return;
        } catch { return; }

        const baseContext = getBrowserContext();
        if (page === baseContext) {
            // Keep the base page separate from the pool.
            return;
        }

        if (this.pages.length < this.maxSize) {
            this.pages.push(page);
        } else {
            page.close().catch(e => logError('Error closing page', e));
        }
    },

    async clear() {
        const baseContext = getBrowserContext();
        for (const page of this.pages) {
            if (page === baseContext) continue;
            try { await page.close(); } catch (e) {
                logError('Error closing pooled page', e);
            }
        }
        this.pages = [];
    }
};

// ─── Task polling ────────────────────────────────────────────────────────────

export async function pollTaskStatus(taskId, page, token, maxAttempts = TASK_POLL_MAX_ATTEMPTS, interval = TASK_POLL_INTERVAL) {
    logInfo(`Starting task status polling: ${taskId}`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const statusUrl = `${TASK_STATUS_URL}/${taskId}`;

            const result = await page.evaluate(async (data) => {
                try {
                    const response = await fetch(data.url, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${data.token}`,
                            'Accept': 'application/json'
                        }
                    });
                    if (!response.ok) {
                        return { success: false, status: response.status, error: await response.text() };
                    }
                    return { success: true, data: await response.json() };
                } catch (e) {
                    return { success: false, error: e.toString() };
                }
            }, { url: statusUrl, token });

            if (!result.success) {
                logWarn(`Error checking status (attempt ${attempt}/${maxAttempts}): ${result.error}`);
                if (attempt < maxAttempts) await delay(interval);
                continue;
            }

            const taskData = result.data;
            const taskStatus = taskData.task_status || taskData.status || 'unknown';
            logDebug(`Task status (${attempt}/${maxAttempts}): ${taskStatus}`);

            if (taskStatus === 'completed' || taskStatus === 'success') {
                logInfo('Task completed successfully');
                return { success: true, status: 'completed', data: taskData };
            }

            if (taskStatus === 'failed' || taskStatus === 'error') {
                logError('Task finished with error');
                return { success: false, status: 'failed', error: taskData.error || taskData.message || 'Task execution failed', data: taskData };
            }

            if (attempt < maxAttempts) await delay(interval);
        } catch (error) {
            logError(`Error polling task (attempt ${attempt}/${maxAttempts})`, error);
            if (attempt < maxAttempts) await delay(interval);
        }
    }

    logError(`Exceeded attempt limit (${maxAttempts}) for task ${taskId}`);
    return { success: false, status: 'timeout', error: 'Task polling timeout exceeded' };
}

// ─── Token extraction ────────────────────────────────────────────────────────

export async function extractAuthToken(context, forceRefresh = false) {
    if (authToken && !forceRefresh) return authToken;

    try {
        const page = await getPage(context);
        const shouldClosePage = page !== context;
        try {
            await page.goto(CHAT_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
            await delay(RETRY_DELAY);

            const newToken = await page.evaluate(() => localStorage.getItem('token'));
            if (shouldClosePage) await page.close();

            if (newToken) {
                authToken = newToken;
                logInfo('Authorization token successfully extracted');
                saveAuthToken(authToken);
                return authToken;
            }
            logError('Authorization token not found in browser');
            return null;
        } catch (error) {
            if (shouldClosePage) await page.close().catch(() => {});
            throw error;
        }
    } catch (error) {
        logError('Error extracting authorization token', error);
        return null;
    }
}

// ─── Models & keys from files ────────────────────────────────────────────────

export function getAvailableModelsFromFile() {
    try {
        if (!fs.existsSync(MODELS_FILE)) {
            logError(`Models file not found: ${MODELS_FILE}`);
            return [DEFAULT_MODEL];
        }
        const models = fs.readFileSync(MODELS_FILE, 'utf8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));

        return models;
    } catch (error) {
        logError('Error reading models file', error);
        return [DEFAULT_MODEL];
    }
}

function getAuthKeysFromFile() {
    try {
        if (!fs.existsSync(AUTH_KEYS_FILE)) {
            const template = `# Proxy API Keys configuration\n# --------------------------------------------\n# This file lists the tokens that the\n# proxy will consider as valid.\n# One key per line without spaces.\n#\n# 1) Want to DISABLE authorization entirely?\n#    Leave the file empty — the server will stop\n#    verifying the Authorization header.\n#\n# 2) Want to grant access to multiple clients?\n#    Add each key on a separate line:\n#      d35ab3e1-a6f9-4d...\n#      f2b1cd9c-1b2e-4a...\n#\n# Empty lines and lines starting with '#' are\n# ignored.`;
            try {
                fs.writeFileSync(AUTH_KEYS_FILE, template, { encoding: 'utf8', flag: 'wx' });
                logInfo(`Created key template file: ${AUTH_KEYS_FILE}`);
            } catch (e) {
                logError('Failed to create Authorization.txt template', e);
            }
            return [];
        }
        return fs.readFileSync(AUTH_KEYS_FILE, 'utf8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
    } catch (error) {
        logError('Error reading authorization keys file', error);
        return [];
    }
}

export function isValidModel(modelName) {
    if (!availableModels) availableModels = getAvailableModelsFromFile();
    return availableModels.includes(modelName);
}



// ─── sendMessage — helper functions ──────────────────────────────────────────

function validateAndPrepareMessage(message) {
    if (message === null || message === undefined) {
        return { error: 'Message payload cannot be empty' };
    }
    if (typeof message === 'string') return { content: message };
    if (Array.isArray(message)) {
        const isValid = message.every(item =>
            (item.type === 'text' && typeof item.text === 'string') ||
            (item.type === 'image' && typeof item.image === 'string') ||
            (item.type === 'file' && typeof item.file === 'string')
        );
        if (!isValid) return { error: 'Invalid multipart message structure' };
        return { content: message };
    }
    return { error: 'Unsupported message format' };
}

async function resolveAuthToken(browserContext) {
    const tokenObj = await getAvailableToken();
    if (tokenObj && tokenObj.token) {
        authToken = tokenObj.token;
        logInfo(`Using account: ${tokenObj.id}`);
        return tokenObj;
    }

    if (browserTokenRateLimited) {
        logWarn('Browser token rate-limited, skipping fallback');
        return null;
    }

    if (!getAuthenticationStatus()) {
        logInfo('Checking authorization...');
        const authCheck = await checkAuthentication(browserContext);
        if (!authCheck) return null;
    }

    if (!authToken) {
        logInfo('Retrieving authorization token...');
        authToken = await extractAuthToken(browserContext);
    }

    return authToken ? { id: 'browser', token: authToken } : null;
}

function buildPayloadV2(messageContent, model, chatId, parentId, files, systemMessage, tools, toolChoice, chatType = 't2t', size = null) {
    const userMessageId = crypto.randomUUID();
    const assistantChildId = crypto.randomUUID();

    const isVideo = chatType === 't2v';

    const featureConfig = {
        thinking_enabled: isVideo,
        output_schema: 'phase'
    };
    if (isVideo) {
        featureConfig.research_mode = 'normal';
        featureConfig.auto_thinking = true;
        featureConfig.thinking_format = 'summary';
        featureConfig.auto_search = true;
    }

    const newMessage = {
        fid: userMessageId,
        parentId, parent_id: parentId,
        role: 'user',
        content: messageContent,
        chat_type: chatType, sub_chat_type: chatType,
        timestamp: Math.floor(Date.now() / 1000),
        user_action: 'chat',
        models: [model],
        files: files || [],
        childrenIds: [assistantChildId],
        extra: { meta: { subChatType: chatType } },
        feature_config: featureConfig
    };

    const payload = {
        stream: !isVideo,
        incremental_output: true,
        chat_id: chatId,
        chat_mode: 'normal',
        messages: [newMessage],
        model,
        parent_id: parentId,
        timestamp: Math.floor(Date.now() / 1000)
    };

    if (size) payload.size = size;

    if (systemMessage) {
        payload.system_message = systemMessage;
        logDebug(`System message: ${systemMessage.substring(0, 100)}${systemMessage.length > 100 ? '...' : ''}`);
    }
    if (tools && Array.isArray(tools) && tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = toolChoice || 'auto';
    }

    return payload;
}

function parseNonSseCompletionBody(body) {
    try {
        const parsed = JSON.parse(body);
        const topLevelCode = parsed?.code;
        const nestedCode = parsed?.data?.code;
        const hasStructuredError =
            parsed?.success === false ||
            Boolean(parsed?.error) ||
            Boolean(parsed?.data?.error) ||
            Boolean(topLevelCode) ||
            Boolean(nestedCode);

        if (hasStructuredError) {
            const isRateLimited = topLevelCode === 'RateLimited' || nestedCode === 'RateLimited';
            return {
                success: false,
                status: isRateLimited ? 429 : 500,
                errorBody: body
            };
        }

        if (parsed.choices || parsed.id || (parsed.success === true && parsed.data)) {
            return { success: true, isTask: false, data: parsed };
        }
    } catch {
        // Ignore parse errors here and return a generic failure below.
    }

    return { success: false, error: 'Unexpected non-SSE 200 response', errorBody: body };
}

async function executeApiRequestWithNodeStreaming(apiUrl, payload, token, onChunk) {
    try {
        if (!token) return { success: false, error: 'Authentication token not found' };
        if (typeof fetch !== 'function') return { success: false, error: 'Fetch API is unavailable' };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Accept': '*/*'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            return { success: false, status: response.status, statusText: response.statusText, errorBody };
        }

        if (payload.stream === false) {
            const jsonResponse = await response.json();
            if (jsonResponse.code === 'RateLimited' || jsonResponse.error) {
                return { success: false, status: 429, errorBody: JSON.stringify(jsonResponse) };
            }
            return { success: true, isTask: true, data: jsonResponse };
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) {
            const body = await response.text();
            return parseNonSseCompletionBody(body);
        }

        const reader = response.body?.getReader?.();
        if (!reader) {
            const body = await response.text();
            return parseNonSseCompletionBody(body);
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let responseId = null;
        let usage = null;
        let finished = false;
        let streamError = null;
        let hasStreamedChunks = false;

        while (!finished) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line || !line.startsWith('data:')) continue;

                const jsonStr = line.substring(5).trim();
                if (!jsonStr) continue;
                if (jsonStr === '[DONE]') {
                    finished = true;
                    break;
                }

                try {
                    const chunk = JSON.parse(jsonStr);

                    if (chunk.code === 'RateLimited' || (chunk.code && chunk.detail)) {
                        streamError = { status: 429, errorBody: JSON.stringify(chunk) };
                        finished = true;
                        break;
                    }
                    if (chunk.error && !chunk.choices) {
                        streamError = { status: 500, errorBody: JSON.stringify(chunk) };
                        finished = true;
                        break;
                    }

                    if (chunk['response.created']) responseId = chunk['response.created'].response_id;
                    if (chunk.response_id) responseId = chunk.response_id;

                    if (chunk.choices && chunk.choices[0]) {
                        const delta = chunk.choices[0].delta;
                        if (delta && delta.content) {
                            fullContent += delta.content;
                            if (typeof onChunk === 'function') {
                                onChunk(delta.content);
                                hasStreamedChunks = true;
                            }
                        }
                        if (delta && delta.status === 'finished') finished = true;
                        if (chunk.choices[0].finish_reason) finished = true;
                    }

                    if (chunk.usage) usage = chunk.usage;
                } catch {
                    // Ignore broken chunks, keep reading stream.
                }
            }
        }

        if (streamError) {
            return { success: false, ...streamError, hasStreamedChunks };
        }

        return {
            success: true,
            isTask: false,
            hasStreamedChunks,
            data: {
                id: responseId || 'chatcmpl-' + Date.now(),
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: payload.model,
                choices: [{ index: 0, message: { role: 'assistant', content: fullContent }, finish_reason: 'stop' }],
                usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                response_id: responseId
            }
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

async function executeApiRequest(page, apiUrl, payload, token, onChunk = null) {
    if (payload?.stream !== false && typeof onChunk === 'function') {
        const streamedResponse = await executeApiRequestWithNodeStreaming(apiUrl, payload, token, onChunk);

        const canReturnDirectly =
            streamedResponse.success ||
            Boolean(streamedResponse.status) ||
            Boolean(streamedResponse.errorBody) ||
            streamedResponse.hasStreamedChunks === true;

        if (canReturnDirectly) {
            return streamedResponse;
        }

        logWarn(`Node-streaming unavailable (${streamedResponse.error || 'unknown error'}), falling back to browser fetch.`);
    }

    const requestBody = { apiUrl, payload, token };

    logDebug(`Authentication token: ${token ? 'Present' : 'Missing'}`);
    logDebug(`API URL: ${apiUrl}`);

    return page.evaluate(async (data) => {
        try {
            const t = data.token;
            if (!t) return { success: false, error: 'Authentication token not found' };

            const response = await fetch(data.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${t}`,
                    'Accept': '*/*'
                },
                body: JSON.stringify(data.payload)
            });

            if (response.ok) {
                if (data.payload.stream === false) {
                    const jsonResponse = await response.json();
                    if (jsonResponse.code === 'RateLimited' || jsonResponse.error) {
                        return { success: false, status: 429, errorBody: JSON.stringify(jsonResponse) };
                    }
                    return { success: true, isTask: true, data: jsonResponse };
                }

                const contentType = response.headers.get('content-type') || '';

                if (!contentType.includes('text/event-stream')) {
                    const body = await response.text();
                    try {
                        const parsed = JSON.parse(body);
                        const topLevelCode = parsed?.code;
                        const nestedCode = parsed?.data?.code;
                        const hasStructuredError =
                            parsed?.success === false ||
                            Boolean(parsed?.error) ||
                            Boolean(parsed?.data?.error) ||
                            Boolean(topLevelCode) ||
                            Boolean(nestedCode);

                        // API occasionally returns JSON with success=false and a code on HTTP 200.
                        if (hasStructuredError) {
                            const isRateLimited = topLevelCode === 'RateLimited' || nestedCode === 'RateLimited';
                            return {
                                success: false,
                                status: isRateLimited ? 429 : 500,
                                errorBody: body
                            };
                        }
                        // Valid JSON completion response (sometimes returned by Qwen)
                        if (parsed.choices || parsed.id || (parsed.success === true && parsed.data)) {
                            return { success: true, isTask: false, data: parsed };
                        }
                    } catch { /* not JSON, treat as unexpected */ }
                    return { success: false, error: 'Unexpected non-SSE 200 response', errorBody: body };
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let fullContent = '';
                let responseId = null;
                let usage = null;
                let finished = false;
                let streamError = null;

                while (!finished) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim() || !line.startsWith('data: ')) continue;
                        const jsonStr = line.substring(6).trim();
                        if (!jsonStr) continue;
                        try {
                            const chunk = JSON.parse(jsonStr);

                            if (chunk.code === 'RateLimited' || (chunk.code && chunk.detail)) {
                                streamError = { status: 429, errorBody: JSON.stringify(chunk) };
                                finished = true;
                                break;
                            }
                            if (chunk.error && !chunk.choices) {
                                streamError = { status: 500, errorBody: JSON.stringify(chunk) };
                                finished = true;
                                break;
                            }

                            if (chunk['response.created']) responseId = chunk['response.created'].response_id;
                            if (chunk.choices && chunk.choices[0]) {
                                const delta = chunk.choices[0].delta;
                                if (delta && delta.content) fullContent += delta.content;
                                if (delta && delta.status === 'finished') finished = true;
                            }
                            if (chunk.usage) usage = chunk.usage;
                        } catch { /* ignore parse errors for individual chunks */ }
                    }
                }

                if (streamError) {
                    return { success: false, ...streamError };
                }

                return {
                    success: true,
                    isTask: false,
                    data: {
                        id: responseId || 'chatcmpl-' + Date.now(),
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: data.payload.model,
                        choices: [{ index: 0, message: { role: 'assistant', content: fullContent }, finish_reason: 'stop' }],
                        usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                        response_id: responseId
                    }
                };
            }

            const errorBody = await response.text();
            return { success: false, status: response.status, statusText: response.statusText, errorBody };
        } catch (error) {
            return { success: false, error: error.toString() };
        }
    }, requestBody);
}

async function handleApiError(response, tokenObj, message, model, chatId, parentId, files, retryCount, chatType, size, waitForCompletion, onChunk = null) {
    logRaw(JSON.stringify(response));
    logError(`Error receiving response: ${response.error || response.statusText}`);
    if (response.errorBody) logDebug(`Error response body: ${response.errorBody}`);

    if (response.html && response.html.includes('Verification')) {
        setAuthenticationStatus(false);
        logInfo('Verification required, restarting browser in visible mode...');
        await pagePool.clear();
        authToken = null;
        await shutdownBrowser();
        await initBrowser(true);
        return { error: 'Verification required. Browser restarted in visible mode.', verification: true, chatId };
    }

    if (response.status === 401 || (response.errorBody && (response.errorBody.includes('Unauthorized') || response.errorBody.includes('Token has expired')))) {
        logWarn(`Token ${tokenObj?.id} invalid (401). Removing and trying another.`);
        authToken = null;
        browserTokenRateLimited = false;
        if (tokenObj?.id && tokenObj.id !== 'browser') {
            const { markInvalid } = await import('./tokenManager.js');
            markInvalid(tokenObj.id);
        }
        const { hasValidTokens } = await import('./tokenManager.js');
        if (hasValidTokens() && retryCount < MAX_RETRY_COUNT) {
            return sendMessage(message, model, chatId, parentId, files, null, null, null, chatType, size, waitForCompletion, retryCount + 1, onChunk);
        }
        logError('No valid tokens left or attempts exhausted.');
        return { error: 'All tokens are invalid (401). Re-authentication required.', chatId };
    }

    if (response.status === 429 || (response.errorBody && response.errorBody.includes('RateLimited'))) {
        let hours = 24;
        try {
            const rateInfo = JSON.parse(response.errorBody);
            hours = Number(rateInfo.num) || 24;
        } catch { /* errorBody might not be valid JSON */ }

        if (tokenObj?.id === 'browser') {
            browserTokenRateLimited = true;
            logWarn(`Browser token reached limit. Marking for ${hours}h.`);
        } else if (tokenObj?.id) {
            markRateLimited(tokenObj.id, hours);
            logWarn(`Token ${tokenObj.id} reached limit. Marking for ${hours}h and trying another token...`);
        }

        authToken = null;
        const { hasValidTokens } = await import('./tokenManager.js');
        if (hasValidTokens() && retryCount < MAX_RETRY_COUNT) {
            return sendMessage(message, model, chatId, parentId, files, null, null, null, chatType, size, waitForCompletion, retryCount + 1, onChunk);
        }
        return { error: `All tokens rate-limited (${hours}h penalty)`, chatId };
    }

    return { error: response.error || response.statusText, details: response.errorBody || 'No additional details provided', chatId };
}

// ─── Main public API ─────────────────────────────────────────────────────────

export async function sendMessage(message, model = DEFAULT_MODEL, chatId = null, parentId = null, files = null, tools = null, toolChoice = null, systemMessage = null, chatType = 't2t', size = null, waitForCompletion = true, retryCount = 0, onChunk = null) {
    if (!availableModels) availableModels = getAvailableModelsFromFile();

    if (!chatId) {
        const newChatResult = await createChatV2(model, 'New Conversation', 0, chatType);
        if (newChatResult.error) return { error: 'Failed to initialize conversation context: ' + newChatResult.error };
        chatId = newChatResult.chatId;
    }

    const validated = validateAndPrepareMessage(message);
    if (validated.error) {
        logError(validated.error);
        return { error: validated.error, chatId };
    }
    const messageContent = validated.content;

    if (!model || model.trim() === '') {
        model = DEFAULT_MODEL;
    } else if (!isValidModel(model)) {
        logWarn(`Model "${model}" not found in available list. Using default model.`);
        model = DEFAULT_MODEL;
    }
    if (chatType !== 't2t') {
        const typeLabels = { t2i: 'image', t2v: 'video' };
        logInfo(`Generation type: ${chatType} (${typeLabels[chatType] || chatType})${size ? `, size: ${size}` : ''}`);
    }

    const browserContext = getBrowserContext();
    if (!browserContext) return { error: 'Browser not initialized', chatId };

    const tokenObj = await resolveAuthToken(browserContext);
    if (!tokenObj) return { error: 'Authentication error: Failed to acquire token', chatId };

    let page = null;
    try {
        page = await pagePool.getPage(browserContext);

        const verificationNeeded = await checkVerification(page);
        if (verificationNeeded) {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
        }

        if (!authToken) {
            logWarn('Token missing before sending request');
            authToken = await page.evaluate(() => localStorage.getItem('token'));
            if (!authToken) return { error: 'Authentication token not found. Manual restart required.', chatId };
            saveAuthToken(authToken);
        }

        logInfo('Sending request to API v2...');

        const payload = buildPayloadV2(messageContent, model, chatId, parentId, files, systemMessage, tools, toolChoice, chatType, size);
        logDebug('=== PAYLOAD V2 ===\n' + JSON.stringify(payload, null, 2));
        logDebug(`Dispatching message to session ${chatId} with parent_id: ${parentId || 'null'}`);

        const apiUrl = `${CHAT_API_URL}?chat_id=${chatId}`;
        const response = await executeApiRequest(page, apiUrl, payload, authToken, onChunk);

        if (response.success && response.isTask) {
            logInfo('Task response detected (video generation)');
            logRaw(JSON.stringify(response.data));

            const taskId = extractTaskId(response.data);
            if (!taskId) {
                logError('Task ID not found in response');
                pagePool.releasePage(page);
                page = null;
                return { error: 'Task ID not found in response', chatId, rawResponse: response.data };
            }

            logInfo(`Task ID: ${taskId}`);

            if (!waitForCompletion) {
                logInfo('Returning task_id for client polling');
                pagePool.releasePage(page);
                page = null;
                return {
                    id: taskId,
                    object: 'chat.completion.task',
                    created: Math.floor(Date.now() / 1000),
                    model,
                    task_id: taskId,
                    chatId,
                    parentId: response.data.data?.parent_id || taskId,
                    status: 'processing',
                    message: 'Video generation task initialized. Use GET /api/tasks/status/:taskId to poll for progress.'
                };
            }

            logInfo('Starting polling for video retrieval...');
            const taskResult = await pollTaskStatus(taskId, page, authToken);

            pagePool.releasePage(page);
            page = null;

            if (taskResult.success && taskResult.status === 'completed') {
                logInfo('Video generated successfully');
                const videoUrl = extractVideoUrl(taskResult.data);
                return {
                    id: taskId,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: videoUrl || JSON.stringify(taskResult.data) },
                        finish_reason: 'stop'
                    }],
                    usage: taskResult.data.usage || { prompt_tokens: 0, output_tokens: 0, total_tokens: 0 },
                    response_id: taskId,
                    chatId,
                    parentId: taskId,
                    task_id: taskId,
                    video_url: videoUrl
                };
            }

            logError(`Failed to retrieve video: ${taskResult.error}`);
            return { error: taskResult.error || 'Video generation failed', status: taskResult.status, chatId, task_id: taskId };
        }

        pagePool.releasePage(page);
        page = null;

        if (response.success) {
            logRaw(JSON.stringify(response.data));
            logInfo('Response received successfully');
            response.data.chatId = chatId;
            response.data.parentId = response.data.response_id;
            response.data.id = response.data.id || 'chatcmpl-' + Date.now();
            
            // Fallback: if the chunk stream was not emitted, dispatch the content as a single block.
            if (typeof onChunk === 'function' && response.data.choices?.[0]?.message?.content && !response.hasStreamedChunks) {
                onChunk(response.data.choices[0].message.content);
            }
            
            return response.data;
        }

        return handleApiError(response, tokenObj, message, model, chatId, parentId, files, retryCount, chatType, size, waitForCompletion, onChunk);
    } catch (error) {
        logError('Error sending message', error);
        return { error: error.toString(), chatId };
    } finally {
        if (page) {
            pagePool.releasePage(page);
        }
    }
}

// ─── Task response helpers ───────────────────────────────────────────────────

function extractTaskId(data) {
    const firstMsg = data.data?.messages?.[0];
    if (firstMsg?.extra?.wanx?.task_id) return firstMsg.extra.wanx.task_id;
    return data.id || data.task_id || data.response_id || data.data?.message_id || null;
}

function findMediaUrl(value, extensions = ['.mp4', '.mov', '.webm', '.png', '.jpg', '.jpeg', '.webp']) {
    if (!value) return null;
    if (typeof value === 'string') {
        const direct = value.match(/https?:\/\/[^\s"'<>]+/g)?.find(url => extensions.some(ext => url.toLowerCase().includes(ext)));
        return direct || null;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findMediaUrl(item, extensions);
            if (found) return found;
        }
        return null;
    }
    if (typeof value === 'object') {
        const preferredKeys = ['video_url', 'image_url', 'url', 'content', 'result', 'output', 'data', 'message'];
        for (const key of preferredKeys) {
            if (key in value) {
                const found = findMediaUrl(value[key], extensions);
                if (found) return found;
            }
        }
        for (const item of Object.values(value)) {
            const found = findMediaUrl(item, extensions);
            if (found) return found;
        }
    }
    return null;
}

export function extractMediaUrl(value, type = 'any') {
    const extensions = type === 'video'
        ? ['.mp4', '.mov', '.webm']
        : type === 'image'
            ? ['.png', '.jpg', '.jpeg', '.webp']
            : ['.mp4', '.mov', '.webm', '.png', '.jpg', '.jpeg', '.webp'];
    return findMediaUrl(value, extensions);
}

function extractVideoUrl(taskData) {
    return extractMediaUrl(taskData, 'video');
}

export async function pollQwenTaskStatus(taskId, waitForCompletion = false) {
    const browserContext = getBrowserContext();
    if (!browserContext) return { error: 'Browser not initialized', task_id: taskId };

    const tokenObj = await resolveAuthToken(browserContext);
    if (!tokenObj?.token) return { error: 'Authentication error: Failed to acquire token', task_id: taskId };

    let page = null;
    try {
        page = await pagePool.getPage(browserContext);
        const result = waitForCompletion
            ? await pollTaskStatus(taskId, page, tokenObj.token)
            : await pollTaskStatus(taskId, page, tokenObj.token, 1, 0);

        const mediaUrl = extractMediaUrl(result.data || result, 'video') || extractMediaUrl(result.data || result, 'image');
        return {
            task_id: taskId,
            success: result.success,
            status: result.status,
            error: result.error,
            video_url: extractMediaUrl(result.data || result, 'video'),
            image_url: extractMediaUrl(result.data || result, 'image'),
            media_url: mediaUrl,
            data: result.data
        };
    } finally {
        if (page) pagePool.releasePage(page);
    }
}

export async function clearPagePool() {
    await pagePool.clear();
}

export function getAuthToken() {
    return authToken;
}

// ─── createChatV2 ────────────────────────────────────────────────────────────

export async function createChatV2(model = DEFAULT_MODEL, title = 'New Conversation', retryCount = 0, chatType = 't2t') {
    const browserContext = getBrowserContext();
    if (!browserContext) return { error: 'Browser not initialized' };

    const tokenObj = await resolveAuthToken(browserContext);
    if (tokenObj?.token) {
        authToken = tokenObj.token;
    }

    if (!authToken) {
        logInfo('Retrieving authorization token for chat creation...');
        authToken = await extractAuthToken(browserContext);
        if (!authToken) return { error: 'Authentication token retrieval failed' };
    }

    let page = null;
    try {
        page = await pagePool.getPage(browserContext);

        const payload = { title, models: [model], chat_mode: 'normal', chat_type: chatType, timestamp: Date.now() };
        const requestBody = { apiUrl: CREATE_CHAT_URL, payload, token: authToken };

        const result = await page.evaluate(async (data) => {
            try {
                const response = await fetch(data.apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
                    body: JSON.stringify(data.payload)
                });
                if (response.ok) return { success: true, data: await response.json() };
                return { success: false, status: response.status, errorBody: await response.text() };
            } catch (error) {
                return { success: false, error: error.toString() };
            }
        }, requestBody);

        pagePool.releasePage(page);
        page = null;

        if (result.success && result.data.success) {
            logInfo(`Chat created: ${result.data.data.id}`);
            return { success: true, chatId: result.data.data.id, requestId: result.data.request_id };
        }

        const isTransient = result.status >= 500 && result.status < 600;
        if (isTransient && retryCount < MAX_RETRY_COUNT) {
            logWarn(`Creating chat: ${result.status}, retry ${retryCount + 1}/${MAX_RETRY_COUNT} in ${RETRY_DELAY}ms...`);
            await delay(RETRY_DELAY);
            return createChatV2(model, title, retryCount + 1, chatType);
        }

        const cleanError = isTransient
            ? `Qwen API endpoint unavailable (${result.status}). Please retry later.`
            : (result.errorBody || result.error || 'Unknown system error occurred');
        logError(`Error creating chat: ${result.status || 'unknown'} (attempt ${retryCount + 1})`);
        return { error: cleanError };
    } catch (error) {
        logError('Error creating chat', error);
        return { error: error.toString() };
    } finally {
        if (page) {
            pagePool.releasePage(page);
        }
    }
}

// ─── testToken ───────────────────────────────────────────────────────────────

export async function testToken(token) {
    const browserContext = getBrowserContext();
    if (!browserContext) return 'ERROR';

    let page;
    let shouldClosePage = false;
    try {
        page = await getPage(browserContext);
        shouldClosePage = page !== browserContext;
        await page.goto(CHAT_PAGE_URL, { waitUntil: 'domcontentloaded' });

        const requestBody = {
            apiUrl: CHAT_API_URL,
            token,
            payload: { chat_type: 't2t', messages: [{ role: 'user', content: 'ping', chat_type: 't2t' }], model: DEFAULT_MODEL, stream: false }
        };

        const result = await page.evaluate(async (data) => {
            try {
                const res = await fetch(data.apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
                    body: JSON.stringify(data.payload)
                });
                return { ok: res.ok, status: res.status };
            } catch (e) {
                return { ok: false, status: 0, error: e.toString() };
            }
        }, requestBody);

        if (result.ok || result.status === 400) return 'OK';
        if (result.status === 401 || result.status === 403) return 'UNAUTHORIZED';
        if (result.status === 429) return 'RATELIMIT';
        return 'ERROR';
    } catch (e) {
        logError('testToken error', e);
        return 'ERROR';
    } finally {
        if (page) {
            try { if (shouldClosePage) await page.close(); } catch { }
        }
    }
}
