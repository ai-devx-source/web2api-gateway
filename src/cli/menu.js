import { prompt } from '../utils/prompt.js';
import { getZaiSessionStatus } from '../providers/zai.js';
import { getDeepSeekSessionStatus } from '../providers/deepseek.js';
import { getKimiSessionStatus } from '../providers/kimi.js';
import { getMinimaxSessionStatus } from '../providers/minimax.js';
import { getPerplexitySessionStatus } from '../providers/perplexity.js';
import { getMimoSessionStatus } from '../providers/mimo.js';
import { getHuggingFaceSessionStatus } from '../providers/huggingface.js';
import { getActiveProviderProfile, getProviderAuthMode, setActiveProvider, setProviderAuthMode, getHeadlessMode, toggleHeadlessMode, getProviderTransportMode, setProviderTransportMode } from '../providers/activeProvider.js';
import { getAllModels } from '../api/configManager.js';
import { loadTokens, TokenManager } from '../api/tokenManager.js';
import { spawn } from 'child_process';
import { interactiveAccountMenu } from '../utils/accountSetup.js';

function getTokenState(providerId) {
    let tokens = [];
    if (providerId === 'qwen') {
        tokens = loadTokens();
    } else {
        const tm = new TokenManager(providerId);
        tokens = tm.listTokens();
    }
    const now = Date.now();
    const valid = tokens.filter(token => {
        if (token.invalid) return false;
        if (!token.resetAt) return true;
        return new Date(token.resetAt).getTime() <= now;
    });
    const waiting = tokens.filter(token => token.resetAt && new Date(token.resetAt).getTime() > now);
    const invalid = tokens.filter(token => token.invalid);

    return {
        total: tokens.length,
        valid: valid,
        waiting: waiting,
        invalid: invalid
    };
}

function getQwenTokenState() {
    return getTokenState('qwen');
}

export function getProviderState() {
    const qwen = getQwenTokenState();
    const zai = getZaiSessionStatus();
    const deepseek = getDeepSeekSessionStatus();
    const qwenAuthMode = getProviderAuthMode('qwen');
    const kimi = getKimiSessionStatus();
    const minimax = getMinimaxSessionStatus();
    const perplexity = getPerplexitySessionStatus();
    const mimo = getMimoSessionStatus();

    return {
        activeProvider: getActiveProviderProfile(),
        qwen: {
            id: 'qwen',
            connector: 'Qwen Chat',
            authMode: qwenAuthMode,
            transportMode: getProviderTransportMode('qwen'),
            enabled: qwenAuthMode === 'account' && qwen.valid.length > 0,
            available: qwenAuthMode === 'account' && qwen.valid.length > 0,
            accountRequired: true,
            guestAvailable: false,
            accounts: {
                total: qwen.total,
                valid: qwen.valid.length,
                waiting: qwen.waiting.length,
                invalid: qwen.invalid.length
            },
            authCommand: 'npm run auth'
        },
        zai: {
            id: 'zai',
            connector: 'Z.ai / GLM',
            authMode: zai.authMode,
            transportMode: getProviderTransportMode('zai'),
            enabled: zai.available,
            available: zai.available,
            authenticated: zai.authenticated,
            guest: zai.guest || false,
            guestAvailable: zai.guestAvailable || false,
            capabilities: zai.capabilities,
            expired: zai.expired || false,
            authCommand: 'npm run zai:auth'
        },
        deepseek: {
            id: 'deepseek',
            connector: 'DeepSeek Chat',
            authMode: deepseek.authMode,
            transportMode: getProviderTransportMode('deepseek'),
            enabled: deepseek.available,
            available: deepseek.available,
            authenticated: deepseek.authenticated,
            guest: deepseek.guest || false,
            guestAvailable: deepseek.guestAvailable || false,
            hasPowResponse: deepseek.hasPowResponse,
            capabilities: deepseek.capabilities,
            authCommand: 'npm run deepseek:auth'
        },
        kimi: {
            id: 'kimi',
            connector: 'Kimi Chat',
            authMode: kimi.authMode,
            transportMode: getProviderTransportMode('kimi'),
            enabled: kimi.available,
            available: kimi.available,
            authenticated: kimi.authenticated,
            guest: kimi.guest || false,
            guestAvailable: kimi.guestAvailable || false,
            capabilities: kimi.capabilities,
            authCommand: 'npm run kimi:auth'
        },
        minimax: {
            id: 'minimax',
            connector: 'MiniMax Chat',
            authMode: minimax.authMode,
            transportMode: getProviderTransportMode('minimax'),
            enabled: minimax.available,
            available: minimax.available,
            authenticated: minimax.authenticated,
            guest: minimax.guest || false,
            guestAvailable: minimax.guestAvailable || false,
            capabilities: minimax.capabilities,
            authCommand: 'npm run minimax:auth'
        },
        perplexity: {
            id: 'perplexity',
            name: 'Perplexity',
            authMode: perplexity.authMode,
            transportMode: getProviderTransportMode('perplexity'),
            enabled: perplexity.available,
            available: perplexity.available,
            authenticated: perplexity.authenticated,
            guest: false,
            guestAvailable: false,
            capabilities: perplexity.capabilities,
            authCommand: 'node src/cli/scripts/perplexity_auth.js'
        },
        mimo: {
            id: 'mimo',
            name: 'Xiaomi MIMO',
            authMode: mimo.authMode,
            transportMode: getProviderTransportMode('mimo'),
            enabled: mimo.available,
            available: mimo.available,
            authenticated: mimo.authenticated,
            guest: false,
            guestAvailable: false,
            capabilities: mimo.capabilities,
            authCommand: 'node src/cli/scripts/mimo_auth.js'
        },
        hf: {}
    };
}

