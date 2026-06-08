import { authorizeMinimaxInteractive } from '../src/providers/minimax.js';

import { runProviderTest } from '../src/api/tester.js';

async function runAuth() {
    try {
        await authorizeMinimaxInteractive();
        console.log('\nMiniMax authentication complete. Running automatic test...');
        await runProviderTest('minimax');
        console.log('\nYou can now use MiniMax via ApiConnector.');
        process.exit(0);
    } catch (err) {
        console.error('\nAuthentication failed:', err.message);
        process.exit(1);
    }
}

runAuth();
