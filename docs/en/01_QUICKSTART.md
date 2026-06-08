# 01. Quickstart

Welcome to **Web2API Gateway** — a universal gateway that integrates the web interfaces of multiple neural networks into a single OpenAI-compatible API endpoint.

## Supported Providers

Currently, the gateway supports 8 providers:
1. **Qwen (Tongyi Qianwen)**
2. **Z.ai / GLM**
3. **DeepSeek**
4. **Kimi (Moonshot)**
5. **MiniMax**
6. **Perplexity AI**
7. **Xiaomi MIMO**
8. **HuggingFace**

## System Requirements

- **Node.js** version 18 or higher.
- **Google Chrome** for providers that require Cloudflare bypass or DOM proxying (Kimi, DeepSeek).

## 🛠️ Installation and Startup (Extremely Simple!)

You no longer need to type complex commands in the terminal. We have prepared automatic scripts!

1. **Installation (First Run):**
   - **For Windows:** Just double-click the `web2api-install.bat` file. It will automatically download all dependencies (`npm install`) and configure the project.
   - **For Linux / Mac:** Run `./web2api-install.sh`.

2. **Daily Startup:**
   - **For Windows:** Double-click `web2api-start.bat`.
   - **For Linux / Mac:** Run `./web2api-start.sh`.

After that, an **Interactive CLI Menu** will open! In it, you can monitor provider statuses, authorize accounts, change the active profile, and manage settings.

*(For advanced users: you can still use the standard `npm install` and `npm start`)*



## Using the API

By default, the server starts on port `3000`. Your base URL for any compatible clients is:
`http://localhost:3000/v1`

API Key (`Bearer Token`): `sk-any-string-you-want` (can be anything if strict authentication is not configured in `.env`).

### Example Request:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-12345" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello! How are you?"}],
    "stream": true
  }'
```

The gateway will **automatically** determine the provider by the model name (`deepseek-chat` -> DeepSeek). If the model is not recognized, the request will be sent to the *Default Provider*, which is selected in option 9 of the CLI menu.

Proceed to [02_PROVIDERS_GUIDE.md](./02_PROVIDERS_GUIDE.md) to configure accounts and tokens.
