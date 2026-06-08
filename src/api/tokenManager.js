import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logError, logInfo } from '../logger/index.js';
import { SESSION_DIR } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class TokenManager {
    constructor(providerId, customTokensFile = null) {
        this.providerId = providerId;
        this.sessionPath = path.resolve(__dirname, '..', '..', SESSION_DIR);
        this.providerDir = path.join(this.sessionPath, providerId);
        
        // Qwen backward compatibility: historically saved to session/tokens.json
        if (customTokensFile) {
            this.tokensFile = path.join(this.sessionPath, customTokensFile);
        } else {
            this.tokensFile = path.join(this.providerDir, 'accounts.json');
        }
        
        this.pointer = 0;
        this.ensureDir();
        this.migrateLegacySession();
    }

    ensureDir() {
        if (!fs.existsSync(this.sessionPath)) fs.mkdirSync(this.sessionPath, { recursive: true });
        if (!fs.existsSync(this.providerDir) && !this.tokensFile.endsWith('tokens.json')) {
            fs.mkdirSync(this.providerDir, { recursive: true });
        }
    }

    migrateLegacySession() {
        // Auto-migrate old session.json files (like session/zai/session.json) into the new pool
        const legacyFile = path.join(this.providerDir, 'session.json');
        if (fs.existsSync(legacyFile) && !fs.existsSync(this.tokensFile)) {
            try {
                const sessionData = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
                // Make sure it's an account, not a guest
                const isGuest = sessionData.source === 'guest' || sessionData.role === 'guest';
                const token = sessionData.token || sessionData.bearerToken;
                if (sessionData && token && !isGuest) {
                    const tokenObject = {
                        id: sessionData.id || sessionData.email || `legacy-${this.providerId}`,
                        token: token,
                        ...sessionData
                    };
                    this.saveTokens([tokenObject]);
                    logInfo(`TokenManager: Auto-migrated legacy session for provider ${this.providerId} to accounts.json`);
                }
            } catch (e) {
                logError(`TokenManager: Error migrating legacy session for ${this.providerId}`, e);
            }
        }
    }

    loadTokens() {
        this.ensureDir();
        if (!fs.existsSync(this.tokensFile)) return [];
        try {
            return JSON.parse(fs.readFileSync(this.tokensFile, 'utf8'));
        } catch (e) {
            logError(`TokenManager: Error reading ${this.tokensFile}`, e);
            return [];
        }
    }

    saveTokens(tokens) {
        this.ensureDir();
        try {
            fs.writeFileSync(this.tokensFile, JSON.stringify(tokens, null, 2), 'utf8');
        } catch (e) {
            logError(`TokenManager: Error saving ${this.tokensFile}`, e);
        }
    }

    async getAvailableToken() {
        const tokens = this.loadTokens();
        const now = Date.now();
        const valid = tokens.filter(t => (!t.resetAt || new Date(t.resetAt).getTime() <= now) && !t.invalid);
        if (!valid.length) return null;
        const token = valid[this.pointer % valid.length];
        this.pointer = (this.pointer + 1) % valid.length;
        return token;
    }

    hasValidTokens() {
        const tokens = this.loadTokens();
        const now = Date.now();
        return tokens.some(t => (!t.resetAt || new Date(t.resetAt).getTime() <= now) && !t.invalid);
    }

    markRateLimited(id, hours = 24) {
        const tokens = this.loadTokens();
        const idx = tokens.findIndex(t => t.id === id);
        if (idx !== -1) {
            tokens[idx].resetAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
            this.saveTokens(tokens);
            logInfo(`TokenManager [${this.providerId}]: Account ${id} rate limited for ${hours} hours.`);
        }
    }

    removeToken(id) {
        this.saveTokens(this.loadTokens().filter(t => t.id !== id));
        logInfo(`TokenManager [${this.providerId}]: Account ${id} removed from pool.`);
    }

    markInvalid(id) {
        const tokens = this.loadTokens();
        const idx = tokens.findIndex(t => t.id === id);
        if (idx !== -1) {
            tokens[idx].invalid = true;
            this.saveTokens(tokens);
            logError(`TokenManager [${this.providerId}]: Account ${id} marked as invalid.`);
        }
    }

    markValid(id, newToken = null) {
        const tokens = this.loadTokens();
        const idx = tokens.findIndex(t => t.id === id);
        if (idx !== -1) {
            tokens[idx].invalid = false;
            tokens[idx].resetAt = null;
            if (newToken) tokens[idx].token = newToken;
            this.saveTokens(tokens);
            logInfo(`TokenManager [${this.providerId}]: Account ${id} marked as valid.`);
        }
    }

    listTokens() {
        return this.loadTokens();
    }
}

// Global Qwen instance for backward compatibility during refactoring
export const qwenTokenManager = new TokenManager('qwen', 'tokens.json');

// Backward compatible exports pointing to Qwen
export const loadTokens = () => qwenTokenManager.loadTokens();
export const saveTokens = (t) => qwenTokenManager.saveTokens(t);
export const getAvailableToken = () => qwenTokenManager.getAvailableToken();
export const hasValidTokens = () => qwenTokenManager.hasValidTokens();
export const markRateLimited = (id, h) => qwenTokenManager.markRateLimited(id, h);
export const removeToken = (id) => qwenTokenManager.removeToken(id);
export const removeInvalidToken = removeToken;
export const markInvalid = (id) => qwenTokenManager.markInvalid(id);
export const markValid = (id, t) => qwenTokenManager.markValid(id, t);
export const listTokens = () => qwenTokenManager.listTokens();

