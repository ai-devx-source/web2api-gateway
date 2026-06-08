import { setProviderTestStatus } from '../providers/activeProvider.js';
import { logInfo, logError } from '../logger/index.js';

export async function runProviderTest(providerId) {
    logInfo(`[Tester] Starting connection test for provider: ${providerId}`);
    try {
        const testPrompt = 'Hello, this is an automated diagnostic test. Please reply with a short confirmation like "OK".';
        const messages = [{ role: 'user', content: testPrompt }];
        let result;

        if (providerId === 'qwen') {
            const { sendMessage } = await import('../providers/qwen.js');
            const { getAllModels } = await import('./configManager.js');
            const { initBrowser, getBrowserContext } = await import('../browser/browser.js');
            let browserWasStarted = false;
            if (!getBrowserContext()) {
                await initBrowser(false, false);
                browserWasStarted = true;
            }
            
            const models = getAllModels().models;
            const modelToUse = models.find(m => m.id.includes('3.5-plus'))?.id || models.find(m => m.id.includes('plus'))?.id || models[0].id;
            
            result = await sendMessage(testPrompt, modelToUse, null, null, null, null, null, null, 't2t', null, true);
            
            if (browserWasStarted) {
                const { shutdownBrowser } = await import('../browser/browser.js');
                await shutdownBrowser();
            }
        } else if (providerId === 'zai') {
            const { sendZaiChatCompletion } = await import('../providers/zai.js');
            result = await sendZaiChatCompletion({ messages, stream: false });
        } else if (providerId === 'deepseek') {
            const { sendDeepSeekChatCompletion } = await import('../providers/deepseek.js');
            result = await sendDeepSeekChatCompletion({ messages, stream: false });
        } else if (providerId === 'kimi') {
            const { sendKimiChatCompletion } = await import('../providers/kimi.js');
            result = await sendKimiChatCompletion({ messages, stream: false });
        } else if (providerId === 'minimax') {
            const { sendMinimaxChatCompletion } = await import('../providers/minimax.js');
            result = await sendMinimaxChatCompletion({ messages: messages, stream: false });
        } else if (providerId === 'perplexity') {
            const { sendPerplexityChatCompletion } = await import('../providers/perplexity.js');
            result = await sendPerplexityChatCompletion({ messages: messages, stream: false });
        } else if (providerId === 'mimo') {
            const { sendMimoChatCompletion } = await import('../providers/mimo.js');
            result = await sendMimoChatCompletion({ messages: messages, stream: false });
        } else if (providerId === 'hf' || providerId === 'huggingface') {
            const { sendHuggingFaceChatCompletion } = await import('../providers/huggingface.js');
            result = await sendHuggingFaceChatCompletion({ messages, stream: false });
        } else {
            throw new Error(`Unknown provider for testing: ${providerId}`);
        }

        if (result?.error) {
            throw new Error(`Response from provider with error: ${result.error}`);
        }

        const content = result?.choices?.[0]?.message?.content;
        if (content && content.trim() !== '') {
            logInfo(`[Tester] ${providerId} replied successfully: ${content.substring(0, 50)}...`);
            setProviderTestStatus(providerId, 'OK');
            return true;
        } else {
            throw new Error(`Empty response from model. Full response: ${JSON.stringify(result)}`);
        }
    } catch (error) {
        logError(`[Tester] Error testing ${providerId}: ${error.message}`);
        setProviderTestStatus(providerId, 'Fail');
        return false;
    }
}
