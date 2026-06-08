import readline from 'readline';

/**
 * Interactive input from stdin.
 * @param {string} question - Question text
 * @returns {Promise<string>} - User response (trimmed)
 */
export function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}
