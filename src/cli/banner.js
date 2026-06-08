import {
    SERVICE_NAME,
    SERVICE_VERSION,
    SERVICE_DEVELOPER,
    SERVICE_DISCLAIMER,
    getServiceMetadata
} from '../utils/branding.js';

export function printBanner() {
    const metadata = getServiceMetadata();
    console.log('');
    console.log(' \x1b[35m█████╗ ██╗    ██████╗ ███████╗██╗   ██╗██╗  ██╗\x1b[0m');
    console.log(' \x1b[35m██╔══██╗██║    ██╔══██╗██╔════╝██║   ██║╚██╗██╔╝\x1b[0m');
    console.log(' \x1b[35m███████║██║    ██║  ██║█████╗  ██║   ██║ ╚███╔╝ \x1b[0m');
    console.log(' \x1b[35m██╔══██║██║    ██║  ██║██╔══╝  ╚██╗ ██╔╝ ██╔██╗ \x1b[0m');
    console.log(' \x1b[35m██║  ██║██║    ██████╔╝███████╗ ╚████╔╝ ██╔╝ ██╗\x1b[0m');
    console.log(' \x1b[35m╚═╝  ╚═╝╚═╝    ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝  ╚═╝\x1b[0m');
    console.log('');
    console.log(`${SERVICE_NAME} ${SERVICE_VERSION}`);
    console.log(`Developer: ${SERVICE_DEVELOPER}`);
    console.log(`Mode: OpenAI-compatible multi-provider gateway`);
    console.log(`Repository: ${metadata.repository}`);
    console.log('');
}

export async function showDisclaimerAgreement(prompt) {
    console.log('\n\x1b[31m╔═════════════════════════════════════════════════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[31m║\x1b[0m \x1b[1;33m⚠️  DISCLAIMER & TERMS OF USE\x1b[0m                                                           \x1b[31m║\x1b[0m');
    console.log('\x1b[31m╠═════════════════════════════════════════════════════════════════════════════════════════╣\x1b[0m');
    const lines = SERVICE_DISCLAIMER.split('\n');
    lines.forEach(line => {
        const plainText = line.replace(/\x1b\[[0-9;]*m/g, '');
        const padding = Math.max(0, 88 - plainText.length);
        console.log(`\x1b[31m║\x1b[0m ${line}${' '.repeat(padding)}\x1b[31m║\x1b[0m`);
    });
    console.log('\x1b[31m╚═════════════════════════════════════════════════════════════════════════════════════════╝\x1b[0m\n');
    
    while (true) {
        const choice = await prompt('Do you agree to these terms? (yes/no): ');
        const val = choice.trim().toLowerCase();
        if (val === 'yes' || val === 'y') return true;
        if (val === 'no' || val === 'n') return false;
    }
}
