import fs from 'fs';
import path from 'path';
import { SESSION_DIR, PUPPETEER_HEADLESS } from '../config.js';

const PROFILE_FILE = path.resolve(process.cwd(), SESSION_DIR, 'provider-profile.json');
const VALID_PROVIDERS = new Set(['auto', 'qwen', 'zai', 'deepseek', 'kimi', 'minimax', 'perplexity', 'mimo', 'huggingface']);
const VALID_AUTH_MODES = new Set(['account', 'guest']);
const VALID_TRANSPORT_MODES = new Set(['api', 'dom']);
const DEFAULT_PROVIDER = 'auto';
const DEFAULT_AUTH_MODES = {
    qwen: 'account',
    zai: 'account',
    deepseek: 'account',
    kimi: 'account',
    minimax: 'account',
    perplexity: 'account',
    mimo: 'account',
    huggingface: 'account'
};

function normalizeProvider(value) {
    const provider = String(value || '').trim().toLowerCase();
    if (provider === 'glm') return 'zai';
    if (provider === 'ds') return 'deepseek';
    if (provider === 'moonshot') return 'kimi';
    if (provider === 'mm') return 'minimax';
    if (provider === 'pplx') return 'perplexity';
    if (provider === 'hf') return 'huggingface';
    return VALID_PROVIDERS.has(provider) ? provider : DEFAULT_PROVIDER;
}

function normalizeAuthMode(value, provider) {
    return parseAuthMode(value) || DEFAULT_AUTH_MODES[provider] || 'account';
}

function parseAuthMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    if (mode === 'auth' || mode === 'authorized' || mode === 'account') return 'account';
    if (mode === 'noauth' || mode === 'anonymous' || mode === 'guest') return 'guest';
    return VALID_AUTH_MODES.has(mode) ? mode : null;
}

function parseTransportMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    if (mode === 'native' || mode === 'api') return 'api';
    if (mode === 'proxy' || mode === 'dom') return 'dom';
    return VALID_TRANSPORT_MODES.has(mode) ? mode : null;
}

function readProfile() {
    try {
        if (!fs.existsSync(PROFILE_FILE)) return {};
        return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function writeProfile(patch) {
    const next = {
        ...readProfile(),
        ...patch,
        updatedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

export function getActiveProvider() {
    const envProvider = normalizeProvider(process.env.API_CONNECTOR_ACTIVE_PROVIDER);
    if (process.env.API_CONNECTOR_ACTIVE_PROVIDER) return envProvider;

    const profile = readProfile();
    return normalizeProvider(profile.activeProvider);
}

export function getHeadlessMode() {
    const profile = readProfile();
    if (profile.headlessMode !== undefined) return profile.headlessMode;
    return PUPPETEER_HEADLESS;
}

export function toggleHeadlessMode() {
    const current = getHeadlessMode();
    const next = current === false ? 'new' : false;
    writeProfile({ headlessMode: next });
    return next;
}

export function setActiveProvider(provider) {
    const activeProvider = normalizeProvider(provider);
    writeProfile({ activeProvider });
    process.env.API_CONNECTOR_ACTIVE_PROVIDER = activeProvider;
    return activeProvider;
}

function getModeEnvName(provider) {
    return `API_CONNECTOR_${String(provider).toUpperCase()}_AUTH_MODE`;
}

function getTransportEnvName(provider) {
    return `API_CONNECTOR_${String(provider).toUpperCase()}_TRANSPORT_MODE`;
}

export function getProviderAuthMode(provider) {
    const normalizedProvider = normalizeProvider(provider);
    if (!DEFAULT_AUTH_MODES[normalizedProvider]) return 'account';

    const envName = getModeEnvName(normalizedProvider);
    const legacyEnvName = `${String(normalizedProvider).toUpperCase()}_AUTH_MODE`;
    const envMode = process.env[envName] || process.env[legacyEnvName];
    if (envMode) return normalizeAuthMode(envMode, normalizedProvider);

    const profile = readProfile();
    return normalizeAuthMode(profile.providerAuthModes?.[normalizedProvider], normalizedProvider);
}

export function setProviderAuthMode(provider, mode) {
    const normalizedProvider = normalizeProvider(provider);
    if (!DEFAULT_AUTH_MODES[normalizedProvider]) {
        throw new Error(`Provider ${provider} does not support auth mode configuration.`);
    }
    const authMode = parseAuthMode(mode);
    if (!authMode) {
        throw new Error(`Auth mode must be one of: ${[...VALID_AUTH_MODES].join(', ')}.`);
    }
    const profile = readProfile();
    writeProfile({
        providerAuthModes: {
            ...(profile.providerAuthModes || {}),
            [normalizedProvider]: authMode
        }
    });
    process.env[getModeEnvName(normalizedProvider)] = authMode;
    return authMode;
}

export function getProviderTransportMode(provider) {
    const normalizedProvider = normalizeProvider(provider);
    const envMode = process.env[getTransportEnvName(normalizedProvider)];
    if (envMode) return parseTransportMode(envMode) || 'api';

    const profile = readProfile();
    return parseTransportMode(profile.providerTransportModes?.[normalizedProvider]) || 'api';
}

export function setProviderTransportMode(provider, mode) {
    const normalizedProvider = normalizeProvider(provider);
    const transportMode = parseTransportMode(mode);
    if (!transportMode) {
        throw new Error(`Transport mode must be one of: ${[...VALID_TRANSPORT_MODES].join(', ')}.`);
    }
    const profile = readProfile();
    writeProfile({
        providerTransportModes: {
            ...(profile.providerTransportModes || {}),
            [normalizedProvider]: transportMode
        }
    });
    process.env[getTransportEnvName(normalizedProvider)] = transportMode;
    return transportMode;
}

export function getProviderAuthModes() {
    return Object.fromEntries(
        Object.keys(DEFAULT_AUTH_MODES).map(provider => [provider, getProviderAuthMode(provider)])
    );
}

export function getProviderTransportModes() {
    return Object.fromEntries(
        Object.keys(DEFAULT_AUTH_MODES).map(provider => [provider, getProviderTransportMode(provider)])
    );
}

export function getProviderTestStatus(provider) {
    const normalizedProvider = normalizeProvider(provider);
    const profile = readProfile();
    return profile.providerTestStatuses?.[normalizedProvider] || 'Not tested';
}

export function setProviderTestStatus(provider, status) {
    const normalizedProvider = normalizeProvider(provider);
    const profile = readProfile();
    writeProfile({
        providerTestStatuses: {
            ...(profile.providerTestStatuses || {}),
            [normalizedProvider]: status
        }
    });
    return status;
}

export function getProviderTestStatuses() {
    const profile = readProfile();
    return Object.fromEntries(
        Object.keys(DEFAULT_AUTH_MODES).map(provider => [provider, profile.providerTestStatuses?.[provider] || 'Not tested'])
    );
}

export function getActiveProviderProfile() {
    return {
        activeProvider: getActiveProvider(),
        validProviders: [...VALID_PROVIDERS],
        providerAuthModes: getProviderAuthModes(),
        providerTransportModes: getProviderTransportModes(),
        providerTestStatuses: getProviderTestStatuses(),
        source: process.env.API_CONNECTOR_ACTIVE_PROVIDER ? 'env' : 'session'
    };
}