export function logProviderState(logInfo, logWarn) {
    const providers = getProviderState();

    logInfo('Provider registry:');
    logInfo(`- active profile: ${providers.activeProvider.activeProvider}`);
    logInfo(`- qwen: ${providers.qwen.enabled ? 'ready' : 'not authorized'} (${providers.qwen.authMode}, ${providers.qwen.transportMode}, ${providers.qwen.accounts.valid}/${providers.qwen.accounts.total} valid accounts)`);
    logInfo(`- zai: ${providers.zai.enabled ? 'available' : 'not available'} (${providers.zai.authMode}${providers.zai.guest ? ', guest' : ''}, ${providers.zai.transportMode})`);
    logInfo(`- deepseek: ${providers.deepseek.enabled ? 'ready' : 'not available'} (${providers.deepseek.authMode}${providers.deepseek.hasPowResponse ? ', pow captured' : ''}, ${providers.deepseek.transportMode})`);
    logInfo(`- kimi: ${providers.kimi.enabled ? 'available' : 'not available'} (${providers.kimi.authMode}, ${providers.kimi.transportMode})`);
    logInfo(`- minimax: ${providers.minimax.enabled ? 'available' : 'not available'} (${providers.minimax.authMode}, ${providers.minimax.transportMode})`);

    if (providers.qwen.authMode !== 'account') {
        logWarn('Qwen guest mode is not supported. Use account mode for Qwen Chat and stronger models.');
    } else if (!providers.qwen.enabled) {
        logWarn('Qwen connector is not authorized. Run `npm run auth` to enable Qwen Chat routing.');
    }
    if (providers.zai.authMode === 'guest') {
        logWarn('Z.ai guest mode is selected. Guest model catalog is available; chat completion remains experimental and may require verification.');
    } else if (!providers.zai.enabled) {
        logWarn('Z.ai connector is not authorized. Run `npm run zai:auth` to enable account-based GLM routing.');
    }
    if (providers.deepseek.authMode === 'guest') {
        logWarn('DeepSeek guest mode is selected, but chat completions are not available without account bearer token and fresh PoW.');
    } else if (!providers.deepseek.enabled) {
        logWarn('DeepSeek connector is not authorized. Run `npm run deepseek:auth` and send one test prompt in the browser.');
    }
}

