import path from 'path';
import { fileURLToPath } from 'url';

import { initBrowser, shutdownBrowser, getBrowserContext } from '../browser/browser.js';
import { extractAuthToken } from '../providers/qwen.js';
import { loadAuthToken } from '../browser/session.js';
import { logInfo, logError, logWarn } from '../logger/index.js';
import { prompt } from './prompt.js';
import { formatServiceWatermark } from './branding.js';
import { SESSION_DIR, ACCOUNTS_DIR } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getProviderManager(providerId) {
    if (providerId === 'qwen') return (await import('../api/tokenManager.js')).qwenTokenManager;
    if (providerId === 'zai') return (await import('../providers/zai.js')).zaiTokenManager;
    if (providerId === 'deepseek') return (await import('../providers/deepseek.js')).deepseekTokenManager;
    if (providerId === 'kimi') return (await import('../providers/kimi.js')).kimiTokenManager;
    if (providerId === 'minimax') return (await import('../providers/minimax.js')).minimaxTokenManager;
    if (providerId === 'huggingface') return (await import('../providers/huggingface.js')).hfTokenManager;
    return null;
}

export async function addAccountInteractive(providerId = 'qwen') {
    logInfo('======================================================');
    logInfo(`Adding a new account for ${providerId.toUpperCase()}`);
    logInfo(formatServiceWatermark());
    logInfo('======================================================');

    if (providerId === 'qwen') {
        const method = await prompt('\nHow would you like to add the account?\n1 - Launch automated browser (may be blocked by anti-bot)\n2 - Paste token manually from your own browser\n3 - Import legacy account from old session\nSelect method (Enter = 1): ');
        let token = null;

        if (method.trim() === '3') {
            logInfo('Attempting to import legacy token from old session...');
            token = loadAuthToken();
            if (!token) {
                logError('No legacy token found. Please use method 1 or 2.');
                return null;
            }
            logInfo('Legacy token successfully imported.');
        } else if (method.trim() === '2') {
            console.log('\n\x1b[33mTo get your token:\x1b[0m');
            console.log('1. Open your normal browser (Chrome/Edge) and log into chat.qwenlm.ai');
            console.log('2. Open Developer Tools (F12) -> Application -> Local Storage');
            console.log('3. Copy the value of the "token" key');
            token = await prompt('\nPaste your JWT token here: ');
            token = token.trim();
            if (!token) {
                logError('No token provided.');
                return null;
            }
        } else {
            logInfo('A browser window will open. Sign in, then return to the console.');
            const ok = await initBrowser(true, true);
            if (!ok) { logError('Browser launch failed.'); return null; }
            const ctx = getBrowserContext();
            token = await extractAuthToken(ctx, true);
            if (!token) { logError('Token was not captured.'); await shutdownBrowser(); return null; }
            await shutdownBrowser();
        }
        
        const defaultId = 'acc_' + Date.now();
        const customId = await prompt(`\n\x1b[36mName this account (e.g. user@gmail.com, default: ${defaultId}): \x1b[0m`);
        const id = customId.trim() || defaultId;

        const tm = await getProviderManager('qwen');
        const list = tm.listTokens();
        list.push({ id, token, resetAt: null, createdAt: Date.now() });
        tm.saveTokens(list);
        logInfo(`Account '\x1b[32m${id}\x1b[0m' added. Total accounts: ${list.length}`);
        return id;
    }
    const scriptName = providerId === 'huggingface' ? 'hf:auth' : `${providerId}:auth`;
    const { spawn } = await import('child_process');
    
    // Close any running browser from the gateway to free the profile lock
    try {
        if (providerId === 'zai') {
            const { closeZaiBrowser } = await import('../providers/zai.js');
            await closeZaiBrowser();
        } else if (providerId === 'deepseek') {
            const { closeDeepseekBrowser } = await import('../providers/deepseek.js');
            if (closeDeepseekBrowser) await closeDeepseekBrowser();
        } else if (providerId === 'kimi') {
            const { closeKimiBrowser } = await import('../providers/kimi.js');
            if (closeKimiBrowser) await closeKimiBrowser();
        }
    } catch (e) {
        logWarn(`Could not close existing browser for ${providerId}: ${e.message}`);
    }

    return new Promise((resolve) => {
        logInfo(`Starting interactive auth for ${providerId}...`);
        const child = spawn('npm', ['run', scriptName], { stdio: 'inherit', shell: true });
        child.on('close', (code) => {
            if (code === 0) logInfo(`Auth for ${providerId} completed successfully.`);
            else logError(`Auth for ${providerId} exited with code ${code}.`);
            resolve();
        });
    });
}

