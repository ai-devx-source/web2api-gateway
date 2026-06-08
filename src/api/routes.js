import express from 'express';
import { getAllModels, getApiKeys } from './configManager.js';
import { sendMessage, createChatV2, pollQwenTaskStatus, extractMediaUrl, pagePool, extractAuthToken } from '../providers/qwen.js';
import { getAuthenticationStatus, getBrowserContext } from '../browser/browser.js';
import { checkAuthentication } from '../browser/auth.js';
import { logInfo, logError, logDebug } from '../logger/index.js';
import { getMappedModel } from './modelMapping.js';
import { getStsToken, uploadFileToQwen } from './fileUpload.js';
import { loadHistory, saveHistory } from './chatHistory.js';
import { generateImage, getAvailableImageModels, checkImageApiAvailability } from '../providers/dashscopeImage.js';
import { MAX_FILE_SIZE, UPLOADS_DIR, DEFAULT_MODEL, STREAMING_CHUNK_DELAY, ALLOW_UNSCOPED_SESSION_CHAT_RESTORE } from '../config.js';

import { getZaiModels, getZaiSessionStatus, getDefaultZaiModel, isZaiModel, sendZaiChatCompletion, shouldUseZaiProvider } from '../providers/zai.js';
import { getDeepSeekModels, getDeepSeekSessionStatus, getDefaultDeepSeekModel, isDeepSeekModel, sendDeepSeekChatCompletion, shouldUseDeepSeekProvider } from '../providers/deepseek.js';
import { getKimiModels, getKimiSessionStatus, getDefaultKimiModel, isKimiModel, sendKimiChatCompletion, shouldUseKimiProvider } from '../providers/kimi.js';
import { getMinimaxModels, getMinimaxSessionStatus, getDefaultMinimaxModel, isMinimaxModel, sendMinimaxChatCompletion, shouldUseMinimaxProvider } from '../providers/minimax.js';
import { getPerplexityModels, getPerplexitySessionStatus, getDefaultPerplexityModel, isPerplexityModel, sendPerplexityChatCompletion, shouldUsePerplexityProvider } from '../providers/perplexity.js';
import { getMimoModels, getMimoSessionStatus, getDefaultMimoModel, isMimoModel, sendMimoChatCompletion, shouldUseMimoProvider } from '../providers/mimo.js';
import { getHuggingFaceModels, getHuggingFaceSessionStatus, getDefaultHuggingFaceModel, shouldUseHuggingFaceProvider, sendHuggingFaceChatCompletion } from '../providers/huggingface.js';
import { getActiveProviderProfile, getProviderAuthModes, setActiveProvider, setProviderAuthMode } from '../providers/activeProvider.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { listTokens, markInvalid, markRateLimited, markValid } from './tokenManager.js';
import { SERVICE_NAME, SERVICE_WATERMARK, getServiceMetadata } from '../utils/branding.js';

// Function to generate a deterministic chatId based on history
function generateChatIdFromHistory(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return null;
    }
    
    // Filter out Open WebUI system messages
    // Ignore messages starting with "### Task:" or "History:"
    const realMessages = messages.filter(m => {
        if (m.role !== 'user') return true;
        const content = typeof m.content === 'string' ? m.content : '';
        return !content.startsWith('### Task:') && !content.startsWith('History:');
    });
    
    // If only system messages remain, fallback to original messages
    const messagesToUse = realMessages.length > 0 ? realMessages : messages;
    
    // Use hash of the first actual user message to generate a stable ID
    const userMessages = messagesToUse
        .filter(m => m.role === 'user')
        .slice(0, 1) // Extract the first user message
        .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
        .join('||');
    
    if (!userMessages) return null;
    
    // Compute hash for the deterministic ID
    const hash = crypto
        .createHash('sha256')
        .update(userMessages)
        .digest('hex')
        .substring(0, 16);
    
    return `chat_${hash}`;
}

function normalizeIdValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    const lower = trimmed.toLowerCase();
    if (lower === 'null' || lower === 'undefined') return null;

    return trimmed;
}

function pickFirstId(candidates) {
    for (const candidate of candidates) {
        const normalized = normalizeIdValue(candidate);
        if (normalized) return normalized;
    }
    return null;
}

function buildInternalChatIdFromHint(hint) {
    const normalizedHint = normalizeIdValue(hint);
    if (!normalizedHint) return null;

    const hash = crypto
        .createHash('sha256')
        .update(`client-conversation:${normalizedHint}`)
        .digest('hex')
        .substring(0, 16);

    return `chat_${hash}`;
}

function extractConversationHint(req) {
    const body = req.body || {};
    const metadata = body && typeof body.metadata === 'object' ? body.metadata : {};

    return pickFirstId([
        body.conversation_id,
        body.conversationId,
        body.chat_id,
        metadata.conversation_id,
        metadata.conversationId,
        metadata.chat_id,
        metadata.chatId,
        req.get?.('x-conversation-id'),
        req.get?.('x-openwebui-conversation-id'),
        req.get?.('x-chat-id'),
        req.get?.('x-openwebui-chat-id')
    ]);
}

function extractParentHint(req) {
    const body = req.body || {};
    const metadata = body && typeof body.metadata === 'object' ? body.metadata : {};

    return pickFirstId([
        body.parentId,
        body.parent_id,
        body.x_qwen_parent_id,
        body.response_id,
        metadata.parentId,
        metadata.parent_id,
        metadata.response_id,
        req.get?.('x-parent-id'),
        req.get?.('x-openwebui-parent-id')
    ]);
}

function isTruthyFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function shouldForceNewChat(req) {
    const body = req.body || {};

    return [
        body.newChat,
        body.new_chat,
        body.resetChat,
        body.reset_chat,
        req.get?.('x-new-chat'),
        req.get?.('x-reset-chat')
    ].some(isTruthyFlag);
}

function shouldPersistSessionContext(scope = null) {
    const normalizedScope = normalizeIdValue(scope);
    return Boolean(normalizedScope) || ALLOW_UNSCOPED_SESSION_CHAT_RESTORE;
}

// Global registry for mapping generated IDs to actual Qwen chatIds
const chatIdMap = new Map();

function mapChatId(generatedId, qwenChatId) {
    if (generatedId) {
        chatIdMap.set(generatedId, qwenChatId);
        logDebug(`Chat mapping: ${generatedId} -> ${qwenChatId}`);
    }
}

function getChatIdFromMap(generatedId) {
    return generatedId ? chatIdMap.get(generatedId) : null;
}

async function resolveQwenChatId(effectiveChatId, mappedModel) {
    let qwenChatId = effectiveChatId;
    const mapped = getChatIdFromMap(effectiveChatId);

    if (mapped) {
        qwenChatId = mapped;
        logInfo(`🔁 Using mapped Qwen chatId: ${qwenChatId} (from ${effectiveChatId})`);
        return qwenChatId;
    }

    if (effectiveChatId && effectiveChatId.startsWith('chat_')) {
        try {
            const created = await createChatV2(mappedModel, 'OpenWebUI Session');
            if (created && created.chatId) {
                mapChatId(effectiveChatId, created.chatId);
                qwenChatId = created.chatId;
                logInfo(`🔨 Created Qwen chat ${qwenChatId} and linked to ${effectiveChatId}`);
            }
        } catch (error) {
            logDebug(`Failed to create Qwen chat for ${effectiveChatId}: ${error.message}`);
        }
    }

    return qwenChatId;
}
import { testToken } from '../providers/qwen.js';

function isOpenWebUiMetaRequest(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return false;
    const lastUserMessage = messages.filter(m => m && m.role === 'user').pop();
    if (!lastUserMessage) return false;

    const content = lastUserMessage.content;
    if (Array.isArray(content)) return false; // multimodal / normal user message
    if (typeof content !== 'string') return false;

    const text = content.trimStart();

    // OpenWebUI background/meta prompts that should not reuse the main chatId/session.
    if (text.startsWith('### Task:')) return true;
    if (text.startsWith('History:')) return true;

    // Some variants embed history blocks and task instructions.
    if (text.includes('<chat_history>') && text.includes('### Task:')) return true;

    return false;
}

// ============================================
// SESSION MANAGEMENT SYSTEM FOR CHAT TRACKING
// ============================================
// Scoped sessions (by conversation_id/chat_id) are permanently enabled.
// Unscoped fallback by IP + User-Agent is only active in legacy mode
// in ALLOW_UNSCOPED_SESSION_CHAT_RESTORE=true.
const sessionToChatMap = new Map(); // session-key -> {chatId, parentId, timestamp}

function getSessionKey(req) {
    // Generate unique session key based on IP and User-Agent
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('user-agent') || 'unknown';
    return crypto.createHash('sha256').update(`${ip}||${userAgent}`).digest('hex');
}

function getScopedSessionKey(req, scope = null) {
    const baseKey = getSessionKey(req);
    const normalizedScope = normalizeIdValue(scope);
    return normalizedScope ? `${baseKey}::${normalizedScope}` : baseKey;
}

function getSavedChatId(req, scope = null) {
    const keysToTry = [getScopedSessionKey(req, scope)];

    for (const sessionKey of keysToTry) {
        const sessionData = sessionToChatMap.get(sessionKey);
        if (sessionData && (Date.now() - sessionData.timestamp) < 3600000) { // 1 hour
            return sessionData;
        }
    }

    return null;
}
function saveChatIdForSession(req, chatId, parentId, scope = null) {
    const sessionKey = getScopedSessionKey(req, scope);
    const normalizedScope = normalizeIdValue(scope);

    sessionToChatMap.set(sessionKey, {
        chatId,
        parentId,
        scope: normalizedScope,
        timestamp: Date.now()
    });

    const scopeSuffix = normalizedScope ? ` (scope=${normalizedScope})` : "";
    logDebug(`Saved chatId ${chatId} for session ${sessionKey.substring(0, 8)}${scopeSuffix}`);
}
// Purge stale sessions every 10 minutes
setInterval(() => {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    let cleaned = 0;
    for (const [key, value] of sessionToChatMap.entries()) {
        if (value.timestamp < oneHourAgo) {
            sessionToChatMap.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        logDebug(`Purged ${cleaned} stale sessions`);
    }
}, 600000); // 10 minutes

const router = express.Router();

// ─── Multer for File Uploads ────────────────────────────────────────────────

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const uploadDir = path.join(process.cwd(), UPLOADS_DIR);
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename(req, file, cb) {
        cb(null, Date.now() + '-' + crypto.randomBytes(8).toString('hex') + '-' + file.originalname);
    }
});

const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

// ─── Auth middleware ─────────────────────────────────────────────────────────

function authMiddleware(req, res, next) {
    const apiKeys = getApiKeys();
    if (apiKeys.length === 0) return next();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logError('Missing or invalid authorization header');
        return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.substring(7).trim();
    if (!apiKeys.includes(token)) {
        logError('Invalid API key provided');
        return res.status(401).json({ error: 'Invalid authentication token' });
    }
    next();
}

router.use(authMiddleware);
router.use((req, res, next) => {
    req.url = req.url.replace(/\/v[12](?=\/|$)/g, '').replace(/\/+/g, '/');
    next();
});

// ─── Helpers: message parsing ────────────────────────────────────────────────