export function printRoutingHelp() {
    console.log('\n\x1b[36m╭────────────────────────────────────────────────────────────────────────────────────────╮\x1b[0m');
    console.log('\x1b[36m│\x1b[0m   \x1b[1mROUTING MODEL & EXAMPLES\x1b[0m                                                             \x1b[36m│\x1b[0m');
    console.log('\x1b[36m├────────────────────────────────────────────────────────────────────────────────────────┤\x1b[0m');
    console.log('\x1b[36m│\x1b[0m - The gateway exposes one common OpenAI-compatible endpoint.                           \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m - Active profile is the default provider for clients that cannot send provider fields. \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m - Explicit provider/model still routes directly when supported.                        \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m                                                                                        \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m   \x1b[33mauto\x1b[0m     : route by provider/model, otherwise Qwen-compatible default.             \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m   \x1b[33mqwen\x1b[0m     : common endpoint defaults to Qwen.                                       \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m   \x1b[33mzai\x1b[0m      : common endpoint defaults to Z.ai / GLM.                                 \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m   \x1b[33mdeepseek\x1b[0m : common endpoint defaults to DeepSeek Chat.                              \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m   \x1b[33mkimi\x1b[0m     : common endpoint defaults to Kimi / Moonshot AI.                         \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m   \x1b[33mminimax\x1b[0m  : common endpoint defaults to MiniMax.                                    \x1b[36m│\x1b[0m');
    console.log('\x1b[36m├────────────────────────────────────────────────────────────────────────────────────────┤\x1b[0m');
    console.log('\x1b[36m│\x1b[0m \x1b[32mQwen request example:\x1b[0m                                                                  \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m { "provider": "qwen", "model": "qwen3.7-max", "messages": [...] }                      \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m \x1b[32mZ.ai request example:\x1b[0m                                                                  \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m { "provider": "zai", "model": "GLM-5.1", "messages": [...] }                           \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m \x1b[32mDeepSeek request example:\x1b[0m                                                              \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m { "provider": "deepseek", "model": "deepseek-chat", "messages": [...] }                \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m \x1b[32mKimi request example:\x1b[0m                                                                  \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m { "provider": "kimi", "model": "kimi-k2.6", "messages": [...] }                        \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m \x1b[32mMiniMax request example:\x1b[0m                                                               \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m { "provider": "minimax", "model": "MiniMax-M3", "messages": [...] }                    \x1b[36m│\x1b[0m');
    console.log('\x1b[36m╰────────────────────────────────────────────────────────────────────────────────────────╯\x1b[0m');
}

export async function selectActiveProviderInteractive() {
    const current = getActiveProviderProfile().activeProvider;
    console.log('\n\x1b[36m╭─── [ Active Provider Profile ] ──────────────────────────╮\x1b[0m');
    console.log(`\x1b[36m│\x1b[0m Current: \x1b[32m${current.padEnd(46)}\x1b[0m \x1b[36m│\x1b[0m`);
    console.log('\x1b[36m├──────────────────────────────────────────────────────────┤\x1b[0m');
    console.log('\x1b[36m│\x1b[0m 1 - auto (route by provider/model; Qwen default)         \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m 2 - qwen (common endpoint defaults to Qwen)              \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m 3 - zai (common endpoint defaults to Z.ai / GLM)         \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m 4 - deepseek (common endpoint defaults to DeepSeek Chat) \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m 5 - kimi (common endpoint defaults to Kimi)              \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m 6 - minimax (common endpoint defaults to MiniMax)        \x1b[36m│\x1b[0m');
    console.log('\x1b[36m│\x1b[0m 7 - Back                                                 \x1b[36m│\x1b[0m');
    console.log('\x1b[36m╰──────────────────────────────────────────────────────────╯\x1b[0m');

    const choice = await prompt('\nSelect active profile (Enter = 7): ');
    const nextProvider = {
        1: 'auto',
        2: 'qwen',
        3: 'zai',
        4: 'deepseek',
        5: 'kimi',
        6: 'minimax'
    }[choice];

    if (!nextProvider) return current;
    const active = setActiveProvider(nextProvider);
    console.log(`Active provider set to: ${active}`);
    return active;
}

