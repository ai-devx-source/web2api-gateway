# 05. Troubleshooting

This document contains the most frequent problems that may arise when using `Web2API Gateway` and their solutions.

## 1. How to check if a provider is working?

The easiest way to check the functionality of any provider is to use the built-in testing utility.

1. Start the gateway: `npm start`
2. In the menu that appears, select **Test API connection** (usually option 3 within the specific provider's settings menu).
3. The gateway will send a test request (for example: *"Hello, this is an automated diagnostic test..."*) and output the result to the console.
4. You can also see the statuses (OK / Fail) of all providers in the main menu.

---

## 2. Model not found in the list (Open WebUI / LobeChat)

If you have connected the gateway to a client, but the list of available models is empty:

- **Problem**: You have not authorized any providers. The gateway sends the client the list of models only from those providers that have successfully passed the check and have valid tokens.
- **Solution**: Run `npm run <provider>:auth` (for example, `npm run qwen:auth` or `npm run perplexity:auth`) and ensure that the provider test shows an **OK** status in the gateway's main menu. Then click the "Refresh model list" button in the client's settings.

---

## 3. "fetch failed" error when accessing providers

- **Symptoms**: When trying to send a request (for example, to DeepSeek), the gateway throws a `fetch failed` error or times out.
- **Cause**: Usually, this is related to blocking by Cloudflare (especially with DeepSeek, Perplexity, Kimi). The protection sees that the request is not coming from a real browser and drops the connection at the network level.
- **Solution**: 
  - Refresh the session token (cookie) using the authorization scripts (see `02_PROVIDERS_GUIDE.md`).
  - Make sure that the `User-Agent` and `Sec-Ch-Ua` headers used by the gateway (in the source code) match modern versions of Chrome. The gateway tries to spoof them automatically.
  - If the problem persists, try switching the provider to DOM-proxying mode (via Advanced Options -> Toggle Provider Transport Mode in the menu).

---

## 4. Authorization script cannot launch the browser

- **Symptoms**: When running `npm run kimi:auth` or `npm run deepseek:auth`, a Puppeteer error occurs (browser not found or `libnss3.so` is missing).
- **Solution (on Linux / WSL / Docker)**: You may be missing system libraries to run Chrome. Install them with the command:
  ```bash
  sudo apt-get install -y libxss1 libappindicator1 libindicator7 xvfb libasound2 libgbm1 libnspr4 libnss3
  ```
- **Alternative**: Use providers that only require simple Cookie copying from your main browser (Perplexity, MIMO, HuggingFace), as they do not require launching Puppeteer.

---

## 5. 401 Unauthorized / 403 Forbidden errors

- **Cause**: Session token has expired.
- **Solution**: Re-run the authorization procedure via `npm run <provider>:auth`.

---

## 6. How to enable debugging?

If you want to see more detailed logs or see what happens in the hidden browser when sending requests (in DOM Proxy mode):

1. Start the gateway: `npm start`.
2. Select **Advanced Options**.
3. Select **Toggle Visible Browser (Debug Mode)**. 
   Now when executing requests that use the browser, you will see the browser window itself.
