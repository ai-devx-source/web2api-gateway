#!/usr/bin/env node

import { authorizeDeepSeekInteractive, closeDeepSeekBrowser } from '../src/providers/deepseek.js';
import { logError } from '../src/logger/index.js';

import { runProviderTest } from '../src/api/tester.js';

try {
    await authorizeDeepSeekInteractive();
    console.log('\nDeepSeek authentication complete. Running automatic test...');
    await runProviderTest('deepseek');
    console.log('------------------------------------------------------');
    console.log('You can press ENTER to close the browser, OR leave this script');
    console.log('running in the background - then ApiConnector will connect to this same browser without starting a new one.');
    
    await new Promise((resolve) => {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        const onData = (key) => {
            if (key === '\n' || key === '\r' || key.charCodeAt(0) === 13) {
                process.stdin.pause();
                process.stdin.removeListener('data', onData);
                resolve();
            }
        };
        process.stdin.on('data', onData);
    });
} catch (error) {
    logError('DeepSeek authorization failed', error);
    process.exitCode = 1;
} finally {
    await closeDeepSeekBrowser();
}
