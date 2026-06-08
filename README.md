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

| Provider | Transport | Models | Features |
|---|---|---|---|
| 🟢 **Qwen** | API | 28 models | Chat, Streaming, Vision, Image/Video Gen |
| 🟢 **Z.ai / GLM** | API + Browser | 14 models | Chat, Streaming, Vision, Deep Research |
| 🟢 **DeepSeek** | API + Browser | 2 models | Chat, Reasoning (R1) |
| 🟢 **Kimi (Moonshot)** | Browser | 6 models | Chat, Long Context (128k) |
| 🟢 **MiniMax (Hailuo)** | Browser | — | Chat, Streaming |
| 🟢 **Perplexity AI** | Browser | 8 models | Search-augmented Chat |
| 🟢 **Xiaomi MIMO** | API | 5 models | Chat, Streaming |
| 🟢 **HuggingFace** | Browser | 9 models | Open-source models |

### 📋 Available Models

<details>
<summary><b>Qwen (28 models)</b></summary>

```
qwen3.7-plus        qwen3.7-max          qwen3.6-plus
qwen3.5-plus        qwen3.5-flash        qwen3.5-397b-a17b
qwen3.5-122b-a10b   qwen3.5-27b          qwen3.5-35b-a3b
qwen3-max           qwen3-vl-plus        qwen3-coder-plus
qwen3-omni-flash    qwen3-235b-a22b      qwen3-30b-a3b
qwen3-coder-30b-a3b-instruct             qwq-32b
qwen-max-latest     qwen-plus-2025-09-11 qwen-plus-2025-01-25
qwen-turbo-2025-02-11                    qwen2.5-omni-7b
qvq-72b-preview-0310                     qwen2.5-vl-32b-instruct
qwen2.5-14b-instruct-1m                  qwen2.5-coder-32b-instruct
qwen2.5-72b-instruct
```
</details>

<details>
<summary><b>Z.ai / GLM (14 models)</b></summary>

```
GLM-5.1             GLM-5-Turbo          GLM-5v-Turbo
glm-5               glm-4.7              glm-4.6v
0727-106B-API       0727-360B-API        0808-360B-DR
GLM-4.1V-Thinking-FlashX                deep-research
zero                glm-4-flash          glm-4-air-250414
```
</details>

<details>
<summary><b>DeepSeek (2 models)</b></summary>

```
deepseek-chat       deepseek-reasoner
```
</details>

<details>
<summary><b>Kimi / Moonshot AI (6 models)</b></summary>

```
kimi-k2.6           kimi-k2.5            kimi-k2
moonshot-v1-128k    moonshot-v1-32k      moonshot-v1-8k
```
</details>

<details>
<summary><b>Perplexity AI (8 models)</b></summary>

```
Auto                Turbo                PPLX-Pro
Gemini-2.5-Pro      Claude-Sonnet-4      Claude-Opus-4
Nemotron            GPT-5
```
</details>

<details>
<summary><b>Xiaomi MIMO (5 models)</b></summary>

```
mimo-v2.5-pro       mimo-v2.5            mimo-v2-pro
mimo-v2-flash       mimo-v2-omni
```
</details>

<details>
<summary><b>HuggingFace (9 models)</b></summary>

```
DeepSeek-V4-Pro     Qwen3.6-35B-A3B      Llama-4-Scout-17B
Gemma-4-31B-it      Command-A-2025       GLM-5.1
Kimi-K2.6           MiniMax-M2.7         Qwen2.5-72B-Instruct
```
</details>

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

![Web2API Gateway Studio Menu](./docs/assets/menu.png?v=3)

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