export async function selectProviderAuthModeInteractive() {
    const providers = getProviderState();

    console.log('');
    console.log('Provider access mode');
    console.log('account = use an authorized browser/account session');
    console.log('guest   = use public guest mode where the provider supports it');
    console.log('');
    console.log(`1 - Qwen: ${providers.qwen.authMode} (guest unsupported; account recommended)`);
    console.log(`2 - Z.ai / GLM: ${providers.zai.authMode} (guest model catalog available)`);
    console.log(`3 - DeepSeek: ${providers.deepseek.authMode} (guest chat unavailable)`);
    console.log(`4 - Kimi: ${providers.kimi.authMode} (guest unsupported)`);
    console.log(`5 - MiniMax: ${providers.minimax.authMode} (guest unsupported)`);
    console.log('6 - Back');

    const providerChoice = await prompt('Select provider (Enter = 6): ');
    const provider = {
        1: 'qwen',
        2: 'zai',
        3: 'deepseek',
        4: 'kimi',
        5: 'minimax'
    }[providerChoice];
    if (!provider) return;

    console.log('');
    console.log(`Access mode for ${provider}:`);
    console.log('1 - account');
    
    if (provider !== 'kimi' && provider !== 'minimax') {
        console.log('2 - guest');
    }
    console.log('3 - Back');
    
    const modeChoice = await prompt('Select mode (Enter = 3): ');
    let mode = {
        1: 'account',
        2: 'guest'
    }[modeChoice];
    if (!mode) return;

    if (mode === 'guest' && (provider === 'kimi' || provider === 'minimax')) {
        console.log(`Guest mode is fundamentally unsupported for ${provider}. Defaulting to account mode.`);
        mode = 'account';
    }

    const nextMode = setProviderAuthMode(provider, mode);
    console.log(`${provider} auth mode set to: ${nextMode}`);
}

export async function selectProviderTransportModeInteractive() {
    const providers = getProviderState();

    console.log('');
    console.log('Provider transport mode');
    console.log('api = Use standard REST API calls (fastest, requires signatures/salts)');
    console.log('dom = Use Browser DOM Proxy (slower, fully emulates user, skips API protection)');
    console.log('');
    console.log(`1 - Qwen: ${providers.qwen.transportMode}`);
    console.log(`2 - Z.ai / GLM: ${providers.zai.transportMode}`);
    console.log(`3 - DeepSeek: ${providers.deepseek.transportMode}`);
    console.log(`4 - Kimi: ${providers.kimi.transportMode}`);
    console.log(`5 - MiniMax: ${providers.minimax.transportMode}`);
    console.log('6 - Back');

    const providerChoice = await prompt('Select provider (Enter = 6): ');
    const provider = {
        1: 'qwen',
        2: 'zai',
        3: 'deepseek',
        4: 'kimi',
        5: 'minimax'
    }[providerChoice];
    if (!provider) return;

    console.log('');
    console.log(`Transport mode for ${provider}:`);
    console.log('1 - api (Native API)');
    console.log('2 - dom (Browser DOM Proxy)');
    console.log('3 - Back');
    
    const modeChoice = await prompt('Select transport mode (Enter = 3): ');
    const mode = {
        1: 'api',
        2: 'dom'
    }[modeChoice];
    if (!mode) return;

    const nextMode = setProviderTransportMode(provider, mode);
    console.log(`${provider} transport mode set to: ${nextMode}`);
}

