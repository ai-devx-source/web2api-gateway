import { authorizeKimiInteractive } from '../src/providers/kimi.js';

import { runProviderTest } from '../src/api/tester.js';

async function runAuth() {
    try {
        await authorizeKimiInteractive();
        console.log('\nKimi authentication complete. Running automatic test...');
        await runProviderTest('kimi');
        console.log('\nYou can now use Kimi via ApiConnector.');
        process.exit(0);
    } catch (err) {
        console.error('\nAuthentication failed:', err.message);
        process.exit(1);
    }
}

runAuth();
