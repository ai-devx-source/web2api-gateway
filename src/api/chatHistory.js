import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { logInfo, logError, logDebug } from '../logger/index.js';
import { SESSION_DIR, MAX_HISTORY_LENGTH } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HISTORY_DIR = path.resolve(__dirname, '..', '..', SESSION_DIR, 'history');

export function initHistoryDirectory() {
    if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
        logInfo(`Created chat history directory: ${HISTORY_DIR}`);
    }
}

export function generateChatId() {
    return crypto.randomUUID();
}

export function createChat(chatName) {
    const chatId = generateChatId();
    const chatInfo = {
        id: chatId,
        name: chatName || `New conversation ${new Date().toLocaleString()}`,
        created: Date.now(),
        messages: []
    };
    saveHistory(chatId, chatInfo);
    logInfo(`Created new chat [${chatId}] with name "${chatInfo.name}"`);
    return chatId;
}

function getHistoryFilePath(chatId) {
    return path.join(HISTORY_DIR, `${chatId}.json`);
}

export function saveHistory(chatId, data) {
    try {
        initHistoryDirectory();
        const historyFilePath = getHistoryFilePath(chatId);
        fs.writeFileSync(historyFilePath, JSON.stringify(data, null, 2), 'utf8');
        logDebug(`Conversation history for ${chatId} persisted successfully`);
        return true;
    } catch (error) {
        logError(`Error saving history for chat ${chatId}`, error);
        return false;
    }
}

export function loadHistory(chatId) {
    try {
        const historyFilePath = getHistoryFilePath(chatId);
        if (fs.existsSync(historyFilePath)) {
            const rawData = fs.readFileSync(historyFilePath, 'utf8');
            logDebug(`Conversation data for ${chatId} loaded successfully`);

            let data;
            try {
                data = JSON.parse(rawData);
                logDebug(`Conversation data for ${chatId} parsed successfully`);
            } catch (parseErr) {
                logError(`Error parsing data for chat ${chatId}`, parseErr);
                return {
                    id: chatId,
                    name: `Recovered conversation ${new Date().toLocaleString()}`,
                    created: Date.now(),
                    messages: []
                };
            }

            // Support backward compatibility with legacy format
            if (Array.isArray(data)) {
                logDebug(`Conversation ${chatId} uses legacy format, executing conversion`);
                return {
                    id: chatId,
                    name: `Conversation from ${new Date().toLocaleString()}`,
                    created: Date.now(),
                    messages: data,
                    wasConverted: true
                };
            }

            // Ensure presence of required fields
            if (!data.messages) {
                logInfo(`Chat ${chatId} has no messages, initializing empty array`);
                data.messages = [];
            }

            if (!data.name) {
                data.name = `Conversation ${chatId.substring(0, 6)}`;
            }

            if (!data.created) {
                data.created = Date.now();
            }

            if (!data.id) {
                data.id = chatId;
            }

            return data;
        } else {
            logInfo(`History file not found for chat ${chatId}`);
        }
    } catch (error) {
        logError(`Error loading history for chat ${chatId}`, error);
    }

    // If loading fails, initialize new context data
    logInfo(`Creating new history for chat ${chatId}`);
    return {
        id: chatId,
        name: `New conversation ${new Date().toLocaleString()}`,
        created: Date.now(),
        messages: []
    };
}

export function chatExists(chatId) {
    const historyFilePath = getHistoryFilePath(chatId);
    const exists = fs.existsSync(historyFilePath);
    logDebug(`Checking existence of conversation ${chatId}: ${exists ? 'found' : 'not found'}`);
    return exists;
}

export function renameChat(chatId, newName) {
    try {
        if (!chatExists(chatId)) {
            logError(`Attempt to rename non-existent chat ${chatId}`);
            return false;
        }

        const chatData = loadHistory(chatId);
        const oldName = chatData.name;
        chatData.name = newName;
        const success = saveHistory(chatId, chatData);
        if (success) {
            logInfo(`Chat ${chatId} renamed: "${oldName}" -> "${newName}"`);
        } else {
            logError(`Failed to rename chat ${chatId}`);
        }
        return success;
    } catch (error) {
        logError(`Error renaming chat ${chatId}`, error);
        return false;
    }
}

export function addUserMessage(chatId, content) {
    const timestamp = Math.floor(Date.now() / 1000);
    const messageId = crypto.randomUUID();

    // Determine content type and length for logging purposes
    let contentDesc;
    if (Array.isArray(content)) {
        // Multipart message (text + images)
        const textParts = content.filter(item => item.type === 'text');
        const imageParts = content.filter(item => item.type === 'image');
        const fileParts = content.filter(item => item.type === 'file');

        contentDesc = `multipart message (${textParts.length} text, ${imageParts.length} image, ${fileParts.length} file)`;
    } else if (typeof content === 'object' && content !== null) {
        contentDesc = 'message object';
    } else {
        contentDesc = `text of length ${String(content).length}`;
    }

    const message = {
        id: messageId,
        role: "user",
        content: content,
        timestamp: timestamp,
        chat_type: "t2t"
    };

    logInfo(`Adding user message to chat ${chatId}: ${contentDesc}`);
    return addMessageToHistory(chatId, message);
}

