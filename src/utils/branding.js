export const SERVICE_NAME = process.env.SERVICE_NAME || 'Web2API Gateway';
export const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.9.202';
export const SERVICE_BRAND = process.env.SERVICE_BRAND || 'AI_DEVX';
export const SERVICE_WATERMARK = process.env.SERVICE_WATERMARK || 'AI_DEVX';
export const SERVICE_DEVELOPER = process.env.SERVICE_DEVELOPER || 'AI_DEVX';
export const SERVICE_REPOSITORY = process.env.SERVICE_REPOSITORY || 'https://github.com/ai-devx-source/web2api-gateway';
export const SERVICE_DESCRIPTION = 'OpenAI-compatible multi-provider gateway for web chat connectors';
export const SERVICE_DISCLAIMER = process.env.SERVICE_DISCLAIMER ||
    'Use a \x1b[33mdedicated test account\x1b[0m when possible.\n' +
    'This is a workaround that is not officially supported by the developers.\n' +
    'Things might work incorrectly: tools may fail, the context window might be too small,\n' +
    'and the underlying services can be patched or restricted at any moment.\n' +
    'Provided as-is, without warranty or liability. \x1b[31mUse at your own risk!\x1b[0m';

export function getServiceMetadata() {
    return {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        brand: SERVICE_BRAND,
        watermark: SERVICE_WATERMARK,
        developer: SERVICE_DEVELOPER,
        repository: SERVICE_REPOSITORY,
        description: SERVICE_DESCRIPTION,
        disclaimer: SERVICE_DISCLAIMER
    };
}

export function formatServiceWatermark(prefix = SERVICE_NAME) {
    return `${prefix}: ${SERVICE_WATERMARK}`;
}