export async function runInteractiveStartup(shutdownFn) {
    const { prompt } = await import('../utils/prompt.js');
    const runDiag = await prompt('\nRun full provider diagnostics? [y/N]: ');
    
    if (runDiag.toLowerCase().startsWith('y')) {
        console.log('\n\x1b[36m╭────────────────────────────────────────────────────────────────────────────────────────────────────────╮\x1b[0m');
        console.log('\x1b[36m│\x1b[0m                         \x1b[33mRunning startup auto-diagnostics... please wait\x1b[0m                                \x1b[36m│\x1b[0m');
        console.log('\x1b[36m╰────────────────────────────────────────────────────────────────────────────────────────────────────────╯\x1b[0m\n');
        
        const initialState = getProviderState();
            const { runProviderTest } = await import('../api/tester.js');
            
            if (initialState.qwen.enabled) {
                console.log('\nTesting Qwen...');
                await runProviderTest('qwen');
            }
            if (initialState.zai.enabled) {
                console.log('\nTesting Z.ai/GLM...');
                await runProviderTest('zai');
            }
            if (initialState.deepseek.enabled) {
                console.log('\nTesting DeepSeek...');
                await runProviderTest('deepseek');
            }
            if (initialState.kimi.enabled) {
                console.log('\nTesting Kimi...');
                await runProviderTest('kimi');
            }
            if (initialState.minimax.enabled) {
                console.log('\nTesting MiniMax...');
                await runProviderTest('minimax');
            }
            
            const initialHf = getHuggingFaceSessionStatus();
            if (initialHf.available) {
                console.log('\nTesting HuggingFace...');
                await runProviderTest('hf');
            }
        }

    for (;;) {
        const qwen = getQwenTokenState();
        const zai = getZaiSessionStatus();
        const deepseek = getDeepSeekSessionStatus();
        const kimi = getKimiSessionStatus();
        const minimax = getMinimaxSessionStatus();
        const perplexity = getPerplexitySessionStatus();
        const mimo = getMimoSessionStatus();
        const hf = getHuggingFaceSessionStatus();
        const providerProfile = getActiveProviderProfile();
        const activeProvider = providerProfile.activeProvider;
        const qwenMode = getProviderAuthMode('qwen');
        const headlessMode = getHeadlessMode();

        console.log('');
        console.log('\n\x1b[36m╭────────────────────────────────────────────────────────────────────────────────────────────────────────╮\x1b[0m');
        console.log('\x1b[36m│\x1b[0m                                  \x1b[35mAI_DEVX\x1b[0m \x1b[90m•\x1b[0m \x1b[36mWEB2API GATEWAY STUDIO\x1b[0m                                      \x1b[36m│\x1b[0m');
        console.log('\x1b[36m╰────────────────────────────────────────────────────────────────────────────────────────────────────────╯\x1b[0m');
        console.log(`\n  \x1b[36m[ Active Profile ]:\x1b[0m \x1b[32m${activeProvider.toUpperCase()}\x1b[0m   \x1b[90m|\x1b[0m   \x1b[36m[ Visible Browser ]:\x1b[0m \x1b[33m${headlessMode === false ? 'ON' : 'OFF'}\x1b[0m`);
        console.log('\n\x1b[36m  ═════════════════════════════════════════[ PROVIDERS ]══════════════════════════════════════════════════\x1b[0m');
        const formatRow = (name, available, isValid = 0, total = 0) => {
            const id = name.split('/')[0].trim().toLowerCase().replace('.', '');
            const actualId = id === 'huggingf' ? 'hf' : id === 'z' ? 'zai' : id;
            
            const mode = providerProfile.providerAuthModes[actualId] || 'account';
            const transport = providerProfile.providerTransportModes[actualId] || 'api';
            let testStatus = providerProfile.providerTestStatuses[actualId] || 'Not tested';
            const displayMode = mode === 'api' ? 'api' : 'account';
            
            let hasAuth = available;
            if (mode === 'account' && total > 0) hasAuth = isValid > 0;
            else if (mode === 'account' && total === 0) hasAuth = false;
            
            const authStr = hasAuth ? '\x1b[32mYes\x1b[0m' : '\x1b[31mNo \x1b[0m';
            
            if (!hasAuth && testStatus === 'OK') {
                testStatus = 'Not tested';
            }

            let statusStr = '';
            if (hasAuth) {
                if (testStatus === 'OK') {
                    statusStr = '\x1b[32mConnected\x1b[0m';
                } else if (testStatus === 'Fail') {
                    statusStr = '\x1b[31mTest Failed\x1b[0m';
                } else {
                    statusStr = '\x1b[33mWaiting Test\x1b[0m';
                }
            } else {
                statusStr = '\x1b[90mUnauthorized\x1b[0m';
            }

            const pad = (str, len) => String(str).padEnd(len, ' ');
            const coloredName = `\x1b[36m${pad(name, 12)}\x1b[0m`;
            const coloredTransport = transport === 'dom' ? `\x1b[33mDOM\x1b[0m` : `\x1b[35mAPI\x1b[0m`;
            
            let coloredTest = pad(testStatus, 10);
            if (testStatus === 'OK') coloredTest = `\x1b[32m${coloredTest}\x1b[0m`;
            else if (testStatus === 'Fail') coloredTest = `\x1b[31m${coloredTest}\x1b[0m`;
            else coloredTest = `\x1b[33m${coloredTest}\x1b[0m`;
            
            
            const tokensStr = pad(`${isValid}/${total}`, 5);
            return `${coloredName} | Trans: ${coloredTransport} | Auth: ${authStr} | Tokens: \x1b[36m${tokensStr}\x1b[0m | Test: ${coloredTest} | Status: ${statusStr}`;
        };

        const tsZai = getTokenState('zai');
        const tsDeepseek = getTokenState('deepseek');
        const tsKimi = getTokenState('kimi');
        const tsMinimax = getTokenState('minimax');
        const tsPerplexity = getTokenState('perplexity');
        const tsMimo = getTokenState('mimo');
        const tsHf = getTokenState('hf');

        console.log(`  1. ${formatRow('Qwen', false, qwen.valid.length, qwen.total)}`);
        console.log(`  2. ${formatRow('Z.ai/GLM', zai.available, tsZai.valid.length, tsZai.total)}`);
        console.log(`  3. ${formatRow('DeepSeek', deepseek.available, tsDeepseek.valid.length, tsDeepseek.total)}`);
        console.log(`  4. ${formatRow('Kimi', kimi.available, tsKimi.valid.length, tsKimi.total)}`);
        console.log(`  5. ${formatRow('MiniMax', minimax.available, tsMinimax.valid.length, tsMinimax.total)}`);
        console.log(`  6. ${formatRow('Perplexity', perplexity.available, tsPerplexity.valid.length, tsPerplexity.total)}`);
        console.log(`  7. ${formatRow('Xiaomi MIMO', mimo.available, tsMimo.valid.length, tsMimo.total)}`);
        console.log(`  8. ${formatRow('HuggingF', hf.available, tsHf.valid.length, tsHf.total)}`);
        console.log('\n\x1b[36m  ══════════════════════════════════════════[ OPTIONS ]═══════════════════════════════════════════════════\x1b[0m');
        console.log('   9. Select Active Provider Profile \x1b[90m(Default fallback for standard clients)\x1b[0m');
        console.log('  10. List Models from Connected Providers');
        console.log('  11. Advanced Options');
        console.log('\n\x1b[36m  ════════════════════════════════════════════════════════════════════════════════════════════════════════\x1b[0m');
        console.log('  \x1b[1m\x1b[32m12. Start Common Endpoint (Default)\x1b[0m');
        console.log('   0. Exit');

        let choice = await prompt('\nSelect action (Enter = 12): ');
        if (!choice) choice = '12';
        
        const parsedChoice = parseInt(choice, 10);

        if (parsedChoice >= 1 && parsedChoice <= 8) {
            const providerMap = {
                1: 'qwen', 2: 'zai', 3: 'deepseek',
                4: 'kimi', 5: 'minimax', 6: 'perplexity',
                7: 'mimo', 8: 'huggingface'
            };
            const pId = providerMap[parsedChoice];
            const title = `[ ${pId.toUpperCase()} Configuration ]`;
            console.log(`\n\x1b[36m╭─── ${title.padEnd(54, '─')}╮\x1b[0m`);
            console.log('\x1b[36m│\x1b[0m 1 - Manage accounts (Add/Refresh/Remove)                 \x1b[36m│\x1b[0m');
            console.log('\x1b[36m│\x1b[0m 2 - View available models                                \x1b[36m│\x1b[0m');
            console.log('\x1b[36m│\x1b[0m 3 - Test API connection                                  \x1b[36m│\x1b[0m');
            console.log('\x1b[36m│\x1b[0m 4 - Back                                                 \x1b[36m│\x1b[0m');
            console.log('\x1b[36m╰──────────────────────────────────────────────────────────╯\x1b[0m');
            const subChoice = await prompt('\nSelect action (Enter = 4): ');
            if (subChoice === '1') {
                await interactiveAccountMenu(pId);
            } else if (subChoice === '2') {
                try {
                    let models = [];
                    if (pId === 'qwen') models = getAllModels().models.map(m => m.id || m.name || m);
                    else if (pId === 'zai') models = (await (await import('../providers/zai.js')).getZaiModels()).map(m => m.id);
                    else if (pId === 'deepseek') models = (await import('../providers/deepseek.js')).getDeepSeekModels().map(m => m.id);
                    else if (pId === 'kimi') models = (await import('../providers/kimi.js')).getKimiModels().map(m => m.id);
                    else if (pId === 'minimax') models = (await import('../providers/minimax.js')).getMinimaxModels().map(m => m.id);
                    else if (pId === 'perplexity') models = (await import('../providers/perplexity.js')).getPerplexityModels().map(m => m.id);
                    else if (pId === 'mimo') models = (await import('../providers/mimo.js')).getMimoModels().map(m => m.id);
                    else if (pId === 'huggingface') models = (await import('../providers/huggingface.js')).getHuggingFaceModels().map(m => m.id);
                    
                    console.log(`\nModels:\n` + models.map(m => `  - ${m}`).join('\n') + '\n');
                } catch(e) {
                    console.log('Could not load models.');
                }
            } else if (subChoice === '3') {
                const { runProviderTest } = await import('../api/tester.js');
                await runProviderTest(pId === 'huggingface' ? 'hf' : pId);
            }
        } else if (choice === '9') {
            await selectActiveProviderInteractive();
        } else if (choice === '10') {
            console.log('\n[ Available Models from Connected Providers ]\n');
            let allConnectedModels = [];
            
            if (qwen.valid.length > 0 && providerProfile.providerTestStatuses['qwen'] !== 'Fail') allConnectedModels.push({ provider: 'Qwen', models: getAllModels().models.map(m => m.id || m.name || m) });
            if (zai.available && providerProfile.providerTestStatuses['zai'] !== 'Fail') allConnectedModels.push({ provider: 'Z.ai/GLM', models: (await (await import('../providers/zai.js')).getZaiModels()).map(m => m.id) });
            if (deepseek.available && providerProfile.providerTestStatuses['deepseek'] !== 'Fail') allConnectedModels.push({ provider: 'DeepSeek', models: (await import('../providers/deepseek.js')).getDeepSeekModels().map(m => m.id) });
            if (kimi.available && providerProfile.providerTestStatuses['kimi'] !== 'Fail') allConnectedModels.push({ provider: 'Kimi', models: (await import('../providers/kimi.js')).getKimiModels().map(m => m.id) });
            if (minimax.available && providerProfile.providerTestStatuses['minimax'] !== 'Fail') allConnectedModels.push({ provider: 'MiniMax', models: (await import('../providers/minimax.js')).getMinimaxModels().map(m => m.id) });
            if (perplexity.available && providerProfile.providerTestStatuses['perplexity'] !== 'Fail') allConnectedModels.push({ provider: 'Perplexity', models: (await import('../providers/perplexity.js')).getPerplexityModels().map(m => m.id) });
            if (mimo.available && providerProfile.providerTestStatuses['mimo'] !== 'Fail') allConnectedModels.push({ provider: 'Xiaomi MIMO', models: (await import('../providers/mimo.js')).getMimoModels().map(m => m.id) });
            if (hf.available && providerProfile.providerTestStatuses['hf'] !== 'Fail') allConnectedModels.push({ provider: 'HuggingFace', models: (await import('../providers/huggingface.js')).getHuggingFaceModels().map(m => m.id) });
            
            if (allConnectedModels.length === 0) {
                console.log('No connected providers found.');
            } else {
                for (const group of allConnectedModels) {
                    console.log(`\x1b[36m=== ${group.provider} ===\x1b[0m`);
                    for (const m of group.models) {
                        console.log(`  - ${m}`);
                    }
                    console.log('');
                }
            }
            await prompt('Press Enter to return to menu...');
        } else if (choice === '11') {
            console.log('\n\x1b[36m╭─── [ ADVANCED OPTIONS ] ─────────────────────────────────╮\x1b[0m');
            console.log('\x1b[36m│\x1b[0m 1 - Show Provider Status (JSON)                          \x1b[36m│\x1b[0m');
            console.log('\x1b[36m│\x1b[0m 2 - Show Routing Examples                                \x1b[36m│\x1b[0m');
            console.log('\x1b[36m│\x1b[0m 3 - Toggle Visible Browser (Debug Mode)                  \x1b[36m│\x1b[0m');
            console.log('\x1b[36m│\x1b[0m 4 - Toggle Provider Transport Mode (API / DOM Proxy)     \x1b[36m│\x1b[0m');
            console.log('\x1b[36m│\x1b[0m 5 - Back                                                 \x1b[36m│\x1b[0m');
            console.log('\x1b[36m╰──────────────────────────────────────────────────────────╯\x1b[0m');
            const subChoice = await prompt('\nSelect action (Enter = 5): ');
            if (subChoice === '1') {
                console.log(JSON.stringify(getProviderState(), null, 2));
                await prompt('\nPress Enter to return...');
            } else if (subChoice === '2') {
                printRoutingHelp();
            } else if (subChoice === '3') {
                const next = toggleHeadlessMode();
                console.log(`\nVisible Browser (Debug Mode) turned ${next === false ? 'ON' : 'OFF'}.`);
                await prompt('\nPress Enter to return...');
            } else if (subChoice === '4') {
                await selectProviderTransportModeInteractive();
            }
        } else if (choice === '12') {
            return;
        } else if (choice === '0') {
            await shutdownFn(0);
        } else {
            console.log('Unknown action.');
        }
    }
}

