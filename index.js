import { initBrowser, shutdownBrowser } from './src/browser/browser.js';
import { logInfo, logError, logWarn } from './src/logger/index.js';
import { PORT, HOST } from './src/config.js';
import { getProviderAuthMode } from './src/providers/activeProvider.js';
import { loadTokens } from './src/api/tokenManager.js';
import { printBanner, showDisclaimerAgreement } from './src/cli/banner.js';
import { runInteractiveStartup, logProviderState } from './src/cli/menu.js';
import { createServer, startHttpServer } from './src/server/app.js';

const port = Number.parseInt(process.env.PORT ?? PORT, 10);
const host = process.env.HOST || HOST;
const cliFlags = new Set(process.argv.slice(2));
let httpServer = null;
let shuttingDown = false;

if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

function toBoolean(value) {
    if (typeof value !== 'string') return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function isNonInteractiveMode() {
    return (
        toBoolean(process.env.SKIP_ACCOUNT_MENU) ||
        toBoolean(process.env.NON_INTERACTIVE) ||
        cliFlags.has('--skip-account-menu') ||
        cliFlags.has('--non-interactive')
    );
}

function getQwenTokenState() {
    const tokens = loadTokens();
    const now = Date.now();
    const valid = tokens.filter(token => {
        if (token.invalid) return false;
        if (!token.resetAt) return true;
        return new Date(token.resetAt).getTime() <= now;
    });
    return { valid };
}

async function initializeConnectors() {
    logProviderState(logInfo, logWarn);

    const qwen = getQwenTokenState();
    if (getProviderAuthMode('qwen') !== 'account') {
        logWarn('Skipping Qwen browser initialization because Qwen auth mode is not account.');
        return;
    }
    if (qwen.valid.length === 0) {
        logWarn('Skipping Qwen browser initialization because no active Qwen account is available.');
        return;
    }

    const browserInitialized = await initBrowser(false);
    if (!browserInitialized) {
        throw new Error('Qwen browser initialization failed.');
    }
}

async function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    logInfo('Shutdown requested. Closing connectors...');

    if (httpServer) {
        await new Promise(resolve => httpServer.close(resolve));
        httpServer = null;
    }

    await shutdownBrowser();
    logInfo('Shutdown complete.');
    process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
process.on('uncaughtException', async (error) => {
    logError('Uncaught exception', error);
    await shutdown(1);
});
process.on('unhandledRejection', async (reason) => {
    logError('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
    await shutdown(1);
});

async function startServer() {
    printBanner();
    logInfo('Starting gateway...');

    const { prompt } = await import('./src/utils/prompt.js');

    if (!isNonInteractiveMode()) {
        const agreed = await showDisclaimerAgreement(prompt);
        if (!agreed) {
            console.log('\x1b[31mYou did not agree to the terms. Exiting...\x1b[0m');
            process.exit(1);
        }
        await runInteractiveStartup(shutdown);
    }

    await initializeConnectors();
    const app = createServer();
    httpServer = await startHttpServer(app, host, port);
}

startServer().catch(async error => {
    if (error?.code === 'EADDRINUSE') {
        logError(`Port ${port} is already in use.`);
    } else {
        logError('Startup failed', error);
    }
    await shutdown(1);
});
