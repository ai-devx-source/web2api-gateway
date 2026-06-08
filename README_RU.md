# 🚀 Web2API Gateway Studio (ApiConnector)

<div align="center">
  <img src="https://img.shields.io/badge/version-v1.9.202-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/Node.js-18%2B-green.svg" alt="Node">
  <img src="https://img.shields.io/badge/Status-Active-success.svg" alt="Status">
</div>

> [🇺🇸 Read in English (English README)](./README.md)

> **Web2API Gateway** — это мощный локальный шлюз, который объединяет несколько веб-чат провайдеров в единый **OpenAI-совместимый API**. 
> Используйте передовые нейросети бесплатно через стандартные клиенты (VS Code, Cursor, OpenWebUI, LobeChat) с помощью ваших существующих браузерных аккаунтов.

⚠️ **Внимание:** Используйте тестовые аккаунты. Проект предоставляется «как есть» (Use at your own risk!).

---

## ✨ Возможности и провайдеры

Сервис поддерживает работу с 8 провайдерами через прямое API, захват браузерных сессий (Cookie) или обход защиты Cloudflare (DOM-проксирование).

| Провайдер | Транспорт | Моделей | Возможности |
|---|---|---|---|
| 🟢 **Qwen** | API | 28 | Чат, Стриминг, Vision, Генерация картинок/видео |
| 🟢 **Z.ai / GLM** | API + Browser | 14 | Чат, Стриминг, Vision, Deep Research |
| 🟢 **DeepSeek** | API + Browser | 2 | Чат, Рассуждения (R1) |
| 🟢 **Kimi (Moonshot)** | Browser | 6 | Чат, Длинный контекст (128k) |
| 🟢 **MiniMax (Hailuo)** | Browser | — | Чат, Стриминг |
| 🟢 **Perplexity AI** | Browser | 8 | Поиск + Чат |
| 🟢 **Xiaomi MIMO** | Browser | — | Чат |
| 🟢 **HuggingFace** | API | — | Открытые модели |

### 📋 Список доступных моделей

<details>
<summary><b>Qwen (28 моделей)</b></summary>

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
<summary><b>Z.ai / GLM (14 моделей)</b></summary>

```
GLM-5.1             GLM-5-Turbo          GLM-5v-Turbo
glm-5               glm-4.7              glm-4.6v
0727-106B-API       0727-360B-API        0808-360B-DR
GLM-4.1V-Thinking-FlashX                deep-research
zero                glm-4-flash          glm-4-air-250414
```
</details>

<details>
<summary><b>DeepSeek (2 модели)</b></summary>

```
deepseek-chat       deepseek-reasoner
```
</details>

<details>
<summary><b>Kimi / Moonshot AI (6 моделей)</b></summary>

```
kimi-k2.6           kimi-k2.5            kimi-k2
moonshot-v1-128k    moonshot-v1-32k      moonshot-v1-8k
```
</details>

<details>
<summary><b>Perplexity AI (8 моделей)</b></summary>

```
Auto                Turbo                PPLX-Pro
Gemini-2.5-Pro      Claude-Sonnet-4      Claude-Opus-4
Nemotron            GPT-5
```
</details>

🎨 **Генерация медиа (Картинки и Видео):** Поддержка генерации изображений (`/v1/images/generations`) и видео (`/v1/videos/generations`) через движок Qwen (Wanx) или DashScope.
🤖 **Агенты и Web UI:** Шлюз работает как drop-in замена OpenAI API. Идеально интегрируется с любыми агентами (LangChain, AutoGPT, Hermes-based) и веб-панелями (Open WebUI, LobeChat, Cursor).


---

## 📦 Установка и запуск

Проект написан на **Node.js** и оптимизирован для локального запуска (Windows/Mac/Linux).

### 1. Скачивание
```bash
git clone https://github.com/ai-devx-source/web2api-gateway.git
cd web2api-gateway
```

### 2. Установка (Первый запуск)
Для автоматической установки всех зависимостей:
- **Windows:** Двойной клик по `web2api-install.bat`
- **Linux/Mac:** Запустите `./web2api-install.sh`

### 3. Запуск шлюза (Интерактивное меню)
Для повседневного использования:
- **Windows:** Двойной клик по `web2api-start.bat`
- **Linux/Mac:** Запустите `./web2api-start.sh`

После запуска откроется **Интерактивный терминал (CLI Dashboard)**:

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

- Управляйте статусами токенов и аккаунтов.
- Выбирайте **Активного Провайдера** по умолчанию.
- Запускайте тесты соединений.

Чтобы запустить шлюз без меню (в фоновом режиме):
```bash
npm run connector:serve
```

---

## 🔌 Использование (OpenAI API)

После запуска сервер будет доступен по адресу:
👉 `http://localhost:3000/v1`

### Пример запроса (cURL)

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dummy-key" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "user", "content": "Расскажи коротко о себе"}
    ],
    "stream": true
  }'
```

Шлюз **автоматически распознает модель** (`deepseek-chat` -> DeepSeek, `moonshot-v1-8k` -> Kimi) и маршрутизирует запрос нужному провайдеру. Если модель не найдена, используется Провайдер по умолчанию.

> 💡 **Важно для Open WebUI:** Если вы используете Open WebUI через Docker, обратите внимание: настройки подключений (API URL и ключи), которые вы хотя бы раз сохранили в Панели Администратора (Admin Panel) в самом веб-интерфейсе, имеют приоритет и навсегда переопределяют переменные окружения Docker (например, `OPENAI_API_BASE_URL`). Если шлюз не подключается — проверьте вкладку Admin Panel -> Settings -> Connections!

---

## 📚 Документация

Вся документация по настройке и использованию перенесена в папку `docs/`:

1. [Быстрый Старт (Quickstart)](./docs/01_QUICKSTART.md)
2. [Настройка Провайдеров (Авторизация)](./docs/02_PROVIDERS_GUIDE.md)
3. [Интеграция с Клиентами (Open WebUI, LobeChat)](./docs/03_CLIENT_INTEGRATION.md)
4. [Генерация Изображений](./docs/04_IMAGE_GENERATION.md)
5. [Решение проблем](./docs/ru/05_TROUBLESHOOTING.md)

## Отказ от ответственности (Disclaimer)
Этот проект разработан исключительно в образовательных и исследовательских целях как технический эксперимент. Программное обеспечение предоставляется «как есть», без каких-либо гарантий работоспособности или стабильности. Проект находится на очень ранней, «сырой» стадии разработки, и его дальнейшее развитие или поддержка совершенно не гарантируются. 

**Важное замечание о стабильности:** Провайдеры нейросетей непрерывно обновляют свои механизмы защиты от автоматизации — зачастую не просто каждый день, а каждый час. Они используют собственные мощные ИИ-модели для круглосуточного (24/7) мониторинга и защиты своих систем. Из-за этого любые неофициальные методы взаимодействия могут перестать работать в любой момент без предупреждения.

Вся ответственность за использование данного программного обеспечения лежит на конечном пользователе. Для создания надежных и стабильных решений настоятельно рекомендуется использовать официальные API провайдеров (как платные, так и бесплатные версии).

---
*Developed by **AI_DEVX***