function parseOpenAIMessages(messages) {
    const systemMsg = messages.find(msg => msg.role === 'system');
    const systemMessage = systemMsg ? systemMsg.content : null;
    const lastUserMessage = messages.filter(msg => msg.role === 'user').pop();
    
    if (!lastUserMessage) {
        return { messageContent: null, systemMessage };
    }
    
    let messageContent = lastUserMessage.content;
    
    // Transform OpenAI format content array into internal unified format
    if (Array.isArray(messageContent)) {
        messageContent = messageContent.map(item => {
            if (item.type === 'text') {
                return { type: 'text', text: item.text };
            } else if (item.type === 'image_url' && item.image_url) {
                // OpenAI format: image_url: { url: '...' }
                return { type: 'image', image: item.image_url.url };
            } else if (item.type === 'image') {
                // Already in the internal unified format
                return { type: 'image', image: item.image };
            }
            return item;
        });
    }
    
    return { messageContent, systemMessage };
}

function buildCombinedTools(tools, functions, toolChoice) {
    const combinedTools = tools || (functions ? functions.map(fn => ({ type: 'function', function: fn })) : null);
    return { combinedTools, toolChoice };
}

function stringifyOpenAIContent(content) {
    if (content === null || content === undefined) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(item => {
            if (!item) return '';
            if (typeof item === 'string') return item;
            if (item.type === 'text') return item.text || '';
            if (item.type === 'image_url') return `[image: ${item.image_url?.url || ''}]`;
            if (item.type === 'image') return `[image: ${item.image || ''}]`;
            if (item.type === 'file') return `[file: ${item.file || item.name || ''}]`;
            return JSON.stringify(item);
        }).filter(Boolean).join('\n');
    }
    return JSON.stringify(content);
}

function buildStatelessTranscript(messages) {
    const parts = [];
    for (const msg of messages || []) {
        if (!msg || msg.role === 'system') continue;
        if (msg.role === 'user') {
            parts.push(`User: ${stringifyOpenAIContent(msg.content)}`);
        } else if (msg.role === 'assistant') {
            const text = stringifyOpenAIContent(msg.content);
            if (text) parts.push(`Assistant: ${text}`);
            if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                parts.push(`Assistant tool calls: ${JSON.stringify(msg.tool_calls)}`);
            }
        } else if (msg.role === 'tool') {
            const name = msg.name || msg.tool_call_id || 'tool';
            parts.push(`Tool result (${name}): ${stringifyOpenAIContent(msg.content)}`);
        } else {
            parts.push(`${msg.role || 'message'}: ${stringifyOpenAIContent(msg.content)}`);
        }
    }
    return parts.join('\n\n');
}


function hasOpenAIToolState(messages) {
    return (messages || []).some(msg =>
        msg?.role === 'tool' ||
        msg?.role === 'function' ||
        (msg?.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) ||
        (msg?.role === 'assistant' && msg.function_call)
    );
}

function shouldFoldOpenAITranscript(messages, combinedTools, effectiveChatId) {
    const nonSystemMessages = (messages || []).filter(msg => msg && msg.role !== 'system');
    if (nonSystemMessages.length === 0) return false;

    // Hermes/OpenAI agents send the full state every request. After a tool call the
    // next request often ends with role=tool, not role=user. Qwen Chat has no native
    // OpenAI tool-result role, so preserving context means folding the whole OpenAI
    // transcript into a single user message for that turn.
    if (hasOpenAIToolState(messages)) return true;

    // If ApiConnector is used as a stateless OpenAI-compatible endpoint and no
    // conversation id/chat id was provided, keep the complete client-side history.
    if (!effectiveChatId && nonSystemMessages.length > 1) return true;

    // When tools are available, prefer the OpenAI transcript over Qwen's opaque web
    // chat memory on multi-message turns. This keeps Hermes skill/tool discipline in
    // the prompt visible to Qwen instead of depending on previous web-chat state.
    if (Array.isArray(combinedTools) && combinedTools.length > 0 && nonSystemMessages.length > 1) return true;

    return false;
}

function prepareOpenAIMessageInput(messages, combinedTools, effectiveChatId) {
    const lastUserMessage = (messages || []).filter(msg => msg && msg.role === 'user').pop();
    if (shouldFoldOpenAITranscript(messages, combinedTools, effectiveChatId)) {
        return {
            messageContent: buildStatelessTranscript(messages),
            files: lastUserMessage?.files || [],
            folded: true,
            missingUser: false
        };
    }

    if (!lastUserMessage) {
        return { messageContent: null, files: [], folded: false, missingUser: true };
    }

    return {
        messageContent: lastUserMessage.content,
        files: lastUserMessage.files || [],
        folded: false,
        missingUser: false
    };
}

function truncateForPrompt(value, maxLen = 240) {
    const text = String(value || '');
    return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + '…' : text;
}

function compactJsonSchema(schema, depth = 0) {
    if (!schema || typeof schema !== 'object' || depth > 2) return schema;
    if (Array.isArray(schema)) return schema.slice(0, 20).map(item => compactJsonSchema(item, depth + 1));

    const out = {};
    for (const key of ['type', 'enum', 'required', 'default']) {
        if (schema[key] !== undefined) out[key] = schema[key];
    }
    if (schema.description) out.description = truncateForPrompt(schema.description, depth === 0 ? 180 : 90);
    if (schema.properties && typeof schema.properties === 'object') {
        out.properties = {};
        for (const [name, prop] of Object.entries(schema.properties)) {
            out.properties[name] = compactJsonSchema(prop, depth + 1);
        }
    }
    if (schema.items) out.items = compactJsonSchema(schema.items, depth + 1);
    if (schema.oneOf) out.oneOf = compactJsonSchema(schema.oneOf, depth + 1);
    if (schema.anyOf) out.anyOf = compactJsonSchema(schema.anyOf, depth + 1);
    return out;
}

