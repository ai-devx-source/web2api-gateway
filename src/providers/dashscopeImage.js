// imageGeneration.js - Module for image generation in Qwen Image API
import axios from 'axios';
import { logInfo, logError, logDebug } from '../logger/index.js';

const DASHSCOPE_API_BASE = 'https://dashscope-intl.aliyuncs.com/api/v1';

// Image generation models
const IMAGE_GENERATION_MODELS = [
    'qwen-image-max',
    'qwen-image-plus',
    'qwen-image',
    'wan2.6-t2i',
    'wan2.5-t2i-preview',
    'wan2.2-t2i-flash'
];

/**
 * Generate image from text description
 * @param {string} prompt - Text description of the image
 * @param {string} model - Model for generation
 * @param {object} options - Additional parameters
 * @returns {Promise<object>} - Generation result
 */
export async function generateImage(prompt, model = 'qwen-image-plus', options = {}) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    
    if (!apiKey) {
        logError('DASHSCOPE_API_KEY not set');
        return {
            error: 'DASHSCOPE_API_KEY not set. Please configure the environment variable.'
        };
    }

    try {
        logInfo(`Generating image in ${model}...`);
        logDebug(`Request: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`);

        const payload = {
            model: model,
            input: {
                prompt: prompt,
                negative_prompt: options.negativePrompt || ' '
            },
            parameters: {
                size: options.size || '1024*1024',
                n: options.n || 1,
                prompt_extend: options.promptExtend !== false,
                watermark: options.watermark || false
            }
        };

        // Asynchronous request for Wan models
        const isWanModel = model.startsWith('wan');
        const endpoint = isWanModel 
            ? `${DASHSCOPE_API_BASE}/services/aigc/text2image/image-synthesis`
            : `${DASHSCOPE_API_BASE}/services/aigc/text2image/image-synthesis`;

        const response = await axios.post(endpoint, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'X-DashScope-Async': isWanModel ? 'enable' : undefined
            },
            timeout: 120000
        });

        const data = response.data;

        // Asynchronous mode - get task_id and poll status
        if (data.output?.task_id) {
            logInfo(`Task created: ${data.output.task_id}`);
            return await pollTaskStatus(data.output.task_id, apiKey);
        }

        // Synchronous mode - get result immediately
        if (data.output?.results && data.output.results.length > 0) {
            const imageUrl = data.output.results[0].url;
            logInfo(`Image generated: ${imageUrl}`);
            return {
                success: true,
                imageUrl: imageUrl,
                taskId: data.output.task_id,
                model: model,
                prompt: prompt
            };
        }

        return {
            error: 'Unexpected API response format',
            rawData: data
        };

    } catch (error) {
        logError('Error generating image', error);
        return {
            error: error.response?.data?.message || error.message || 'Unknown error'
        };
    }
}

/**
 * Poll image generation task status
 * @param {string} taskId - Task ID
 * @param {string} apiKey - API key
 * @returns {Promise<object>} - Generation result
 */
async function pollTaskStatus(taskId, apiKey) {
    const maxAttempts = 60;
    const pollInterval = 2000; // 2 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const response = await axios.get(
                `${DASHSCOPE_API_BASE}/tasks/${taskId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    }
                }
            );

            const task = response.data;
            const taskStatus = task.output?.task_status;

            logDebug(`Task status ${taskId}: ${taskStatus} (attempt ${attempt + 1}/${maxAttempts})`);

            if (taskStatus === 'SUCCEEDED') {
                const imageUrl = task.output?.results?.[0]?.url;
                if (imageUrl) {
                    logInfo(`Image generated: ${imageUrl}`);
                    return {
                        success: true,
                        imageUrl: imageUrl,
                        taskId: taskId,
                        model: task.input?.model || 'unknown'
                    };
                }
                return { error: 'Image not found in result' };
            }

            if (taskStatus === 'FAILED' || taskStatus === 'CANCELLED') {
                return {
                    error: `Task finished with status: ${taskStatus}`,
                    message: task.output?.message || 'Unknown error'
                };
            }

            // PENDING or RUNNING - continue polling
            await new Promise(resolve => setTimeout(resolve, pollInterval));

        } catch (error) {
            logError(`Error polling task ${taskId}`, error);
            if (attempt === maxAttempts - 1) {
                return { error: `Polling error: ${error.message}` };
            }
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
    }

    return { error: 'Image generation timeout exceeded' };
}

/**
 * Get list of available image generation models
 * @returns {string[]} - List of models
 */
export function getAvailableImageModels() {
    return IMAGE_GENERATION_MODELS;
}

/**
 * Check image generation API availability
 * @returns {Promise<boolean>} - Availability status
 */
export async function checkImageApiAvailability() {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    
    if (!apiKey) {
        return false;
    }

    try {
        // Simple test request to check API
        await axios.get(`${DASHSCOPE_API_BASE}/models`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            timeout: 5000
        });
        return true;
    } catch (error) {
        logDebug(`Image generation API is unavailable: ${error.message}`);
        return false;
    }
}
