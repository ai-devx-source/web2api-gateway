import { authorizeHuggingFaceInteractive } from '../src/providers/huggingface.js';
import { logInfo, logError } from '../src/logger/index.js';
import { runProviderTest } from '../src/api/tester.js';

async function main() {
    logInfo('Starting HuggingFace interactive authorization...');
    try {
        await authorizeHuggingFaceInteractive();
        logInfo('HuggingFace authentication complete. Running automatic test...');
        await runProviderTest('hf');
        logInfo('You can now use HuggingFace via ApiConnector.');
        process.exit(0);
    } catch (error) {
        logError(`Authorization failed: ${error.message}`);
        process.exit(1);
    }
}

main();