function formatAccountInfo(t, idx) {
    const created = t.createdAt ? new Date(t.createdAt).toLocaleString() : 'Unknown';
    let expStr = '';
    try {
        const base64Url = t.token && t.token.split('.')[1];
        if (base64Url) {
            const jsonPayload = Buffer.from(base64Url.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
            const jwt = JSON.parse(jsonPayload);
            if (jwt && jwt.exp) expStr = ` | Exp: ${new Date(jwt.exp * 1000).toLocaleString()}`;
            if (jwt && jwt.id) expStr += ` | UserID: ${jwt.id.substring(0, 8)}...`;
        }
    } catch (e) {}
    return `  ${idx + 1}. \x1b[36m${t.id}\x1b[0m - Status: ${t.invalid ? '\x1b[31mINVALID\x1b[0m' : '\x1b[32mValid\x1b[0m'} | Created: ${created}${expStr}`;
}

export async function removeAccountInteractive(providerId = 'qwen') {
    const tm = await getProviderManager(providerId);
    if (!tm) return;
    
    const tokens = tm.listTokens();
    if (!tokens.length) {
        console.log('No saved accounts.');
        await prompt('Press Enter to return...');
        return;
    }

    console.log('\nAvailable accounts:');
    tokens.forEach((t, idx) => console.log(formatAccountInfo(t, idx)));
    const choice = await prompt('\nAccount number to remove, or Enter to cancel: ');
    if (!choice) return;
    const num = parseInt(choice, 10);
    if (isNaN(num) || num < 1 || num > tokens.length) {
        console.log('Invalid choice.');
        await prompt('Press Enter to return...');
        return;
    }

    const acc = tokens[num - 1];
    const confirm = await prompt(`Remove ${acc.id}? (y/N): `);
    if (confirm.toLowerCase() !== 'y') return;

    tm.removeToken(acc.id);
    console.log(`Account ${acc.id} removed.`);
}

export async function interactiveAccountMenu(providerId = 'qwen') {
    while (true) {
        const title = `[ ${providerId.toUpperCase()} Account Management ]`;
        console.log(`\n\x1b[36m╭─── ${title.padEnd(54, '─')}╮\x1b[0m`);
        console.log('\x1b[36m│\x1b[0m 1 - Add a new account                                    \x1b[36m│\x1b[0m');
        console.log('\x1b[36m│\x1b[0m 2 - Remove an account                                    \x1b[36m│\x1b[0m');
        console.log('\x1b[36m│\x1b[0m 3 - Refresh invalid accounts (Qwen only for now)         \x1b[36m│\x1b[0m');
        console.log('\x1b[36m│\x1b[0m 4 - List all accounts                                    \x1b[36m│\x1b[0m');
        console.log('\x1b[36m│\x1b[0m 0 - Return                                               \x1b[36m│\x1b[0m');
        console.log('\x1b[36m╰──────────────────────────────────────────────────────────╯\x1b[0m');
        let choice = await prompt('\nSelect action (Enter = 0): ');
        if (!choice) choice = '0';
        
        if (choice === '1') await addAccountInteractive(providerId);
        else if (choice === '2') await removeAccountInteractive(providerId);
        else if (choice === '3') {
            if (providerId === 'qwen') await reloginAccountInteractive();
            else console.log('Refresh not yet supported for this provider.');
        }
        else if (choice === '4') await listAccountsInteractive(providerId);
        else if (choice === '0') break;
        else console.log('Invalid choice.');
    }
}

export async function reloginAccountInteractive() {
    const tm = await getProviderManager('qwen');
    const tokens = tm.listTokens();
    const invalids = tokens.filter(t => t.invalid);
    if (!invalids.length) {
        console.log('No Qwen accounts require refresh.');
        await prompt('Press Enter to return...');
        return;
    }

    console.log('\nQwen accounts with expired tokens:');
    invalids.forEach((t, idx) => console.log(formatAccountInfo(t, idx)));
    const choice = await prompt('\nAccount number to refresh: ');
    const num = parseInt(choice, 10);
    if (isNaN(num) || num < 1 || num > invalids.length) return;
    const account = invalids[num - 1];

    logInfo(`Refreshing authorization for ${account.id}`);
    const ok = await initBrowser(true, true);
    if (!ok) { logError('Browser launch failed.'); return; }
    const token = await extractAuthToken(getBrowserContext(), true);
    await shutdownBrowser();
    if (!token) { logError('Token extraction failed.'); return; }

    tm.markValid(account.id, token);
    logInfo(`Token refreshed for ${account.id}`);
    await prompt('Press Enter to return...');
}

export async function listAccountsInteractive(providerId) {
    const tm = await getProviderManager(providerId);
    if (!tm) {
        console.log(`\n\x1b[33mListing accounts for ${providerId.toUpperCase()} is not fully supported yet.\x1b[0m`);
        await prompt('\nPress Enter to return...');
        return;
    }

    const tokens = tm.listTokens();
    if (!tokens.length) {
        console.log(`\n\x1b[33mNo accounts found for ${providerId.toUpperCase()}.\x1b[0m`);
    } else {
        console.log(`\n\x1b[36m[ ${providerId.toUpperCase()} Accounts ]\x1b[0m`);
        tokens.forEach((t, idx) => console.log(formatAccountInfo(t, idx)));
        console.log(`\nTotal: ${tokens.length} account(s)`);
    }
    await prompt('\nPress Enter to return...');
}
