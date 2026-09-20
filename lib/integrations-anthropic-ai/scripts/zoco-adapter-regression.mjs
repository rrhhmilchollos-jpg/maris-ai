import assert from 'node:assert/strict';
import http from 'node:http';
import { anthropic, resolveClaudeModel } from '../src/client.ts';

const requests = [];
const server = http.createServer(async (req, res) => {
  if (req.url !== '/v1/messages' || req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  requests.push({ headers: req.headers, body: JSON.parse(raw) });
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'zoco-plus',
    content: [{ type: 'text', text: 'respuesta de prueba ZocoIA' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 4, output_tokens: 3 },
  }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
process.env.ZOCOIA_API_URL = `http://127.0.0.1:${port}`;
process.env.ZOCOIA_API_KEY = 'sk-zoco-regression-only';

const response = await anthropic.messages.create({
  model: 'zoco-plus',
  max_tokens: 128,
  system: 'Eres un test.',
  messages: [{ role: 'user', content: 'di hola' }],
});

assert.equal(response.content[0].text, 'respuesta de prueba ZocoIA');
assert.equal(requests.length, 1);
assert.equal(requests[0].headers.authorization, 'Bearer sk-zoco-regression-only');
assert.equal(requests[0].body.model, 'zoco-plus');
assert.equal(resolveClaudeModel('zoco-plus'), 'qwen2.5-coder:1.5b');
server.close();
console.log('PASS adaptador ZocoIA: URL, Bearer, alias de modelo y respuesta validados.');
