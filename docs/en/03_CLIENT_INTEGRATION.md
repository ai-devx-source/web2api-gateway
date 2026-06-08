# 03. Client Integration

`Web2API Gateway` fully emulates the **OpenAI API**, allowing you to connect any modern AI clients and interfaces simply by changing the `Base URL`.

---

## Universal Settings (Base Settings)

Regardless of which client you use, you will need the following settings:

- **OpenAI Base URL**: `http://localhost:3000/v1`
- **OpenAI API Key**: `sk-12345` (any non-empty string, if strict key verification is not enabled in `.env`).

The gateway supports two endpoints:
- `/v1/chat/completions` (Text generation)
- `/v1/models` (Retrieving the list of models of all active providers)

---

## Integration with Open WebUI

[Open WebUI](https://github.com/open-webui/open-webui) is a powerful web interface perfectly suited for working with our gateway.

### Setup Steps:
1. Open Open WebUI and go to **Settings -> Connections**.
2. Click the **[+]** icon to add a new OpenAI provider.
3. Fill in the fields:
   - **Base URL**: `http://localhost:3000/v1` (Or `http://host.docker.internal:3000/v1` if WebUI is running in Docker and the gateway is on the host machine).
   - **API Key**: `sk-12345`.
4. Click the **save (checkmark)** button.
5. Click the Refresh button next to the added URL so that WebUI requests the list of available models from the `/v1/models` endpoint.

Now you can select any model (e.g., `deepseek-chat` or `MiMo-V2.5`) from the dropdown list in the main chat window.

---

## Integration with LobeChat / NextChat (ChatGPT-Next-Web)

The setup is completely identical to Open WebUI:

1. Go to the model provider settings (Model Providers).
2. Select **OpenAI** (or Custom OpenAI).
3. Set the custom **API Endpoint**: `http://localhost:3000/v1` (Note that some clients ask for the URL without `/v1`, for example `http://localhost:3000` — try both options if one doesn't work).
4. Provide any API key.

---

## How does routing work?

When you send a request to `Web2API Gateway`, it decides which provider (Qwen, Kimi, MiniMax, etc.) to route it to based on the **Model Name**.

For example:
- If you send a request with the `deepseek-chat` model, the gateway understands that this is a DeepSeek model and routes it through `deepseek.js`.
- If the model is named `moonshot-v1-8k`, the gateway routes the request to Kimi.
- If you specify a non-standard or unknown model (e.g., `gpt-4o`), the gateway will route the request to the **Default Provider**, which you selected in the CLI menu (Option 9 "Select Active Provider Profile").
