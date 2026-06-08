import readline from 'readline';
import { mimoTokenManager } from '../src/providers/mimo.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
    console.log('=============================================');
    console.log('   Xiaomi MIMO Authorization Setup');
    console.log('=============================================');
    console.log('1. Go to https://platform.xiaomimimo.com/');
    console.log('2. Sign in and navigate to API Keys section.');
    console.log('3. Create a new API key (format: sk-... or tp-...)');
    console.log('=============================================');

    const apiKey = await prompt('Enter MIMO API key: ');
    if (!apiKey.trim()) {
        console.log('Authorization cancelled.');
        rl.close();
        return;
    }

    const tokenObj = {
        id: `mimo-${Date.now()}`,
        token: apiKey.trim(),
        createdAt: new Date().toISOString()
    };

    mimoTokenManager.saveTokens([tokenObj]);
    console.log('✅ Xiaomi MIMO API key saved successfully!');
    console.log('   You can now use MIMO models via the gateway.');
    rl.close();
}

main().catch(console.error);
