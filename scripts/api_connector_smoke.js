const BASE_URL = process.env.API_CONNECTOR_BASE_URL || 'http://127.0.0.1:3264/api';
const MODEL = process.env.API_CONNECTOR_SMOKE_MODEL || 'qwen3.7-max';
const API_KEY = process.env.API_CONNECTOR_API_KEY;

async function requestJson(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path}: HTTP error ${response.status} ${text.slice(0, 500)}`);
  }

  return data;
}

async function main() {
  const status = await requestJson('/status');
  const models = await requestJson('/models');
  const modelIds = models.data.map(model => model.id);

  console.log(`Accounts in status: ${status.accounts?.length ?? 0}`);
  console.log(`Models: ${modelIds.length}`);

  if (!modelIds.includes(MODEL)) {
    throw new Error(`Smoke model ${MODEL} is missing in /models`);
  }

  const completion = await requestJson('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [
        { role: 'user', content: 'Answer with exactly one word: working' }
      ]
    })
  });

  const answer = completion.choices?.[0]?.message?.content || '';
  console.log(`${MODEL}: ${answer}`);
  console.log('Smoke test OK');
}

main().catch(error => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exit(1);
});
