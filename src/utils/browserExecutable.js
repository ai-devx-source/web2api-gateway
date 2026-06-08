import fs from 'fs';

const WINDOWS_BROWSER_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const POSIX_BROWSER_PATHS = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
];

function existingPath(paths) {
    return paths.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

export function resolveBrowserExecutable() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }

    return existingPath(process.platform === 'win32' ? WINDOWS_BROWSER_PATHS : POSIX_BROWSER_PATHS);
}

export function getBrowserInstallHint() {
    return [
        'Browser executable was not found.',
        'Set CHROME_PATH to an installed Chrome/Edge executable, or install Puppeteer Chrome:',
        '  npx puppeteer browsers install chrome'
    ].join('\n');
}
