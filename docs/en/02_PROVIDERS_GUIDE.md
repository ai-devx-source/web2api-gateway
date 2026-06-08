# 02. Providers Configuration (Providers Guide)

In order for the gateway to send requests to a specific neural network, you need to add tokens (cookies or headers) from your accounts on the corresponding websites.

`Web2API Gateway` features built-in interactive CLI scripts for quick and secure token addition.

---

## 1. DeepSeek

DeepSeek supports both API tokens (Bearer) and manual interception of browser sessions (due to Cloudflare protection).

**Command:**
```bash
npm run deepseek:auth
```

**How to get tokens:**
The script will open a visible browser window. You need to log in at [chat.deepseek.com](https://chat.deepseek.com/). After passing the captcha and logging into your account, return to the terminal and press `Enter`. The script will automatically intercept all necessary headers and cookies.

---

## 2. Kimi (Moonshot)

Kimi works by bypassing Cloudflare protection (DOM-Proxy mode) or via direct API if valid tokens are present.

**Command:**
```bash
npm run kimi:auth
```

**How to get tokens:**
Like with DeepSeek, the script will launch a browser. Log in at [kimi.moonshot.cn](https://kimi.moonshot.cn/), send one test message in the chat, and press `Enter` in the console.

---

## 3. MiniMax

MiniMax (Hailuo AI) works on a similar principle, intercepting headers from the official web application.

**Command:**
```bash
npm run minimax:auth
```

**How to get tokens:**
Log in through the opened browser window at [hailuoai.video](https://hailuoai.video) or the corresponding MiniMax chat. Send a request, return to the console, and press `Enter`.

---

## 4. Qwen (Tongyi Qianwen)

**Command:**
(Built into the main process, controlled via the main menu `npm start` -> Option 1 -> `qwen`)

**How to get tokens:**
Qwen supports guest mode (free without an account) and authorized mode. Currently, additional authorization scripts for Qwen are not required if it runs in Guest mode.

---

## 5. Z.ai / GLM

**Command:**
```bash
npm run zai:auth
```

The script will open a browser to intercept the signature and session cookie for Z.ai.

---

## 6. Perplexity AI

Perplexity requires manual copying of the session Cookie file due to the complex Cloudflare Turnstile protection system.

**Command:**
```bash
npm run perplexity:auth
```

**How to get tokens:**
1. Go to [www.perplexity.ai](https://www.perplexity.ai) in your regular browser and log in.
2. Press `F12` (Developer Tools) -> `Application` (or `Storage`) tab -> `Cookies`.
3. Find the cookie named `__Secure-next-auth.session-token` and copy its value.
4. Paste this value into the running terminal script.

---

## 7. Xiaomi MIMO

MIMO requires copying three different cookie parameters.

**Command:**
```bash
npm run mimo:auth
```

**How to get tokens:**
1. Go to [aistudio.xiaomimimo.com](https://aistudio.xiaomimimo.com) and log in.
2. In the developer console (`F12`), copy the values of the following Cookies:
   - `serviceToken`
   - `userId`
   - `xiaomichatbot_ph`
3. Paste them one by one into the terminal.

---

## 8. HuggingFace

Allows using free HuggingFace Chat models (e.g., Llama 3, Mistral, Command R+).

**Command:**
```bash
npm run hf:auth
```

**How to get tokens:**
1. Log in at [huggingface.co/chat](https://huggingface.co/chat).
2. Copy the `hf-chat` Cookie from the developer console.
3. Paste the value into the terminal script.