function toolsToPrompt(tools) {
    if (!Array.isArray(tools) || tools.length === 0) return '';

    const priorityNames = new Set([
        'skill_view', 'skills_list', 'skill_manage',
        'read_file', 'search_files', 'write_file', 'patch', 'terminal', 'process',
        'web_search', 'web_extract', 'session_search', 'todo', 'clarify', 'delegate_task'
    ]);

    const schemas = tools.map(tool => {
        const fn = tool?.function || tool;
        if (!fn?.name) return null;
        return {
            name: fn.name,
            description: truncateForPrompt(fn.description || '', priorityNames.has(fn.name) ? 420 : 180),
            parameters: compactJsonSchema(fn.parameters || { type: 'object', properties: {} }),
            priority: priorityNames.has(fn.name) ? 0 : 1
        };
    }).filter(Boolean).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

    if (schemas.length === 0) return '';

    const toolNames = schemas.map(s => s.name).join(', ');
    const skillRules = schemas.some(s => s.name === 'skill_view') ? `
SKILL RULES ARE HARD REQUIREMENTS:
- If the system prompt says a skill MUST be loaded, you MUST call skill_view before answering.
- If the user asks about Hermes Agent setup/config/providers/models/tools/skills/gateway/plugins/troubleshooting, FIRST call:
  {"tool_calls":[{"name":"skill_view","arguments":{"name":"hermes-agent"}}]}
- If a task is related to any listed skill category, call skill_view with the most relevant skill name before giving the final answer.
- After receiving a skill_view result, use it, then continue normally or call the next needed tool.
` : '';

    return `

OPENAI-COMPATIBLE TOOL CALLING ADAPTER ACTIVE.
You are behind a proxy that converts your JSON into real OpenAI tool_calls. Native prose like "I will use X" is NOT a tool call.

Available tool names exactly:
${toolNames}

${skillRules}
GENERAL TOOL RULES:
- When an action, lookup, file read/write, command, web search, calculation, or verification is needed, CALL A TOOL instead of describing the action.
- If the user asks you to do something, and a suitable tool exists, respond with a tool call first.
- Never invent tool results. After tool results appear in the conversation, use them to continue.
- Use exact tool names from the list above. Do not prefix names with namespaces.

TOOL CALL OUTPUT FORMAT — respond ONLY with minified JSON, no markdown, no prose:
{"tool_calls":[{"name":"tool_name","arguments":{}}]}

Multiple calls are allowed:
{"tool_calls":[{"name":"skill_view","arguments":{"name":"hermes-agent"}},{"name":"terminal","arguments":{"command":"pwd"}}]}

Supported fallback shapes also work, but the format above is preferred.

Compact tool schemas:
${JSON.stringify(schemas.map(({priority, ...schema}) => schema), null, 2)}

If no tool is needed and no skill rule applies, answer normally.`;
}
function parseToolCallJson(content) {
    if (typeof content !== 'string') return null;
    let text = content.trim();
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) text = fence[1].trim();
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first > 0 || last !== text.length - 1) {
        if (first >= 0 && last > first) text = text.slice(first, last + 1);
    }
    const parseAttempts = [text];
    // Qwen sometimes emits one missing brace in the common shape:
    // {"tool_calls":[{"name":"x","arguments":{...}}]} -> may become ..."arguments":{...}]}
    if (/^\s*\{\s*"tool_calls"\s*:\s*\[\s*\{/.test(text) && /\}\]\}\s*$/.test(text)) {
        parseAttempts.push(text.replace(/\}\]\}\s*$/, '}}]}'));
    }
    if (/^\s*\{\s*"tool_calls"\s*:\s*\[/.test(text) && !/\}\s*$/.test(text)) {
        parseAttempts.push(text + '}');
    }

    for (const candidate of parseAttempts) {
        try {
            const parsed = JSON.parse(candidate);
            let calls = null;
            if (Array.isArray(parsed.tool_calls)) {
                calls = parsed.tool_calls;
            } else if (parsed.function_call || parsed.tool_call) {
                calls = [parsed.function_call || parsed.tool_call];
            } else if (parsed.name || parsed.tool) {
                calls = [parsed];
            }
            if (!calls || calls.length === 0) continue;
            return calls.map((call, index) => {
                const name = call.name || call.tool || call.function?.name;
                const rawArgs = call.arguments ?? call.args ?? call.input ?? call.function?.arguments ?? {};
                const args = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs || {});
                if (!name) return null;
                return {
                    id: call.id || `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
                    type: 'function',
                    function: { name, arguments: args },
                    index
                };
            }).filter(Boolean);
        } catch {
            // try next repair candidate
        }
    }
    return null;
}

function applyToolPrompt(systemMessage, tools) {
    const prompt = toolsToPrompt(tools);
    return prompt ? `${systemMessage || ''}${prompt}`.trim() : systemMessage;
}

function buildOpenAIToolResponse(result, mappedModel, toolCalls) {
    return {
        id: result.id || 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model || mappedModel || DEFAULT_MODEL,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: null,
                tool_calls: toolCalls.map(({ index, ...call }) => call)
            },
            finish_reason: 'tool_calls'
        }],
        usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        chatId: result.chatId,
        parentId: result.parentId || result.response_id,
        x_qwen_chat_id: result.chatId,
        x_qwen_parent_id: result.parentId || result.response_id
    };
}

function writeToolCallsSse(res, mappedModel, result, toolCalls) {
    const base = {
        id: result.id || 'chatcmpl-stream',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: result.model || mappedModel || DEFAULT_MODEL
    };
    res.write('data: ' + JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }]
    }) + '\n\n');
    for (const call of toolCalls) {
        // Chunk 1: Send ID, type, and function name
        res.write('data: ' + JSON.stringify({
            ...base,
            choices: [{
                index: 0,
                delta: {
                    tool_calls: [{
                        index: call.index,
                        id: call.id,
                        type: 'function',
                        function: { name: call.function.name, arguments: '' }
                    }]
                },
                finish_reason: null
            }]
        }) + '\n\n');
        
        // Chunk 2: Send arguments
        res.write('data: ' + JSON.stringify({
            ...base,
            choices: [{
                index: 0,
                delta: {
                    tool_calls: [{
                        index: call.index,
                        function: { arguments: call.function.arguments }
                    }]
                },
                finish_reason: null
            }]
        }) + '\n\n');
    }
    res.write('data: ' + JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
    }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
}

async function handleProviderOpenAICompletion(req, res, { messages, model, stream }) {
    const { body } = req;

    const combinedTools = body.tools && Array.isArray(body.tools) && body.tools.length > 0 ? body.tools : null;
    const captureToolCalls = Boolean(combinedTools);

    let effectiveMessages = messages;
    if (captureToolCalls) {
        effectiveMessages = [...messages];
        let systemMsgIndex = effectiveMessages.findIndex(m => m.role === 'system');
        const toolPrompt = toolsToPrompt(combinedTools);
        if (toolPrompt) {
            if (systemMsgIndex === -1) {
                effectiveMessages.unshift({ role: 'system', content: toolPrompt });
            } else {
                effectiveMessages[systemMsgIndex] = {
                    ...effectiveMessages[systemMsgIndex],
                    content: `${effectiveMessages[systemMsgIndex].content}\n\n${toolPrompt}`
                };
            }
        }
    }

    if (shouldUseDeepSeekProvider(body)) {
        const mappedModel = isDeepSeekModel(model || '') ? model : getDefaultDeepSeekModel();
        logInfo(`Routing request to DeepSeek provider, model: ${mappedModel}`);

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            const writeSse = (payload) => {
                res.write('data: ' + JSON.stringify(payload) + '\n\n');
            };

            let hasStreamedChunks = false;
            let result;
            let sseBuffer = '';
            let onChunk = null;

            if (stream && !captureToolCalls) {
                onChunk = (chunk) => {
                    hasStreamedChunks = true;
                    writeSse({
                        id: 'chatcmpl-deepseek-stream',
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: mappedModel,
                        choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
                    });
                };
            } else if (captureToolCalls) {
                onChunk = (chunk) => {
                    sseBuffer += chunk;
                };
            }

            try {
                result = await sendDeepSeekChatCompletion({
                    messages: effectiveMessages,
                    model: mappedModel,
                    stream: true,
                    chatId: body.chatId || body.chat_id,
                    parentId: body.parentId || body.parent_message_id,
                    onChunk
                });
            } catch (error) {
                result = { error: error.message };
            }

            if (result.error) {
                writeSse({
                    id: 'chatcmpl-deepseek-stream',
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel,
                    choices: [{ index: 0, delta: { content: `DeepSeek Error: ${result.error}` }, finish_reason: null }]
                });
            } else if (captureToolCalls) {
                const toolCalls = parseToolCallJson(result?.choices?.[0]?.message?.content || sseBuffer);
                if (toolCalls && toolCalls.length > 0) {
                    writeToolCallsSse(res, mappedModel, result || { id: 'chatcmpl-deepseek-stream' }, toolCalls);
                    return true;
                }
                writeSse({
                    id: result?.id || 'chatcmpl-deepseek-stream',
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel,
                    choices: [{ index: 0, delta: { content: sseBuffer || result?.choices?.[0]?.message?.content || '' }, finish_reason: null }]
                });
            } else if (!hasStreamedChunks && result.choices?.[0]?.message?.content) {
                writeSse({
                    id: result.id,
                    object: 'chat.completion.chunk',
                    created: result.created,
                    model: mappedModel,
                    choices: [{ index: 0, delta: { content: result.choices[0].message.content }, finish_reason: null }]
                });
            }

            writeSse({
                id: result.id || 'chatcmpl-deepseek-stream',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: mappedModel,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            });
            res.write('data: [DONE]\n\n');
            res.end();
            return true;
        }

        let result;
        try {
            result = await sendDeepSeekChatCompletion({
                messages: effectiveMessages,
                model: mappedModel,
                stream: false,
                chatId: body.chatId || body.chat_id,
                parentId: body.parentId || body.parent_message_id
            });
        } catch (error) {
            result = { error: error.message };
        }
        if (result.error) {
            res.status(500).json({ error: { message: result.error, type: 'deepseek_error' } });
            return true;
        }
        
        if (captureToolCalls) {
            const toolCalls = parseToolCallJson(result?.choices?.[0]?.message?.content);
            if (toolCalls && toolCalls.length > 0) {
                res.json(buildOpenAIToolResponse(result, mappedModel, toolCalls));
                return true;
            }
        }

        res.json(result);
        return true;
    }

    if (shouldUseKimiProvider(body)) {
        logInfo('Routing request to Kimi / Moonshot AI connector');
        const mappedModel = isKimiModel(model || '') ? model : getDefaultKimiModel();
        
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Connection', 'keep-alive');

            const writeSse = (payload) => {
                res.write('data: ' + JSON.stringify(payload) + '\n\n');
            };

            let hasStreamedChunks = false;
            let result;
            let sseBuffer = '';
            let onChunk = null;

            writeSse({
                id: 'chatcmpl-kimi-stream',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: mappedModel,
                choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
            });

            if (stream && !captureToolCalls) {
                onChunk = (chunk) => {
                    hasStreamedChunks = true;
                    writeSse({
                        id: 'chatcmpl-kimi-stream',
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: mappedModel,
                        choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
                    });
                };
            } else if (captureToolCalls) {
                onChunk = (chunk) => {
                    sseBuffer += chunk;
                };
            }

            try {
                result = await sendKimiChatCompletion({
                    messages: effectiveMessages,
                    model: mappedModel,
                    stream: true,
                    chatId: body.chatId || body.chat_id,
                    parentId: body.parentId || body.parent_message_id,
                    onChunk
                });
            } catch (error) {
                result = { error: error.message };
            }

            if (result && result.error) {
                writeSse({
                    id: 'chatcmpl-kimi-stream',
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel,
                    choices: [{ index: 0, delta: { content: `Kimi Error: ${result.error}` }, finish_reason: null }]
                });
            } else if (captureToolCalls) {
                const toolCalls = parseToolCallJson(result?.choices?.[0]?.message?.content || sseBuffer);
                if (toolCalls && toolCalls.length > 0) {
                    writeToolCallsSse(res, mappedModel, result || { id: 'chatcmpl-kimi-stream' }, toolCalls);
                    return true;
                }
                writeSse({
                    id: result?.id || 'chatcmpl-kimi-stream',
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel,
                    choices: [{ index: 0, delta: { content: sseBuffer || result?.choices?.[0]?.message?.content || '' }, finish_reason: null }]
                });
            } else if (!hasStreamedChunks && result && result.choices?.[0]?.message?.content) {
                writeSse({
                    id: result.id || 'chatcmpl-kimi-stream',
                    object: 'chat.completion.chunk',
                    created: result.created || Math.floor(Date.now() / 1000),
                    model: mappedModel,
                    choices: [{ index: 0, delta: { content: result.choices[0].message.content }, finish_reason: null }]
                });
            }

            writeSse({
                id: result?.id || 'chatcmpl-kimi-stream',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: mappedModel,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            });
            res.write('data: [DONE]\n\n');
            res.end();
            return true;
        }

        let result;
        try {
            result = await sendKimiChatCompletion({ messages: effectiveMessages, model: mappedModel, stream: false });
        } catch (error) {
            result = { error: error.message };
        }
        if (result.error) {
            res.status(500).json({ error: { message: result.error, type: 'kimi_error' } });
            return true;
        }
        
        if (captureToolCalls) {
            const toolCalls = parseToolCallJson(result?.choices?.[0]?.message?.content);
            if (toolCalls && toolCalls.length > 0) {
                res.json(buildOpenAIToolResponse(result, mappedModel, toolCalls));
                return true;
            }
        }
        
        res.json(result);
        return true;
    }

    if (shouldUseMinimaxProvider(body)) {
        logInfo('Routing request to MiniMax connector');
        const mappedModel = isMinimaxModel(model || '') ? model : getDefaultMinimaxModel();
        
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Connection', 'keep-alive');

            let hasStreamedChunks = false;
            try {
                await sendMinimaxChatCompletion({
                    messages,
                    model: mappedModel,
                    stream: true,
                    chatId: body.chatId || body.chat_id,
                    parentId: body.parentId || body.parent_message_id,
                    onChunk: (chunk) => {
                        hasStreamedChunks = true;
                        res.write('data: ' + JSON.stringify({
                            id: 'chatcmpl-minimax-stream',
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: mappedModel,
                            choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
                        }) + '\n\n');
                    }
                });
            } catch (error) {
                if (!hasStreamedChunks) {
                    res.write('data: ' + JSON.stringify({
                        id: 'chatcmpl-minimax-stream',
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: mappedModel,
                        choices: [{ index: 0, delta: { content: `MiniMax Error: ${error.message}` }, finish_reason: null }]
                    }) + '\n\n');
                }
            }
            res.write('data: ' + JSON.stringify({
                id: 'chatcmpl-minimax-stream',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: mappedModel,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            }) + '\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            return true;
        }

        let result;
        try {
            result = await sendMinimaxChatCompletion({ messages, model: mappedModel, stream: false });
        } catch (error) {
            result = { error: error.message };
        }
        if (result.error) {
            res.status(500).json({ error: { message: result.error, type: 'minimax_error' } });
            return true;
        }
        res.json(result);
        return true;
    }

    if (shouldUsePerplexityProvider(body)) {
        logInfo('Routing request to Perplexity connector');
        const mappedModel = isPerplexityModel(model || '') ? model : getDefaultPerplexityModel();
        
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Connection', 'keep-alive');

            let hasStreamedChunks = false;
            try {
                await sendPerplexityChatCompletion({
                    messages,
                    model: mappedModel,
                    stream: true,
                    chatId: body.chatId || body.chat_id,
                    onChunk: (chunk) => {
                        hasStreamedChunks = true;
                        res.write('data: ' + JSON.stringify({
                            id: 'chatcmpl-perplexity-stream',
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: mappedModel,
                            choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
                        }) + '\n\n');
                    }
                });
            } catch (error) {
                if (!hasStreamedChunks) {
                    res.write('data: ' + JSON.stringify({
                        id: 'chatcmpl-perplexity-stream',
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: mappedModel,
                        choices: [{ index: 0, delta: { content: `Perplexity Error: ${error.message}` }, finish_reason: null }]
                    }) + '\n\n');
                }
            }
            res.write('data: ' + JSON.stringify({
                id: 'chatcmpl-perplexity-stream',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: mappedModel,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            }) + '\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            return true;
        }

        let result;
        try {
            result = await sendPerplexityChatCompletion({ messages, model: mappedModel, stream: false });
        } catch (error) {
            result = { error: error.message };
        }
        if (result.error) {
            res.status(500).json({ error: { message: result.error, type: 'perplexity_error' } });
            return true;
        }
        res.json(result);
        return true;
    }

    if (shouldUseMimoProvider(body)) {
        logInfo('Routing request to MIMO connector');
        const mappedModel = isMimoModel(model || '') ? model : getDefaultMimoModel();
        
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Connection', 'keep-alive');

            let hasStreamedChunks = false;
            try {
                await sendMimoChatCompletion({
                    messages,
                    model: mappedModel,
                    stream: true,
                    chatId: body.chatId || body.chat_id,
                    onChunk: (chunk) => {
                        hasStreamedChunks = true;
                        res.write('data: ' + JSON.stringify({
                            id: 'chatcmpl-mimo-stream',
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: mappedModel,
                            choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
                        }) + '\n\n');
                    }
                });
            } catch (error) {
                if (!hasStreamedChunks) {
                    res.write('data: ' + JSON.stringify({
                        id: 'chatcmpl-mimo-stream',
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: mappedModel,
                        choices: [{ index: 0, delta: { content: `MIMO Error: ${error.message}` }, finish_reason: null }]
                    }) + '\n\n');
                }
            }
            res.write('data: ' + JSON.stringify({
                id: 'chatcmpl-mimo-stream',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: mappedModel,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            }) + '\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            return true;
        }

        let result;
        try {
            result = await sendMimoChatCompletion({ messages, model: mappedModel, stream: false });
        } catch (error) {
            result = { error: error.message };
        }
        if (result.error) {
            res.status(500).json({ error: { message: result.error, type: 'mimo_error' } });
            return true;
        }
        res.json(result);
        return true;
    }

    if (shouldUseHuggingFaceProvider(body)) {
        logInfo('Routing request to HuggingFace connector');
        const mappedModel = isHuggingFaceModel(model || '') ? model : getDefaultHuggingFaceModel();
        
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Connection', 'keep-alive');

            let hasStreamedChunks = false;
            try {
                await sendHuggingFaceChatCompletion({
                    messages,
                    model: mappedModel,
                    stream: true,
                    onChunk: (chunk) => {
                        hasStreamedChunks = true;
                        res.write('data: ' + JSON.stringify({
                            id: 'chatcmpl-hf-stream',
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: mappedModel,
                            choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
                        }) + '\n\n');
                    }
                });
            } catch (error) {
                if (!hasStreamedChunks) {
                    res.write('data: ' + JSON.stringify({
                        id: 'chatcmpl-hf-stream',
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: mappedModel,
                        choices: [{ index: 0, delta: { content: `HuggingFace Error: ${error.message}` }, finish_reason: null }]
                    }) + '\n\n');
                }
            }
            res.write('data: ' + JSON.stringify({
                id: 'chatcmpl-hf-stream',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: mappedModel,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            }) + '\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            return true;
        }

        let result;
        try {
            result = await sendHuggingFaceChatCompletion({ messages, model: mappedModel, stream: false });
        } catch (error) {
            result = { error: error.message };
        }
        if (result.error) {
            res.status(500).json({ error: { message: result.error, type: 'hf_error' } });
            return true;
        }
        res.json(result);
        return true;
    }

    if (!shouldUseZaiProvider(body)) return false;

    const mappedModel = isZaiModel(model || '') ? model : getDefaultZaiModel();
    logInfo(`Routing request to Z.ai provider, model: ${mappedModel}`);

    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const writeSse = (payload) => {
            res.write('data: ' + JSON.stringify(payload) + '\n\n');
        };

        let hasStreamedChunks = false;
        let result;
        let sseBuffer = '';
        let onChunk = null;

        if (stream && !captureToolCalls) {
            onChunk = (chunk) => {
                hasStreamedChunks = true;
                writeSse({
                    id: 'chatcmpl-zai-stream',
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel,
                    choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
                });
            };
        } else if (captureToolCalls) {
            onChunk = (chunk) => {
                sseBuffer += chunk;
            };
        }

        try {
            result = await sendZaiChatCompletion({
                messages: effectiveMessages,
                model: mappedModel,
                stream: true,
                onChunk
            });
        } catch (error) {
            result = { error: error.message };
        }

        if (result.error) {
            writeSse({
                id: 'chatcmpl-zai-stream',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: mappedModel,
                choices: [{ index: 0, delta: { content: `Z.ai Error: ${result.error}` }, finish_reason: null }]
            });
        } else if (captureToolCalls) {
            const toolCalls = parseToolCallJson(result?.choices?.[0]?.message?.content || sseBuffer);
            if (toolCalls && toolCalls.length > 0) {
                writeToolCallsSse(res, mappedModel, result || { id: 'chatcmpl-zai-stream' }, toolCalls);
                return true;
            }
            writeSse({
                id: result?.id || 'chatcmpl-zai-stream',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: mappedModel,
                choices: [{ index: 0, delta: { content: sseBuffer || result?.choices?.[0]?.message?.content || '' }, finish_reason: null }]
            });
        } else if (!hasStreamedChunks && result.choices?.[0]?.message?.content) {
            writeSse({
                id: result.id,
                object: 'chat.completion.chunk',
                created: result.created,
                model: mappedModel,
                choices: [{ index: 0, delta: { content: result.choices[0].message.content }, finish_reason: null }]
            });
        }

        writeSse({
            id: result.id || 'chatcmpl-zai-stream',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: mappedModel,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        });
        res.write('data: [DONE]\n\n');
        res.end();
        return true;
    }

    let result;
    try {
        result = await sendZaiChatCompletion({ messages: effectiveMessages, model: mappedModel, stream: false });
    } catch (error) {
        result = { error: error.message };
    }
    if (result.error) {
        res.status(500).json({ error: { message: result.error, type: 'zai_error' } });
        return true;
    }
    
    if (captureToolCalls) {
        const toolCalls = parseToolCallJson(result?.choices?.[0]?.message?.content);
        if (toolCalls && toolCalls.length > 0) {
            res.json(buildOpenAIToolResponse(result, mappedModel, toolCalls));
            return true;
        }
    }
    
    res.json(result);
    return true;
}

// ─── Helpers: streaming ──────────────────────────────────────────────────────

async function handleStreamingResponse(res, mappedModel, messageContent, chatId, parentId, combinedTools, toolChoice, systemMessage) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const writeSse = (payload) => res.write('data: ' + JSON.stringify(payload) + '\n\n');

    writeSse({
        id: 'chatcmpl-stream', object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000), model: mappedModel,
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
    });

    try {
        const result = await sendMessage(messageContent, mappedModel, chatId, parentId, null, combinedTools, toolChoice, systemMessage);

        if (result.error) {
            writeSse({
                id: 'chatcmpl-stream', object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000), model: mappedModel,
                choices: [{ index: 0, delta: { content: `Error: ${result.error}` }, finish_reason: null }]
            });
        } else if (result.choices?.[0]?.message) {
            const content = String(result.choices[0].message.content || '');
            const codePoints = Array.from(content);
            const chunkSize = 16;
            for (let i = 0; i < codePoints.length; i += chunkSize) {
                writeSse({
                    id: 'chatcmpl-stream', object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000), model: mappedModel,
                    choices: [{ index: 0, delta: { content: codePoints.slice(i, i + chunkSize).join('') }, finish_reason: null }]
                });
                await new Promise(r => setTimeout(r, STREAMING_CHUNK_DELAY));
            }
        }

        writeSse({
            id: 'chatcmpl-stream', object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000), model: mappedModel,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        });
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        logError('Error processing streaming request', error);
        writeSse({
            id: 'chatcmpl-stream', object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000), model: mappedModel,
            choices: [{ index: 0, delta: { content: 'Internal server error' }, finish_reason: 'stop' }]
        });
        res.write('data: [DONE]\n\n');
        res.end();
    }
}

function handleNonStreamingResponse(res, result, mappedModel) {
    if (result.error) {
        return res.status(500).json({ error: { message: result.error, type: 'server_error' } });
    }

    res.json({
        id: result.id || 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model || mappedModel,
        choices: result.choices || [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
        usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        chatId: result.chatId,
        parentId: result.parentId
    });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.post('/chat', async (req, res) => {
    try {
        const { message, messages, model, chatId, parentId, stream, chatType, size, waitForCompletion } = req.body;

        // Support both 'message' and 'messages' for backward compatibility
        let messageContent = message;
        let systemMessage = null;
        let allMessages = messages; // Persist the complete history
        const isMeta = isOpenWebUiMetaRequest(messages);

        if (messages && Array.isArray(messages)) {
            const parsed = parseOpenAIMessages(messages);
            systemMessage = parsed.systemMessage;
            if (parsed.messageContent) messageContent = parsed.messageContent;
        }

        if (!messageContent) {
            logError('Request without message');
            return res.status(400).json({ error: 'Message payload is missing' });
        }

        logInfo(`Received request: ${typeof messageContent === 'string' ? messageContent.substring(0, 50) + (messageContent.length > 50 ? '...' : '') : 'Multipart message'}`);
        if (systemMessage) {
            logInfo(`System message: ${systemMessage.substring(0, 50)}${systemMessage.length > 50 ? '...' : ''}`);
        }
        if (chatId && !isMeta) {
            logInfo(`Using chatId: ${chatId}, parentId: ${parentId || 'null'}`);
        } else if (isMeta) {
            logDebug('OpenWebUI meta-request detected: routing to isolated chat without session binding');
        }
        if (allMessages && allMessages.length > 1) {
            logInfo(`History contains ${allMessages.length} messages`);
        }

        let mappedModel = model || DEFAULT_MODEL;
        if (model) {
            mappedModel = getMappedModel(model);
            if (mappedModel !== model) {
                logInfo(`Model "${model}" mapped to "${mappedModel}"`);
            }
        }
        logInfo(`Using model: ${mappedModel}`);

        // Streaming support configured for OpenWebUI
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            // Essential for OpenWebUI: disable response caching
            res.setHeader('X-Accel-Buffering', 'no');

            const writeSse = (payload) => {
                res.write('data: ' + JSON.stringify(payload) + '\n\n');
            };

            try {
                // Setup streaming callback
                let streamingCallback = null;
                let hasStreamedChunks = false;
                if (stream) {
                    streamingCallback = (chunk) => {
                        hasStreamedChunks = true;
                        writeSse({
                            id: 'chatcmpl-' + Date.now(),
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: mappedModel || DEFAULT_MODEL,
                            choices: [
                                { index: 0, delta: { content: chunk }, finish_reason: null }
                            ]
                        });
                    };
                }

                const result = await sendMessage(
                    messageContent,
                    mappedModel,
                    isMeta ? null : chatId,
                    isMeta ? null : parentId,
                    null,
                    null,
                    null,
                    systemMessage,
                    't2t',
                    null,
                    true,
                    0,
                    streamingCallback
                );

                if (result.error) {
                    writeSse({
                        id: 'chatcmpl-' + Date.now(),
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: mappedModel || DEFAULT_MODEL,
                        choices: [
                            { index: 0, delta: { content: `Error: ${result.error}` }, finish_reason: 'stop' }
                        ]
                    });
                } else if (!hasStreamedChunks && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
                    // Received standard JSON response instead of SSE stream - dispatching content as a single chunk
                    const content = result.choices[0].message.content;
                    logDebug(`JSON response content length: ${content.length}`);
                    if (typeof streamingCallback === 'function') {
                        streamingCallback(content);
                    } else {
                        writeSse({
                            id: 'chatcmpl-stream',
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: mappedModel || DEFAULT_MODEL,
                            choices: [
                                { index: 0, delta: { content }, finish_reason: null }
                            ]
                        });
                    }
                } else {
                    logDebug(`Result structure: ${JSON.stringify(Object.keys(result))}`);
                }
                // Chunks were already dispatched via streamingCallback; avoiding duplication

                // Final terminal chunk
                writeSse({
                    id: 'chatcmpl-' + Date.now(),
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel || DEFAULT_MODEL,
                    choices: [
                        { index: 0, delta: {}, finish_reason: 'stop' }
                    ]
                });
                res.write('data: [DONE]\n\n');
                res.end();
                return;
            } catch (error) {
                logError('Error processing streaming request', error);
                writeSse({
                    id: 'chatcmpl-stream',
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel || DEFAULT_MODEL,
                    choices: [
                        { index: 0, delta: { content: 'Internal server error' }, finish_reason: 'stop' }
                    ]
                });
                res.write('data: [DONE]\n\n');
                res.end();
                return;
            }
        }

            const result = await sendMessage(messageContent, mappedModel, isMeta ? null : chatId, isMeta ? null : parentId, null, null, null, systemMessage, chatType || 't2t', size || null, waitForCompletion ?? true);

        if (result.choices && result.choices[0] && result.choices[0].message) {
            const responseLength = result.choices[0].message.content ? result.choices[0].message.content.length : 0;
            logInfo(`Response successfully generated, response length: ${responseLength}`);
            
            // Persist conversation history
            if (result.chatId) {
                try {
                    const currentChat = loadHistory(result.chatId);
                    const updatedMessages = allMessages || [
                        { role: 'user', content: messageContent },
                        { role: 'assistant', content: result.choices[0].message.content }
                    ];
                    saveHistory(result.chatId, { ...currentChat, messages: updatedMessages });
                } catch (e) {
                    logDebug(`Failed to save history: ${e.message}`);
                }
            }
        } else if (result.error) {
            logInfo(`Received error in response: ${result.error}`);
        }

        res.json(result);
    } catch (error) {
        logError('Error processing request', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/health', async (req, res) => {
    try {
        const modelData = getAllModels();
        const tokens = listTokens();
        const now = Date.now();
        const availableAccounts = tokens.filter(t => (!t.resetAt || new Date(t.resetAt).getTime() <= now) && !t.invalid).length;

        res.json({
            ...getServiceMetadata(),
            ok: availableAccounts > 0,
            baseUrl: '/api',
            models: modelData.models.length,
            accounts: {
                total: tokens.length,
                available: availableAccounts,
                invalid: tokens.filter(t => t.invalid).length,
                waiting: tokens.filter(t => t.resetAt && new Date(t.resetAt).getTime() > now).length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logError('Health check error', error);
        res.status(500).json({ ok: false, error: 'Health check validation failed' });
    }
});

router.get('/models', async (req, res) => {
    try {
        logInfo('Models list request');
        const modelsRaw = getAllModels();
        let zaiModels = [];
        let deepSeekModels = [];
        let kimiModels = [];
        let minimaxModels = [];
        let perplexityModels = [];
        let mimoModels = [];
        let hfModels = [];
        try {
            const status = getZaiSessionStatus();
            if (status.available) zaiModels = await getZaiModels();
        } catch (error) {
            logWarn(`Z.ai models unavailable: ${error.message}`);
        }
        try {
            const status = getDeepSeekSessionStatus();
            if (status.available) deepSeekModels = getDeepSeekModels();
        } catch (error) {
            logWarn(`DeepSeek models unavailable: ${error.message}`);
        }
        try {
            const status = getKimiSessionStatus();
            if (status.available) kimiModels = getKimiModels();
        } catch (error) {
            logWarn(`Kimi models unavailable: ${error.message}`);
        }
        try {
            const status = getMinimaxSessionStatus();
            if (status.available) minimaxModels = getMinimaxModels();
        } catch (error) {
            logWarn(`MiniMax models unavailable: ${error.message}`);
        }
        try {
            const status = getPerplexitySessionStatus();
            if (status.available) perplexityModels = getPerplexityModels();
        } catch (error) {
            logWarn(`Perplexity models unavailable: ${error.message}`);
        }
        try {
            const status = getMimoSessionStatus();
            if (status.available) mimoModels = getMimoModels();
        } catch (error) {
            logWarn(`MIMO models unavailable: ${error.message}`);
        }
        try {
            const status = getHuggingFaceSessionStatus();
            if (status.available) hfModels = getHuggingFaceModels();
        } catch (error) {
            logWarn(`HuggingFace models not available: ${error.message}`);
        }
        const openAiModels = {
            object: 'list',
            data: [
                ...modelsRaw.models.map(m => ({
                    id: m.id || m.name || m,
                    object: 'model',
                    created: 0,
                    owned_by: 'qwen',
                    provider: 'qwen',
                    permission: []
                })),
                ...zaiModels,
                ...deepSeekModels,
                ...kimiModels,
                ...minimaxModels,
                ...perplexityModels,
                ...mimoModels,
                ...hfModels
            ]
        };
        logInfo(`Returned ${openAiModels.data.length} models (OpenAI format)`);
        res.json(openAiModels);
    } catch (error) {
        logError('Error retrieving models list', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/providers/zai/status', (req, res) => {
    res.json(getZaiSessionStatus());
});

router.get('/providers/deepseek/status', (req, res) => {
    res.json(getDeepSeekSessionStatus());
});

router.get('/providers/kimi/status', (req, res) => {
    res.json(getKimiSessionStatus());
});

router.get('/providers/minimax/status', (req, res) => {
    res.json(getMinimaxSessionStatus());
});

router.get('/providers/active', (req, res) => {
    res.json(getActiveProviderProfile());
});

router.post('/providers/active', (req, res) => {
    const activeProvider = setActiveProvider(req.body?.provider || req.body?.activeProvider);
    res.json(getActiveProviderProfile());
});

router.get('/providers/auth-modes', (req, res) => {
    res.json({
        modes: getProviderAuthModes(),
        validModes: ['account', 'guest']
    });
});

router.post('/providers/auth-modes', (req, res) => {
    try {
        const provider = req.body?.provider;
        const mode = req.body?.mode || req.body?.authMode;
        const authMode = setProviderAuthMode(provider, mode);
        res.json({
            provider,
            authMode,
            modes: getProviderAuthModes()
        });
    } catch (error) {
        res.status(400).json({
            error: 'invalid_provider_auth_mode',
            message: error.message
        });
    }
});

router.get('/status', async (req, res) => {
    try {
        logInfo('Authorization status request');
        const tokens = listTokens();
        const accounts = await Promise.all(tokens.map(async t => {
            const accInfo = { id: t.id, status: 'UNKNOWN', resetAt: t.resetAt || null };

            if (t.resetAt) {
                const resetTime = new Date(t.resetAt).getTime();
                if (resetTime > Date.now()) { accInfo.status = 'WAIT'; return accInfo; }
            }

            const testResult = await testToken(t.token);
            if (testResult === 'OK') { accInfo.status = 'OK'; if (t.invalid || t.resetAt) markValid(t.id); }
            else if (testResult === 'RATELIMIT') { accInfo.status = 'WAIT'; markRateLimited(t.id, 24); }
            else if (testResult === 'UNAUTHORIZED') { accInfo.status = 'INVALID'; if (!t.invalid) markInvalid(t.id); }
            else { accInfo.status = 'ERROR'; }
            return accInfo;
        }));

        const browserContext = getBrowserContext();
        if (!browserContext) {
            logError('Browser not initialized');
            return res.json({ authenticated: false, message: 'Browser not initialized', accounts });
        }

        if (getAuthenticationStatus()) return res.json({ accounts });

        await checkAuthentication(browserContext);
        const isAuthenticated = getAuthenticationStatus();
        logInfo(`Authorization status: ${isAuthenticated ? 'active' : 'authorization required'}`);
        res.json({ authenticated: isAuthenticated, message: isAuthenticated ? 'Authorization active' : 'Authorization required', accounts });
    } catch (error) {
        logError('Error checking authorization status', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/chats', async (req, res) => {
    try {
        const { name, model } = req.body;
        const chatModel = model ? getMappedModel(model) : DEFAULT_MODEL;
        logInfo(`Creating new chat${name ? ` with name: ${name}` : ''}, model: ${chatModel}`);
        const result = await createChatV2(chatModel, name || 'New Conversation');
        if (result.error) { logError(`Error creating chat: ${result.error}`); return res.status(500).json({ error: result.error }); }
        logInfo(`Created new v2 chat with ID: ${result.chatId}`);
        res.json({ chatId: result.chatId, success: true });
    } catch (error) {
        logError('Error creating chat', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/chat/completions', (req, res) => {
    res.status(405).json({
        error: 'Method not supported',
        message: 'Please utilize POST /api/chat/completions'
    });
});

router.get('/tokens', async (req, res) => {
    try {
        const { TokenManager } = await import('./tokenManager.js');
        const providers = ['qwen', 'zai', 'deepseek', 'kimi', 'minimax', 'huggingface', 'perplexity', 'mimo'];
        let allTokens = [];
        
        for (const p of providers) {
            let tokens = [];
            if (p === 'qwen') {
                tokens = listTokens();
            } else {
                const tm = new TokenManager(p);
                tokens = tm.listTokens();
            }
            tokens.forEach(t => allTokens.push({
                provider: p,
                id: t.id,
                email: t.email || null,
                invalid: !!t.invalid,
                resetAt: t.resetAt || null
            }));
        }

        res.json({
            count: allTokens.length,
            tokens: allTokens
        });
    } catch (e) {
        logError('Error fetching tokens', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/embeddings', (req, res) => {
    const { model = 'text-embedding-ada-002', input } = req.body;
    const inputs = Array.isArray(input) ? input : [input || ''];
    const data = inputs.map((text, index) => {
        // Return a dummy 1536-dimensional embedding vector to satisfy strict clients like continue.dev
        const vec = new Array(1536).fill(0).map((_, i) => Math.sin((typeof text === 'string' ? text.length : 10) + i) * 0.1);
        return { object: 'embedding', embedding: vec, index };
    });
    res.json({ object: 'list', data, model, usage: { prompt_tokens: 0, total_tokens: 0 } });
});

router.post(['/chat/completions', '/completions'], async (req, res) => {
    try {
        if (!req.body.messages && req.body.prompt) {
            const prompt = req.body.prompt;
            req.body.messages = [{ role: 'user', content: Array.isArray(prompt) ? prompt.join('\n') : prompt }];
        }
        const { messages, model, stream, tools, functions, tool_choice, chatId } = req.body;
        const snakeCaseChatId = normalizeIdValue(req.body?.chat_id);
        const explicitChatId = normalizeIdValue(chatId) || snakeCaseChatId;
        const explicitParentId = extractParentHint(req);
        const conversationHint = extractConversationHint(req);
        const conversationScope = conversationHint ? `conversation:${conversationHint}` : null;
        const forceNewChat = shouldForceNewChat(req);
        logInfo(`Received OpenAI-compatible request${stream ? ' (stream)' : ''}`);

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            logError('Request contains no messages');
            return res.status(400).json({ error: 'Messages payload is missing' });
        }

        if (await handleProviderOpenAICompletion(req, res, { messages, model, stream })) {
            return;
        }

        const isMeta = isOpenWebUiMetaRequest(messages);

        // Utilize provided chatId OR restore context from session
        let effectiveChatId = explicitChatId;
        let effectiveParentId = explicitParentId;

        if (forceNewChat && !explicitChatId && !isMeta) {
            effectiveChatId = `chat_${crypto.randomBytes(8).toString('hex')}`;
            effectiveParentId = null;
            logInfo(`Forced new chat requested (newChat/resetChat): ${effectiveChatId}`);
        }

        if (!effectiveChatId && !isMeta) {
            if (conversationHint) {
                const scopedSession = forceNewChat ? null : getSavedChatId(req, conversationScope);
                if (scopedSession?.chatId) {
                    effectiveChatId = scopedSession.chatId;
                    if (!effectiveParentId && scopedSession.parentId) {
                        effectiveParentId = scopedSession.parentId;
                    }
                    logInfo(`Restored scoped chatId from session: ${effectiveChatId}`);
                } else {
                    effectiveChatId = buildInternalChatIdFromHint(conversationHint);
                    logInfo(`Using client conversation-id key: ${effectiveChatId}`);
                }
            } else if (ALLOW_UNSCOPED_SESSION_CHAT_RESTORE) {
                const savedSession = forceNewChat ? null : getSavedChatId(req);
                if (savedSession?.chatId) {
                    effectiveChatId = savedSession.chatId;
                    if (!effectiveParentId && savedSession.parentId) {
                        effectiveParentId = savedSession.parentId;
                    }
                    logInfo(`Restored chatId from session: ${effectiveChatId}`);
                }

                if (!effectiveChatId) {
                    const generatedId = generateChatIdFromHistory(messages);
                    if (generatedId) {
                        effectiveChatId = generatedId;
                        logInfo(`Created new chatId for session: ${effectiveChatId}`);
                    }
                }
            } else {
                logDebug('chatId/conversation_id omitted, unscoped session fallback is disabled');
            }
        }

        // Extract system message if present in payload
        const systemMsg = messages.find(msg => msg.role === 'system');
        const systemMessage = systemMsg ? systemMsg.content : null;
        const { combinedTools } = buildCombinedTools(tools, functions, tool_choice);

        const preparedInput = prepareOpenAIMessageInput(messages, combinedTools, effectiveChatId);
        if (preparedInput.missingUser) {
            logError('No user messages in request');
            return res.status(400).json({ error: 'No user messages in request' });
        }

        let messageContent = preparedInput.messageContent;
        
        // Transform OpenAI format content array into internal unified format
        if (Array.isArray(messageContent)) {
            messageContent = messageContent.map(item => {
                if (item.type === 'text') {
                    return { type: 'text', text: item.text };
                } else if (item.type === 'image_url' && item.image_url) {
                    // OpenAI format: image_url: { url: '...' }
                    return { type: 'image', image: item.image_url.url };
                } else if (item.type === 'image') {
                    // Already in the internal unified format
                    return { type: 'image', image: item.image };
                }
                return item;
            });
        }
        
        const files = preparedInput.files || []; // ← EXTRACT FILES
        if (preparedInput.folded) {
            logInfo('OpenAI/Hermes transcript folded into user message for context/tool-result preservation');
        }

        if (isMeta) {
            effectiveChatId = null;
            effectiveParentId = null;
            logDebug('OpenWebUI meta-request detected: routing to isolated chat without session binding');
        }

        let mappedModel = model ? getMappedModel(model) : DEFAULT_MODEL;
        if (model && mappedModel !== model) {
            logInfo(`Model "${model}" mapped to "${mappedModel}"`);
        }
        logInfo(`Using model: ${mappedModel}`);
        if (systemMessage) logInfo(`System message: ${systemMessage.substring(0, 50)}${systemMessage.length > 50 ? '...' : ''}`);

        const qwenTools = null; // Qwen Chat web API lacks native OpenAI tool schema support; emulating via JSON prompt.
        const toolAwareSystemMessage = applyToolPrompt(systemMessage, combinedTools);

        if (toolAwareSystemMessage) {
            logInfo(`System message: ${toolAwareSystemMessage.substring(0, 50)}${toolAwareSystemMessage.length > 50 ? '...' : ''}`);
        }

        // Log complete message history pipeline
        logInfo(`History contains ${messages.length} messages: ${messages.map(m => m.role).join(', ')}`);
        if (effectiveChatId) {
            logInfo(`Using chatId: ${effectiveChatId}, parentId: ${effectiveParentId || 'null'}`);
        }

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Transfer-Encoding', 'chunked');

            const writeSse = (payload) => {
                res.write('data: ' + JSON.stringify(payload) + '\n\n');
            };

            try {
                const qwenChatId = await resolveQwenChatId(effectiveChatId, mappedModel);

                // Setup streaming callback if stream=true
                let streamingCallback = null;
                let hasStreamedChunks = false;
                const captureToolCalls = Array.isArray(combinedTools) && combinedTools.length > 0;
                if (stream && !captureToolCalls) {
                    streamingCallback = (chunk) => {
                        hasStreamedChunks = true;
                        writeSse({
                            id: 'chatcmpl-stream',
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: mappedModel || DEFAULT_MODEL,
                            choices: [
                                { index: 0, delta: { content: chunk }, finish_reason: null }
                            ]
                        });
                    };
                }

                const result = await sendMessage(
                    messageContent,
                    mappedModel,
                    qwenChatId,
                    effectiveParentId,
                    files, // ← FORWARD FILES
                    qwenTools,
                    tool_choice,
                    toolAwareSystemMessage,
                    't2t',
                    null,
                    true,
                    0,
                    streamingCallback
                );

                if (captureToolCalls) {
                    const toolCalls = parseToolCallJson(result?.choices?.[0]?.message?.content);
                    if (toolCalls && toolCalls.length > 0) {
                        writeToolCallsSse(res, mappedModel, result, toolCalls);
                        return;
                    }
                }

                // Bind chatId to session state for subsequent requests
                if (!isMeta && result.chatId) {
                    // If a generated effectiveChatId was utilized — persist the mapping
                    if (effectiveChatId && effectiveChatId.startsWith('chat_') && result.chatId) {
                        mapChatId(effectiveChatId, result.chatId);
                        logDebug(`Mapping registered: ${effectiveChatId} -> ${result.chatId}`);
                    }
                    if (shouldPersistSessionContext(conversationScope)) {
                        saveChatIdForSession(req, result.chatId, result.parentId, conversationScope);
                    }
                }

                if (result.error) {
                    writeSse({
                        id: 'chatcmpl-stream',
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: mappedModel || DEFAULT_MODEL,
                        choices: [
                            { index: 0, delta: { content: `Error: ${result.error}` }, finish_reason: null }
                        ]
                    });
                } else if (!hasStreamedChunks && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
                    // Received standard JSON response instead of SSE stream - dispatching content as a single chunk
                    const content = result.choices[0].message.content;
                    logDebug(`JSON response content length: ${content.length}`);
                    if (typeof streamingCallback === 'function') {
                        streamingCallback(content);
                    } else {
                        writeSse({
                            id: 'chatcmpl-stream',
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: mappedModel || DEFAULT_MODEL,
                            choices: [
                                { index: 0, delta: { content }, finish_reason: null }
                            ]
                        });
                    }
                } else {
                    logDebug(`Result structure: ${JSON.stringify(Object.keys(result))}`);
                }
                // Chunks were already dispatched via streamingCallback; avoiding duplication

                writeSse({
                    id: 'chatcmpl-stream',
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel || DEFAULT_MODEL,
                    choices: [
                        { index: 0, delta: {}, finish_reason: 'stop' }
                    ]
                });
                res.write('data: [DONE]\n\n');
                res.end();

            } catch (error) {
                logError('Error processing streaming request', error);
                writeSse({
                    id: 'chatcmpl-stream',
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel || DEFAULT_MODEL,
                    choices: [
                        { index: 0, delta: { content: 'Internal server error' }, finish_reason: 'stop' }
                    ]
                });
                res.write('data: [DONE]\n\n');
                res.end();
            }
        } else {
            const qwenChatId = await resolveQwenChatId(effectiveChatId, mappedModel);
            const result = await sendMessage(messageContent, mappedModel, qwenChatId, effectiveParentId, null, qwenTools, tool_choice, toolAwareSystemMessage);

            // Bind chatId to session state for subsequent requests
            if (!isMeta && result.chatId) {
                if (effectiveChatId && effectiveChatId.startsWith('chat_') && result.chatId) {
                    mapChatId(effectiveChatId, result.chatId);
                    logDebug(`Mapping registered: ${effectiveChatId} -> ${result.chatId}`);
                }
                if (shouldPersistSessionContext(conversationScope)) {
                    saveChatIdForSession(req, result.chatId, result.parentId, conversationScope);
                }
            }

            if (result.error) {
                return res.status(500).json({
                    error: { message: result.error, type: "server_error" }
                });
            }

            const toolCalls = parseToolCallJson(result?.choices?.[0]?.message?.content);
            if (toolCalls && toolCalls.length > 0) {
                return res.json(buildOpenAIToolResponse(result, mappedModel, toolCalls));
            }

            const openaiResponse = {
                id: result.id || "chatcmpl-" + Date.now(),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: result.model || mappedModel || DEFAULT_MODEL,
                choices: result.choices || [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: result.choices?.[0]?.message?.content || ""
                    },
                    finish_reason: "stop"
                }],
                usage: result.usage || {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                },
                chatId: result.chatId,
                parentId: result.parentId
            };

            // Persist conversation history
            if (result.chatId) {
                try {
                    const currentChat = loadHistory(result.chatId);
                    const responseMessage = {
                        role: 'assistant',
                        content: openaiResponse.choices[0].message.content
                    };
                    const updatedMessages = messages.concat([responseMessage]);
                    saveHistory(result.chatId, { ...currentChat, messages: updatedMessages });
                } catch (e) {
                    logDebug(`Failed to save history: ${e.message}`);
                }
            }

            res.json(openaiResponse);
        }
    } catch (error) {
        logError('Error processing request', error);
        res.status(500).json({ error: { message: 'Internal server error', type: "server_error" } });
    }
});

// OpenAI compatible v1 endpoint for Open WebUI and downstream clients
router.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, model, stream, tools, functions, tool_choice, chatId } = req.body;
        const snakeCaseChatId = normalizeIdValue(req.body?.chat_id);
        const explicitChatId = normalizeIdValue(chatId) || snakeCaseChatId;
        const explicitParentId = extractParentHint(req);
        const conversationHint = extractConversationHint(req);
        const conversationScope = conversationHint ? `conversation:${conversationHint}` : null;
        const forceNewChat = shouldForceNewChat(req);

        logInfo(`Received OpenAI v1 request${stream ? ' (stream)' : ''}`);

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            logError('Request contains no messages');
            return res.status(400).json({ error: 'Messages payload is missing' });
        }

        if (await handleProviderOpenAICompletion(req, res, { messages, model, stream })) {
            return;
        }

        const isMeta = isOpenWebUiMetaRequest(messages);

        // Utilize provided chatId OR restore context from session
        let effectiveChatId = explicitChatId;
        let effectiveParentId = explicitParentId;

        if (forceNewChat && !explicitChatId && !isMeta) {
            effectiveChatId = `chat_${crypto.randomBytes(8).toString('hex')}`;
            effectiveParentId = null;
            logInfo(`Forced new chat requested (newChat/resetChat): ${effectiveChatId}`);
        }

        if (!effectiveChatId && !isMeta) {
            if (conversationHint) {
                const scopedSession = forceNewChat ? null : getSavedChatId(req, conversationScope);
                if (scopedSession?.chatId) {
                    effectiveChatId = scopedSession.chatId;
                    if (!effectiveParentId && scopedSession.parentId) {
                        effectiveParentId = scopedSession.parentId;
                    }
                    logInfo(`Restored scoped chatId from session: ${effectiveChatId}`);
                } else {
                    effectiveChatId = buildInternalChatIdFromHint(conversationHint);
                    logInfo(`Using client conversation-id key: ${effectiveChatId}`);
                }
            } else if (ALLOW_UNSCOPED_SESSION_CHAT_RESTORE) {
                const savedSession = forceNewChat ? null : getSavedChatId(req);
                if (savedSession?.chatId) {
                    effectiveChatId = savedSession.chatId;
                    if (!effectiveParentId && savedSession.parentId) {
                        effectiveParentId = savedSession.parentId;
                    }
                    logInfo(`Restored chatId from session: ${effectiveChatId}`);
                }

                if (!effectiveChatId) {
                    const generatedId = generateChatIdFromHistory(messages);
                    if (generatedId) {
                        effectiveChatId = generatedId;
                        logInfo(`Created new chatId for session: ${effectiveChatId}`);
                    }
                }
            } else {
                logDebug('chatId/conversation_id omitted, unscoped session fallback is disabled');
            }
        }

        // Extract system message if present in payload
        const systemMsg = messages.find(msg => msg.role === 'system');
        const systemMessage = systemMsg ? systemMsg.content : null;
        const { combinedTools } = buildCombinedTools(tools, functions, tool_choice);

        const preparedInput = prepareOpenAIMessageInput(messages, combinedTools, effectiveChatId);
        if (preparedInput.missingUser) {
            logError('No user messages in request');
            return res.status(400).json({ error: 'No user messages in request' });
        }

        let messageContent = preparedInput.messageContent;
        
        // Transform OpenAI format content array into internal unified format
        if (Array.isArray(messageContent)) {
            messageContent = messageContent.map(item => {
                if (item.type === 'text') {
                    return { type: 'text', text: item.text };
                } else if (item.type === 'image_url' && item.image_url) {
                    // OpenAI format: image_url: { url: '...' }
                    return { type: 'image', image: item.image_url.url };
                } else if (item.type === 'image') {
                    // Already in the internal unified format
                    return { type: 'image', image: item.image };
                }
                return item;
            });
        }
        
        const files = preparedInput.files || []; // ← EXTRACT FILES
        if (preparedInput.folded) {
            logInfo('OpenAI/Hermes transcript folded into user message for context/tool-result preservation');
        }

        if (isMeta) {
            effectiveChatId = null;
            effectiveParentId = null;
            logDebug('OpenWebUI meta-request detected: routing to isolated chat without session binding');
        }

        let mappedModel = model ? getMappedModel(model) : DEFAULT_MODEL;
        if (model && mappedModel !== model) {
            logInfo(`Model "${model}" mapped to "${mappedModel}"`);
        }
        logInfo(`Using model: ${mappedModel}`);

        if (systemMessage) {
            logInfo(`System message: ${systemMessage.substring(0, 50)}${systemMessage.length > 50 ? '...' : ''}`);
        }

        const qwenTools = null; // Qwen Chat web API lacks native OpenAI tool schema support; emulating via JSON prompt.
        const toolAwareSystemMessage = applyToolPrompt(systemMessage, combinedTools);
        if (toolAwareSystemMessage) {
            logInfo(`System message: ${toolAwareSystemMessage.substring(0, 50)}${toolAwareSystemMessage.length > 50 ? '...' : ''}`);
        }

        // Log complete message history pipeline
        logInfo(`History contains ${messages.length} messages: ${messages.map(m => m.role).join(', ')}`);
        if (effectiveChatId) {
            logInfo(`Using chatId: ${effectiveChatId}, parentId: ${effectiveParentId || 'null'}`);
        }

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Transfer-Encoding', 'chunked');

            const writeSse = (payload) => {
                res.write('data: ' + JSON.stringify(payload) + '\n\n');
            };

            try {
                const qwenChatId = await resolveQwenChatId(effectiveChatId, mappedModel);

                // Setup streaming callback if stream=true
                let streamingCallback = null;
                let hasStreamedChunks = false;
                const captureToolCalls = Array.isArray(combinedTools) && combinedTools.length > 0;
                if (stream && !captureToolCalls) {
                    streamingCallback = (chunk) => {
                        hasStreamedChunks = true;
                        // OpenWebUI omits role in chunks - content only required
                        writeSse({
                            id: 'chatcmpl-' + Date.now(),
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: mappedModel || DEFAULT_MODEL,
                            choices: [
                                { index: 0, delta: { content: chunk }, finish_reason: null }
                            ]
                        });
                    };
                }
                
                const result = await sendMessage(
                    messageContent,
                    mappedModel,
                    qwenChatId,
                    effectiveParentId,
                    files, // ← EXTRACT FILES
                    qwenTools,
                    tool_choice,
                    toolAwareSystemMessage,
                    't2t',
                    null,
                    true,
                    0,
                    streamingCallback
                );

                if (captureToolCalls) {
                    const toolCalls = parseToolCallJson(result?.choices?.[0]?.message?.content);
                    if (toolCalls && toolCalls.length > 0) {
                        writeToolCallsSse(res, mappedModel, result, toolCalls);
                        return;
                    }
                }

                // Bind chatId to session state for subsequent requests
                if (!isMeta && result.chatId) {
                    if (shouldPersistSessionContext(conversationScope)) {
                        saveChatIdForSession(req, result.chatId, result.parentId, conversationScope);
                    }
                }

                if (result.error) {
                    writeSse({
                        id: 'chatcmpl-stream',
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: mappedModel || DEFAULT_MODEL,
                        choices: [
                            { index: 0, delta: { content: `Error: ${result.error}` }, finish_reason: 'stop' }
                        ]
                    });
                } else if (!hasStreamedChunks && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
                    // Received standard JSON response instead of SSE stream - dispatching content as a single chunk
                    const content = result.choices[0].message.content;
                    logDebug(`JSON response content length: ${content.length}`);
                    if (typeof streamingCallback === 'function') {
                        streamingCallback(content);
                    } else {
                        writeSse({
                            id: 'chatcmpl-stream',
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: mappedModel || DEFAULT_MODEL,
                            choices: [
                                { index: 0, delta: { content }, finish_reason: null }
                            ]
                        });
                    }
                } else {
                    logDebug(`Result structure: ${JSON.stringify(Object.keys(result))}`);
                }
                // Chunks were already dispatched via streamingCallback; avoiding duplication

                writeSse({
                    id: 'chatcmpl-stream',
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel || DEFAULT_MODEL,
                    choices: [
                        { index: 0, delta: {}, finish_reason: 'stop' }
                    ]
                });
                res.write('data: [DONE]\n\n');
                res.end();

            } catch (error) {
                logError('Error processing streaming request', error);
                writeSse({
                    id: 'chatcmpl-stream',
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: mappedModel || DEFAULT_MODEL,
                    choices: [
                        { index: 0, delta: { content: 'Internal server error' }, finish_reason: 'stop' }
                    ]
                });
                res.write('data: [DONE]\n\n');
                res.end();
            }
        } else {
            const qwenChatId = await resolveQwenChatId(effectiveChatId, mappedModel);

            const result = await sendMessage(messageContent, mappedModel, qwenChatId, effectiveParentId, files, qwenTools, tool_choice, toolAwareSystemMessage);

            // Bind chatId to session state for subsequent client requests
            if (!isMeta && result.chatId) {
                // If a generated effectiveChatId was utilized — persist the mapping
                if (effectiveChatId && effectiveChatId.startsWith('chat_') && result.chatId) {
                    mapChatId(effectiveChatId, result.chatId);
                    logDebug(`Mapping registered: ${effectiveChatId} -> ${result.chatId}`);
                }
                if (shouldPersistSessionContext(conversationScope)) {
                    saveChatIdForSession(req, result.chatId, result.parentId, conversationScope);
                }
            }

            if (result.error) {
                return res.status(500).json({
                    error: { message: result.error, type: "server_error" }
                });
            }

            // Extract the message payload content
            let messageText = '';
            if (result.choices && result.choices[0] && result.choices[0].message) {
                messageText = result.choices[0].message.content || '';
            } else if (result.response && result.response.text) {
                messageText = result.response.text;
            }

            const toolCalls = parseToolCallJson(messageText);
            if (toolCalls && toolCalls.length > 0) {
                return res.json(buildOpenAIToolResponse(result, mappedModel, toolCalls));
            }

            const openaiResponse = {
                id: result.id || "chatcmpl-" + Date.now(),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: result.model || mappedModel || DEFAULT_MODEL,
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: messageText
                    },
                    finish_reason: "stop"
                }],
                usage: result.usage || {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                },
                // Forward metadata attributes to persist context
                x_qwen_chat_id: result.chatId,
                x_qwen_parent_id: result.parentId || result.response_id
            };

            // Persist conversation history for v1 endpoint
            if (result.chatId) {
                // Bind chatId to session state for subsequent client requests
                if (!isMeta) {
                    try {
                        if (shouldPersistSessionContext(conversationScope)) {
                            saveChatIdForSession(req, result.chatId, result.parentId || result.response_id, conversationScope);
                        }
                    } catch (e) {
                        logDebug(`Failed to save chatId in session: ${e.message}`);
                    }
                }

                try {
                    const currentChat = loadHistory(result.chatId);
                    const responseMessage = {
                        role: 'assistant',
                        content: messageText
                    };
                    const updatedMessages = messages.concat([responseMessage]);
                    saveHistory(result.chatId, { ...currentChat, messages: updatedMessages });
                } catch (e) {
                    logDebug(`Failed to save history: ${e.message}`);
                }
            }

            res.json(openaiResponse);
        }
    } catch (error) {
        logError('Error processing v1 request', error);
        res.status(500).json({ error: { message: 'Internal server error', type: "server_error" } });
    }
});

router.post('/files/getstsToken', async (req, res) => {
    try {
        logInfo(`Request for STS token: ${JSON.stringify(req.body)}`);
        const fileInfo = req.body;
        if (!fileInfo?.filename || !fileInfo?.filesize || !fileInfo?.filetype) {
            logError('Invalid file data');
            return res.status(400).json({ error: 'Invalid file data' });
        }
        res.json(await getStsToken(fileInfo));
    } catch (error) {
        logError('Error getting STS token', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/files/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) { logError('File was not uploaded'); return res.status(400).json({ error: 'File was not uploaded' }); }
        logInfo(`File uploaded to server: ${req.file.originalname} (${req.file.size} bytes)`);

        const result = await uploadFileToQwen(req.file.path);

        try { fs.unlinkSync(req.file.path); } catch { /* file already removed or inaccessible */ }

        if (result.success) {
            logInfo(`File successfully uploaded to OSS: ${result.fileName}`);
            res.json({ success: true, file: { name: result.fileName, url: result.url, size: req.file.size, type: req.file.mimetype } });
        } else {
            logError(`Error uploading file to OSS: ${result.error}`);
            res.status(500).json({ error: 'Error uploading file' });
        }
    } catch (error) {
        logError('Error uploading file', error);
        if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to persist chat history context (Open WebUI integration)
router.post('/chats/:chatId/history', async (req, res) => {
    try {
        const { chatId } = req.params;
        const { messages } = req.body;

        logInfo(`Request to save history for chat: ${chatId}`);

        if (!messages || !Array.isArray(messages)) {
            logError('Message history is missing or invalid');
            return res.status(400).json({ error: 'Message history must be an array' });
        }

        // History persistence logic can be integrated here
        // Currently acknowledging the save request as a placeholder
        res.json({
            success: true,
            chatId: chatId,
            messagesCount: messages.length
        });
    } catch (error) {
        logError('Error saving chat history', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to retrieve chat history context (Open WebUI integration)
router.get('/chats/:chatId/history', async (req, res) => {
    try {
        const { chatId } = req.params;

        logInfo(`Requesting history for chat: ${chatId}`);

        // Database retrieval logic for chat history can be integrated here
        // Currently returning an empty history payload as a placeholder
        res.json({
            success: true,
            chatId: chatId,
            messages: []
        });
    } catch (error) {
        logError('Error retrieving chat history', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// MEDIA ENDPOINTS: QWEN CHAT / DASHSCOPE
// ============================================

const CHAT_MEDIA_MODEL = 'qwen3-vl-plus';

function normalizeQwenAspectRatio(size, fallback = '16:9') {
    if (!size) return fallback;
    const value = String(size).trim();
    const ratioMap = {
        '1024x1024': '1:1',
        '512x512': '1:1',
        '768x768': '1:1',
        '960x960': '1:1',
        '1024x1792': '9:16',
        '1792x1024': '16:9',
        '1536x864': '16:9',
        '864x1536': '9:16'
    };
    if (ratioMap[value]) return ratioMap[value];
    if (/^\d+:\d+$/.test(value)) return value;
    return fallback;
}

function normalizeDashScopeSize(size) {
    const sizeMap = {
        '1024x1024': '1024*1024',
        '1024x1792': '1024*1792',
        '1792x1024': '1792*1024',
        '512x512': '512*512',
        '768x768': '768*768',
        '960x960': '960*960'
    };
    return sizeMap[size] || '1024*1024';
}

function buildOpenAiImageResponse({ imageUrl, prompt, model, raw, provider = 'qwen-chat' }) {
    return {
        created: Math.floor(Date.now() / 1000),
        service: SERVICE_NAME,
        watermark: SERVICE_WATERMARK,
        provider,
        model,
        data: [{ url: imageUrl, revised_prompt: prompt }],
        raw
    };
}

function buildVideoResponse({ result, prompt, model, waitForCompletion }) {
    const videoUrl = result.video_url || extractMediaUrl(result, 'video');
    return {
        id: result.id || result.task_id || `video-${Date.now()}`,
        object: videoUrl ? 'video.generation' : 'video.generation.task',
        created: Math.floor(Date.now() / 1000),
        service: SERVICE_NAME,
        watermark: SERVICE_WATERMARK,
        provider: 'qwen-chat',
        model,
        prompt,
        status: videoUrl ? 'completed' : (result.status || 'processing'),
        task_id: result.task_id || result.id || null,
        video_url: videoUrl || null,
        data: videoUrl ? [{ url: videoUrl }] : [],
        waitForCompletion,
        raw: result
    };
}

/**
 * POST /api/images/generations
 * Defaults to generating images via Qwen Chat (`chatType: t2i`).
 * For legacy DashScope mode, pass `provider: "dashscope"`.
 */
router.post('/images/generations', async (req, res) => {
    try {
        const { prompt, model, n, size, response_format, provider } = req.body;

        logInfo('Received request for image generation');
        logDebug(`Query: ${prompt?.substring(0, 100)}${prompt?.length > 100 ? '...' : ''}`);

        if (!prompt) {
            return res.status(400).json({ error: 'Parameter "prompt" is required' });
        }

        if (provider === 'dashscope') {
            const apiKey = process.env.DASHSCOPE_API_KEY;
            if (!apiKey) {
                return res.status(503).json({
                    error: 'DashScope Image generation API is not configured',
                    message: 'Set the DASHSCOPE_API_KEY environment variable or fallback to provider=qwen-chat'
                });
            }

            let imageModel = model || 'qwen-image-plus';
            if (imageModel === 'dall-e-3' || imageModel === 'dall-e-2') imageModel = 'qwen-image-plus';
            const result = await generateImage(prompt, imageModel, {
                n: n || 1,
                size: normalizeDashScopeSize(size),
                promptExtend: true,
                watermark: false
            });

            if (result.error) {
                logError(`DashScope generation error: ${result.error}`);
                return res.status(500).json({ error: 'Image generation error', message: result.error });
            }

            return res.json(buildOpenAiImageResponse({
                imageUrl: result.imageUrl,
                prompt,
                model: imageModel,
                raw: result,
                provider: 'dashscope'
            }));
        }

        const chatModel = getMappedModel(model || CHAT_MEDIA_MODEL);
        const aspectRatio = normalizeQwenAspectRatio(size, req.body.aspect_ratio || '16:9');
        const result = await sendMessage(
            prompt,
            chatModel,
            null,
            null,
            null,
            null,
            null,
            null,
            't2i',
            aspectRatio,
            true
        );

        if (result.error) {
            logError(`Qwen Chat image generation error: ${result.error}`);
            return res.status(500).json({ error: 'Image generation error in Qwen Chat', message: result.error, details: result.details });
        }

        const imageUrl = extractMediaUrl(result, 'image') || result.choices?.[0]?.message?.content || null;
        if (!imageUrl) {
            return res.status(502).json({
                error: 'Qwen Chat did not return an image URL',
                raw: result
            });
        }

        logInfo(`Qwen Chat image generated: ${imageUrl}`);
        return res.json(buildOpenAiImageResponse({ imageUrl, prompt, model: chatModel, raw: result }));
    } catch (error) {
        logError('Error generating image', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

/**
 * POST /api/videos/generations - Execute video generation via Qwen Chat (`chatType: t2v`).
 */
router.post('/videos/generations', async (req, res) => {
    try {
        const { prompt, model, size, wait, waitForCompletion } = req.body;
        const shouldWait = waitForCompletion ?? wait ?? true;

        logInfo('Received request for video generation via Qwen Chat');
        logDebug(`Video query: ${prompt?.substring(0, 100)}${prompt?.length > 100 ? '...' : ''}`);

        if (!prompt) {
            return res.status(400).json({ error: 'Parameter "prompt" is required' });
        }

        const chatModel = getMappedModel(model || CHAT_MEDIA_MODEL);
        const aspectRatio = normalizeQwenAspectRatio(size, req.body.aspect_ratio || '16:9');
        const result = await sendMessage(
            prompt,
            chatModel,
            null,
            null,
            null,
            null,
            null,
            null,
            't2v',
            aspectRatio,
            shouldWait
        );

        if (result.error) {
            logError(`Qwen Chat video generation error: ${result.error}`);
            return res.status(500).json({ error: 'Error generating video via Qwen Chat', message: result.error, details: result.details, task_id: result.task_id, rawResponse: result.rawResponse });
        }

        const response = buildVideoResponse({ result, prompt, model: chatModel, waitForCompletion: shouldWait });
        logInfo(response.video_url ? `Qwen Chat video generated: ${response.video_url}` : `Video task created: ${response.task_id}`);
        return res.json(response);
    } catch (error) {
        logError('Error generating video', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

/**
 * GET /api/tasks/status/:taskId - Polling status for long-running Qwen Chat tasks (video and future async ops).
 */
router.get('/tasks/status/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        const wait = ['1', 'true', 'yes'].includes(String(req.query.wait || '').toLowerCase());
        if (!taskId) return res.status(400).json({ error: 'taskId is required' });

        const result = await pollQwenTaskStatus(taskId, wait);
        if (result.error && !result.data) {
            return res.status(500).json(result);
        }
        return res.json({ service: SERVICE_NAME, watermark: SERVICE_WATERMARK, ...result });
    } catch (error) {
        logError('Error checking task status', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

/**
 * GET /api/images/models - Retrieve available image generation models.
 */
router.get('/images/models', async (req, res) => {
    try {
        const dashScopeModels = getAvailableImageModels();
        res.json({
            object: 'list',
            service: SERVICE_NAME,
            watermark: SERVICE_WATERMARK,
            data: [
                {
                    id: CHAT_MEDIA_MODEL,
                    object: 'model',
                    created: Date.now(),
                    owned_by: 'qwen-chat',
                    permission: [],
                    capability: 'qwen_chat_image_generation',
                    provider: 'qwen-chat'
                },
                ...dashScopeModels.map(model => ({
                    id: model,
                    object: 'model',
                    created: Date.now(),
                    owned_by: 'qwen',
                    permission: [],
                    capability: 'image_generation',
                    provider: 'dashscope'
                }))
            ]
        });
    } catch (error) {
        logError('Error retrieving image models list', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/videos/models - Retrieve available video generation models within Qwen Chat.
 */
router.get('/videos/models', async (req, res) => {
    res.json({
        object: 'list',
        service: SERVICE_NAME,
        watermark: SERVICE_WATERMARK,
        data: [{
            id: CHAT_MEDIA_MODEL,
            object: 'model',
            created: Date.now(),
            owned_by: 'qwen-chat',
            permission: [],
            capability: 'qwen_chat_video_generation',
            provider: 'qwen-chat'
        }]
    });
});

/**
 * GET /api/images/status - Validate image generation system status.
 */
router.get('/images/status', async (req, res) => {
    try {
        const apiKey = process.env.DASHSCOPE_API_KEY;
        const dashScopeAvailable = await checkImageApiAvailability();
        const tokens = listTokens();
        const now = Date.now();
        const qwenChatAvailable = tokens.some(t => (!t.resetAt || new Date(t.resetAt).getTime() <= now) && !t.invalid);

        res.json({
            service: SERVICE_NAME,
            watermark: SERVICE_WATERMARK,
            qwenChat: {
                available: qwenChatAvailable,
                model: CHAT_MEDIA_MODEL,
                message: qwenChatAvailable ? 'Qwen Chat image generation is available' : 'No active Qwen Chat accounts'
            },
            dashscope: {
                available: dashScopeAvailable,
                apiKeyConfigured: !!apiKey,
                message: dashScopeAvailable
                    ? 'DashScope Image API is available and active'
                    : apiKey
                        ? 'DashScope API is unreachable or authentication credentials failed'
                        : 'DASHSCOPE_API_KEY is not configured'
            }
        });
    } catch (error) {
        logError('Error checking image API status', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/videos/status - Validate Qwen Chat video generation availability.
 */
router.get('/videos/status', async (req, res) => {
    const tokens = listTokens();
    const now = Date.now();
    const availableAccounts = tokens.filter(t => (!t.resetAt || new Date(t.resetAt).getTime() <= now) && !t.invalid).length;
    res.json({
        service: SERVICE_NAME,
        watermark: SERVICE_WATERMARK,
        available: availableAccounts > 0,
        model: CHAT_MEDIA_MODEL,
        accounts: { total: tokens.length, available: availableAccounts },
        message: availableAccounts > 0 ? 'Qwen Chat video generation is available' : 'No active Qwen Chat accounts'
    });
});

export default router;
