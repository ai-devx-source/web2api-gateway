# 🚀 Web2API Gateway Studio

<div align="center">
  <img src="https://img.shields.io/badge/version-v1.9.202-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/Node.js-18%2B-green.svg" alt="Node">
  <img src="https://img.shields.io/badge/Status-Active-success.svg" alt="Status">
</div>

> [🇷🇺 Для русскоязычной документации перейдите сюда (Russian README)](./README_RU.md)

> **Web2API Gateway** is a powerful local gateway that unifies multiple web-chat AI providers into a single **OpenAI-compatible API**. 
> Access cutting-edge neural networks for free through standard clients (VS Code, Cursor, OpenWebUI, LobeChat) using your existing browser accounts.

⚠️ **Disclaimer:** Please use dedicated test accounts. This project is provided "as-is". Use at your own risk!

---

## ✨ Features & Supported Providers

The service supports 8 different providers via direct API integration, browser session hijacking (Cookies), or Cloudflare bypass (DOM-proxying).

- 🟢 **Qwen (Tongyi Qianwen)** — Full support (chat, streaming, guest mode).
- 🟢 **Z.ai / GLM** — Browser-backed API, Guest mode support.
- 🟢 **DeepSeek** — Supported via session extraction, Cloudflare bypass with header spoofing.
- 🟢 **Kimi (Moonshot AI)** — Supported via Browser DOM Proxy (authorization required).
- 🟢 **MiniMax (Hailuo AI)** — Session extraction via official web application.
- 🟢 **Perplexity AI** — Supported via `__Secure-next-auth.session-token` cloning.
- 🟢 **Xiaomi MIMO** — Supported via Cookie sessions.
- 🟢 **HuggingFace** — Access to free open-source models.

🎨 **Media Generation (Images & Video):** Supports image (`/v1/images/generations`) and video (`/v1/videos/generations`) generation powered by Qwen (Wanx) or DashScope.
🤖 **Agents & Web UI:** Functions as a drop-in OpenAI API replacement. Seamlessly integrates with any agentic framework (LangChain, AutoGPT, Hermes-based agents) and web panels (Open WebUI, LobeChat, Cursor, VS Code).

---

## 📦 Installation & Quick Start

The project is built on **Node.js** and optimized for local execution (Windows/Mac/Linux).

### 1. Clone the repository
```bash
git clone https://github.com/ai-devx-source/web2api-gateway.git
cd web2api-gateway
```

### 2. Automatic Installation (First Launch)
To automatically install all dependencies:
- **Windows:** Double-click `web2api-install.bat`
- **Linux/Mac:** Run `./web2api-install.sh`

### 3. Start the Gateway (Interactive Dashboard)
For daily usage:
- **Windows:** Double-click `web2api-start.bat`
- **Linux/Mac:** Run `./web2api-start.sh`

Once started, the **Interactive CLI Dashboard** will appear:

```text
======================[ PROVIDERS ]======================
1. Qwen         | Trans: API | Auth: Yes | Tokens: 1/1  | Test: OK         | Status: Connected
2. DeepSeek     | Trans: API | Auth: Yes | Tokens: 1/1  | Test: OK         | Status: Connected
3. Kimi         | Trans: API | Auth: Yes | Tokens: 1/1  | Test: OK         | Status: Connected
...
======================[ OPTIONS ]======================
 9. Select Active Provider Profile (Default fallback for standard clients)
10. List Models from Connected Providers
...
12. Start Common Endpoint (Default)
```

- Manage token and account statuses.
- Select your default **Active Provider**.
- Run automated connection smoke tests.

To run the gateway in the background (headless mode):
```bash
npm run connector:serve
```

---

## 🔌 API Usage (OpenAI Format)

Once launched, the server exposes an OpenAI-compatible API endpoint at:
👉 `http://localhost:3000/v1`

### Example Request (cURL)

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dummy-key" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "user", "content": "Tell me briefly about yourself"}
    ],
    "stream": true
  }'
```

The gateway **automatically detects the requested model** (e.g., `deepseek-chat` -> DeepSeek, `moonshot-v1-8k` -> Kimi) and routes the request to the appropriate provider. If the model is not found, it falls back to the default Provider.

> 💡 **Important for Open WebUI:** If you run Open WebUI via Docker, please note: any connection settings (API URLs and Keys) previously saved in the WebUI Admin Panel take precedence and permanently override Docker environment variables (e.g., `OPENAI_API_BASE_URL`). If the gateway fails to connect, check your Admin Panel -> Settings -> Connections tab!

---

## 📚 Documentation

All setup and integration guides are available in the `docs/en/` folder:

1. [Quickstart Guide](./docs/en/01_QUICKSTART.md)
2. [Providers Setup & Authorization](./docs/en/02_PROVIDERS_GUIDE.md)
3. [Client Integration (Open WebUI, LobeChat)](./docs/en/03_CLIENT_INTEGRATION.md)
4. [Image Generation](./docs/en/04_IMAGE_GENERATION.md)
5. [Troubleshooting](./docs/en/05_TROUBLESHOOTING.md)

## Disclaimer
This project was developed exclusively for educational and research purposes as an experimental technical study. The software is provided "as is", without any warranties of performance or stability. The project is currently in an early, raw stage of development, and future updates or active maintenance are not guaranteed.

**Important Note on Stability:** AI service providers constantly update their anti-bot and security mechanisms—sometimes not just daily, but hourly. They actively use their own powerful AI models to monitor traffic and defend their endpoints 24/7. Because of this, any unofficial connection methods may break instantly and without warning.

The end user assumes all responsibility and risk associated with the use of this software. For reliable and production-ready solutions, it is highly recommended to use the official APIs provided by the respective services (both free and paid tiers).

---
*Developed by **AI_DEVX***