export function addAssistantMessage(chatId, content, info = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const messageId = crypto.randomUUID();

    const message = {
        id: messageId,
        role: "assistant",
        content: content,
        timestamp: timestamp,
        info: info,
        chat_type: "t2t"
    };

    logInfo(`Adding assistant response to chat ${chatId}, length: ${content.length}`);
    return addMessageToHistory(chatId, message);
}

function addMessageToHistory(chatId, message) {
    try {
        let chatData = loadHistory(chatId);

        if (chatData.messages.length >= MAX_HISTORY_LENGTH) {
            logInfo(`Chat ${chatId} reached max length (${MAX_HISTORY_LENGTH}), deleting old messages`);
            chatData.messages = [chatData.messages[0], ...chatData.messages.slice(chatData.messages.length - MAX_HISTORY_LENGTH + 2)];
        }

        chatData.messages.push(message);
        saveHistory(chatId, chatData);
        logDebug(`Message ${message.id} successfully appended to conversation ${chatId}`);

        return message.id;
    } catch (error) {
        logError(`Error adding message to chat history ${chatId}`, error);
        return null;
    }
}

export function getAllChats() {
    try {
        initHistoryDirectory();
        const files = fs.readdirSync(HISTORY_DIR);
        logDebug(`Retrieved conversations file list: ${files.length} files`);

        let convertedCount = 0;
        const chats = files
            .filter(file => file.endsWith('.json'))
            .map(file => {
                const chatId = file.replace('.json', '');
                const chatData = loadHistory(chatId);

                if (chatData.wasConverted) {
                    convertedCount++;
                }

                return {
                    id: chatId,
                    name: chatData.name || `Conversation ${chatId.substring(0, 6)}`,
                    created: chatData.created || 0,
                    messageCount: chatData.messages ? chatData.messages.length : 0,
                    userMessageCount: chatData.messages ?
                        chatData.messages.filter(m => m.role === 'user').length : 0
                };
            });

        if (convertedCount > 0) {
            logInfo(`Converted ${convertedCount} chats from legacy format`);
        }

        logInfo(`Processed ${chats.length} chats`);
        return chats.sort((a, b) => b.created - a.created);
    } catch (error) {
        logError('Error getting chat list', error);
        return [];
    }
}

export function deleteChat(chatId) {
    try {
        const historyFilePath = getHistoryFilePath(chatId);
        if (fs.existsSync(historyFilePath)) {
            fs.unlinkSync(historyFilePath);
            logInfo(`Chat ${chatId} successfully deleted`);
            return true;
        } else {
            logError(`Attempt to delete non-existent chat ${chatId}`);
        }
    } catch (error) {
        logError(`Error deleting chat ${chatId}`, error);
    }
    return false;
}

export function deleteChatsAutomatically(criteria = {}) {
    try {
        const { olderThan, userMessageCountLessThan, messageCountLessThan, maxChats } = criteria;
        logInfo(`Auto-deleting chats with criteria: ${JSON.stringify(criteria)}`);

        const chats = getAllChats();
        logInfo(`Found ${chats.length} chats to check`);

        let chatsToDelete = [...chats];

        // Filter by age (in milliseconds)
        if (olderThan) {
            const cutoffTime = Date.now() - olderThan;
            const oldChatsCount = chatsToDelete.filter(chat => chat.created < cutoffTime).length;
            logInfo(`Chats older than ${olderThan}ms (${new Date(cutoffTime).toLocaleString()}): ${oldChatsCount}`);
            chatsToDelete = chatsToDelete.filter(chat => chat.created < cutoffTime);
        }

        if (userMessageCountLessThan !== undefined) {
            const lowUserMsgChatsCount = chatsToDelete.filter(chat =>
                chat.userMessageCount < userMessageCountLessThan).length;
            logInfo(`Chats with fewer than ${userMessageCountLessThan} messages user messages: ${lowUserMsgChatsCount}`);
            chatsToDelete = chatsToDelete.filter(chat =>
                chat.userMessageCount < userMessageCountLessThan);
        }

        if (messageCountLessThan !== undefined) {
            const lowMsgChatsCount = chatsToDelete.filter(chat =>
                chat.messageCount < messageCountLessThan).length;
            logInfo(`Chats with fewer than ${messageCountLessThan} messages total messages: ${lowMsgChatsCount}`);
            chatsToDelete = chatsToDelete.filter(chat =>
                chat.messageCount < messageCountLessThan);
        }

        if (maxChats && chats.length > maxChats) {
            logInfo(`Total chats (${chats.length}) exceeds limit (${maxChats}), deleting old chats`);
            const sortedChats = [...chats].sort((a, b) => a.created - b.created);
            const oldestChats = sortedChats.slice(0, chats.length - maxChats);

            oldestChats.forEach(chat => {
                if (!chatsToDelete.some(c => c.id === chat.id)) {
                    chatsToDelete.push(chat);
                }
            });
        }

        // Purge selected conversations
        const deletedChats = [];
        logInfo(`Found ${chatsToDelete.length} chats to delete`);

        for (const chat of chatsToDelete) {
            if (deleteChat(chat.id)) {
                deletedChats.push(chat.id);
            }
        }

        logInfo(`Deleted ${deletedChats.length} chats`);
        return {
            success: true,
            deletedCount: deletedChats.length,
            deletedChats
        };
    } catch (error) {
        logError('Error auto-deleting chats', error);
        return {
            success: false,
            error: error.message
        };
    }
} 