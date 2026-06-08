import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logInfo, logError } from '../logger/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODELS_FILE = path.join(__dirname, '..', 'AvailableModels.txt');
const AUTH_KEYS_FILE = path.join(__dirname, '..', 'Authorization.txt');

let availableModels = null;
let authKeys = null;

export function getAllModels() {
    if (availableModels !== null) {
        return {
            models: availableModels.map(model => ({
                id: model,
                name: model,
                description: `Model ${model}`
            }))
        };
    }
    
    if (fs.existsSync(MODELS_FILE)) {
        try {
            const content = fs.readFileSync(MODELS_FILE, 'utf8');
            availableModels = content.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'));
            return {
                models: availableModels.map(model => ({
                    id: model,
                    name: model,
                    description: `Model ${model}`
                }))
            };
        } catch (error) {
            logError('Failed to read AvailableModels.txt', error);
        }
    }
    return { models: [] };
}

export function getApiKeys() {
    if (authKeys !== null) {
        return authKeys;
    }

    if (!fs.existsSync(AUTH_KEYS_FILE)) {
        try {
            const template = `# Proxy API Keys configuration
# --------------------------------------------
# This file lists the tokens that the
# proxy will consider as valid.
# One key per line without spaces.
#
# 1) Want to DISABLE authorization entirely?
#    Leave the file empty — the server will stop
#    verifying the Authorization header.
#
# 2) Want to grant access to multiple clients?
#    Add each key on a separate line:
#      d35ab3e1-a6f9-4d...
#      f2b1cd9c-1b2e-4a...
#
# Empty lines and lines starting with '#' are
# ignored.`;
            fs.writeFileSync(AUTH_KEYS_FILE, template, 'utf8');
            logInfo('Authorization.txt created with template');
            authKeys = [];
            return authKeys;
        } catch (error) {
            logError('Failed to create Authorization.txt', error);
            return [];
        }
    }

    try {
        const content = fs.readFileSync(AUTH_KEYS_FILE, 'utf8');
        authKeys = content.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'));
        
        if (authKeys.length > 0) {
            logInfo(`Loaded ${authKeys.length} API keys for authorization`);
        } else {
            logInfo('Authorization.txt is empty. Authorization is DISABLED.');
        }
        return authKeys;
    } catch (error) {
        logError('Failed to read Authorization.txt', error);
        return [];
    }
}
