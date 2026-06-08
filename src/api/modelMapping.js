import { DEFAULT_MODEL } from '../config.js';

/**
 * Standard OpenAI aliases for generic usage
 */
const ALIAS_GROUPS = Object.freeze({
    "gpt-3.5-turbo": [
        "gpt-3.5-turbo-0125",
        "gpt-3.5-turbo-1106"
    ],
    "gpt-4": [
        "gpt-4-0613",
        "gpt-4-turbo",
        "gpt-4o"
    ]
});

const buildModelMapping = () => {
    const mapping = Object.create(null);

    // If we want to map generic names to specific models in the future, we do it here.
    // Currently, we let the active provider handle it dynamically.
    for (const [target, aliases] of Object.entries(ALIAS_GROUPS)) {
        for (const alias of aliases) {
            mapping[alias] = target;
        }
    }

    return Object.freeze(mapping);
};

export const MODEL_MAPPING = buildModelMapping();

/**
 * Resolve the corresponding available model or act as a transparent proxy
 * @param {string} requestedModel - The requested target model
 * @param {string} defaultModel - The fallback default model
 * @returns {string} - The resolved available model
 */
export function getMappedModel(requestedModel, defaultModel = DEFAULT_MODEL) {
    if (!requestedModel) return defaultModel;

    // Validate against generic mapping dictionary (e.g. gpt-4 -> target)
    if (MODEL_MAPPING[requestedModel]) {
        return MODEL_MAPPING[requestedModel];
    }

    // Transparent proxy: return the requested model exactly as asked.
    // The Active Provider and Catalog will determine if it's supported.
    return requestedModel;
}