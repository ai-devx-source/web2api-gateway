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
    console.log('1. Go to https://aistudio.xiaomimimo.com/ and log in.');
    console.log('2. Open Developer Tools (F12) -> Application -> Cookies.');
    console.log('3. Copy the following 3 cookies:');
    console.log('=============================================');
    
    const serviceToken = await prompt('Enter serviceToken: ');
    if (!serviceToken.trim()) {
        console.log('Authorization cancelled.');
        rl.close();
        return;
    }

    const userId = await prompt('Enter userId: ');
    if (!userId.trim()) {
        console.log('Authorization cancelled.');
        rl.close();
        return;
    }

    const phToken = await prompt('Enter xiaomichatbot_ph: ');
    if (!phToken.trim()) {
        console.log('Authorization cancelled.');
        rl.close();
        return;
    }

    const tokenObj = {
        id: `mimo-${Date.now()}`,
        serviceToken: serviceToken.trim(),
        userId: userId.trim(),
        phToken: phToken.trim(),
        createdAt: new Date().toISOString()
    };

    mimoTokenManager.saveTokens([tokenObj]);
    console.log('Xiaomi MIMO tokens saved successfully!');
    rl.close();
}

main().catch(console.error);
