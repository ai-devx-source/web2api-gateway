#!/usr/bin/env node

import { loadTokens } from '../src/api/tokenManager.js';
import { addAccountInteractive, reloginAccountInteractive, removeAccountInteractive } from '../src/utils/accountSetup.js';
import { formatServiceWatermark } from '../src/utils/branding.js';
import { prompt } from '../src/utils/prompt.js';

function printDivider() {
    console.log('======================================================');
}

const STATUS_CODES = {
    INVALID: 0,
    WAIT: 1,
    OK: 2
};

function formatStatus(token) {
    const now = Date.now();
    if (token.invalid) {
        return { code: STATUS_CODES.INVALID, label: 'invalid' };
    }
    if (token.resetAt && new Date(token.resetAt).getTime() > now) {
        return { code: STATUS_CODES.WAIT, label: 'waiting' };
    }
    return { code: STATUS_CODES.OK, label: 'ready' };
}

function printAccounts(tokens) {
    console.log('\nQwen accounts:');
    if (!tokens.length) {
        console.log('  (empty)');
        return;
    }

    tokens.forEach((token, index) => {
        const status = formatStatus(token);
        console.log(`${String(index + 1).padStart(2, ' ')} | ${token.id} | ${status.label} (${status.code})`);
    });
}

function handleList(tokens) {
    console.log(formatServiceWatermark());
    printAccounts(tokens);
    const active = tokens.filter(t => formatStatus(t).code === STATUS_CODES.OK);
    console.log(`\nActive accounts: ${active.length} of ${tokens.length}`);
}

function parseArgs(argv) {
    const args = new Set(argv.slice(2));
    if (args.has('--help') || args.has('-h')) return 'help';
    if (args.has('--list')) return 'list';
    if (args.has('--add')) return 'add';
    if (args.has('--relogin')) return 'relogin';
    if (args.has('--remove')) return 'remove';
    return null;
}

function printHelp() {
    printDivider();
    console.log('Qwen account management');
    console.log(formatServiceWatermark());
    printDivider();
    console.log('Options:');
    console.log('  --list      Show accounts and status');
    console.log('  --add       Add a new account');
    console.log('  --relogin   Refresh an expired account');
    console.log('  --remove    Remove an account');
    console.log('Without options, the interactive menu is opened.');
    printDivider();
}

async function runCliAction(action) {
    if (action === 'help') {
        printHelp();
        return;
    }

    if (action === 'list') {
        const tokens = loadTokens();
        handleList(tokens);
        return;
    }

    if (action === 'add') {
        await addAccountInteractive();
        return;
    }

    if (action === 'relogin') {
        await reloginAccountInteractive();
        return;
    }

    if (action === 'remove') {
        await removeAccountInteractive();
        return;
    }
}

async function runInteractiveMenu() {
    while (true) {
        const tokens = loadTokens();
        printDivider();
        console.log(formatServiceWatermark());
        printAccounts(tokens);
        printDivider();
        console.log('Actions:');
        console.log('1 - Add a new account');
        console.log('2 - Refresh an expired account');
        console.log('3 - Remove an account');
        console.log('4 - Show accounts and status');
        console.log('5 - Exit');
        const choice = await prompt('Select action (Enter = 5): ');
        const normalized = choice || '5';

        if (normalized === '1') {
            await addAccountInteractive();
        } else if (normalized === '2') {
            await reloginAccountInteractive();
        } else if (normalized === '3') {
            await removeAccountInteractive();
        } else if (normalized === '4') {
            handleList(tokens);
            await prompt('\nPress Enter to return to the menu...');
        } else if (normalized === '5') {
            console.log('Exiting.');
            break;
        }
    }
}

(async () => {
    const action = parseArgs(process.argv);
    if (action) {
        await runCliAction(action);
        return;
    }

    await runInteractiveMenu();
})();
