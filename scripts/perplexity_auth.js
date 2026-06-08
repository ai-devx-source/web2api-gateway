import readline from 'readline';
import { perplexityTokenManager } from '../src/providers/perplexity.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
    console.log('=============================================');
    console.log('   Perplexity AI Authorization Setup');
    console.log('=============================================');
    console.log('1. Go to https://www.perplexity.ai/ and log in.');
    console.log('2. Open Developer Tools (F12) -> Application -> Cookies.');
    console.log('3. Copy the value of the `__Secure-next-auth.session-token` cookie.');
    console.log('=============================================');
    
    const token = await prompt('Enter session-token: ');
    if (!token.trim()) {
        console.log('Authorization cancelled.');
        rl.close();
        return;
    }

    const tokenObj = {
        id: `pplx-${Date.now()}`,
        sessionToken: token.trim(),
        createdAt: new Date().toISOString()
    };

    perplexityTokenManager.saveTokens([tokenObj]);
    console.log('Perplexity token saved successfully!');
    rl.close();
}

main().catch(console.error);
