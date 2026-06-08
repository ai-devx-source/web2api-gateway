# 04. Image Generation

In addition to text chats, `Web2API Gateway` supports image generation following the OpenAI API standard (`/v1/images/generations`). 
Currently, this feature is implemented through integration with **Alibaba Cloud DashScope**, which allows using powerful models from Qwen and Wan.

## Configuration

To generate images, you will need to obtain an API key from the DashScope platform (Aliyun).

1. Go to the DashScope console and get an API key.
2. In the root folder of the project, open the `.env` file.
3. Add or update the following line:
   ```env
   DASHSCOPE_API_KEY=your-dashscope-api-key-here
   ```
4. Restart the `Web2API Gateway` server.

## Supported Models

Currently, the generation module supports the following models:

- `qwen-image-max`
- `qwen-image-plus` (Used by default if no model is specified)
- `qwen-image`
- `wan2.6-t2i`
- `wan2.5-t2i-preview`
- `wan2.2-t2i-flash`

> [!TIP]
> **Wan** series models use asynchronous generation. The `Web2API Gateway` automatically takes responsibility for polling the task status, so for the client, the process looks like a regular synchronous HTTP request.

## API Usage

You can generate images using standard HTTP requests compatible with the OpenAI SDK:

```bash
curl -X POST http://localhost:3000/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-12345" \
  -d '{
    "model": "qwen-image-plus",
    "prompt": "Futuristic city on Mars with neon lighting, cyberpunk",
    "n": 1,
    "size": "1024x1024"
  }'
```

**Additional (Non-Standard) Parameters**:
Besides the standard OpenAI parameters, you can pass:
- `negativePrompt` (string) — What should NOT be present in the image.
- `promptExtend` (boolean) — Whether to allow AI to automatically expand and improve your prompt (default is `true`).
- `watermark` (boolean) — Whether to add a watermark (default is `false`).

These parameters can be passed in the `options` field if you are working directly, or via `extra_body` in the OpenAI SDK.
