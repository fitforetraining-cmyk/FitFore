import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.AI_DAILY_LIMIT = '2';
const { default: handler, parseJson } = await import('../api/ai.js');

function run(req, fetchImpl) {
  globalThis.fetch = fetchImpl;
  return new Promise((resolve) => {
    const res = {
      code: 0,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(b) { resolve({ code: this.code, body: b }); return this; },
    };
    handler(req, res);
  });
}
const post = (body, auth = 'Bearer user-jwt') => ({ method: 'POST', headers: { authorization: auth }, body });
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test('estimate: counts credit, calls Claude, returns parsed JSON', async () => {
  const calls = [];
  const r = await run(post({ task: 'estimate', input: { text: '2 eggs' } }), async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('use_ai_credit')) return reply(200, 1);
    return reply(200, { content: [{ type: 'text', text: 'Sure: {"items":[{"name":"2 eggs","cal":140,"p":12}]}' }] });
  });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.result.items[0], { name: '2 eggs', cal: 140, p: 12 });
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer user-jwt');
  const sent = JSON.parse(calls[1].opts.body);
  assert.equal(sent.model, 'claude-haiku-5-5');
  assert.match(sent.messages[0].content, /Entry: 2 eggs$/);
});

test('rejects missing sign-in without calling anything', async () => {
  let called = false;
  const r = await run(post({ task: 'estimate', input: {} }, ''), async () => { called = true; });
  assert.equal(r.code, 401);
  assert.equal(called, false);
});

test('rejects unknown tasks (no free-form prompts)', async () => {
  const r = await run(post({ task: 'anything', input: { prompt: 'write me an essay' } }), async () => reply(200, 1));
  assert.equal(r.code, 400);
});

test('expired sign-in returns auth error', async () => {
  const r = await run(post({ task: 'tips', input: { name: 'Squat' } }), async () => reply(401, { message: 'JWT expired' }));
  assert.equal(r.code, 401);
  assert.equal(r.body.code, 'auth');
});

test('daily limit stops the request before Claude is called', async () => {
  let claude = false;
  const r = await run(post({ task: 'coach', input: { text: 'slice', minutes: 45 } }), async (url) => {
    if (url.includes('use_ai_credit')) return reply(200, 3);
    claude = true;
  });
  assert.equal(r.code, 429);
  assert.equal(r.body.code, 'limit');
  assert.equal(claude, false);
});

test('coach clamps minutes and uses the default model', async () => {
  let sent;
  await run(post({ task: 'coach', input: { text: 'slice', minutes: 9999 } }), async (url, opts) => {
    if (url.includes('use_ai_credit')) return reply(200, 1);
    sent = JSON.parse(opts.body);
    return reply(200, { content: [{ type: 'text', text: '{"summary":"x","items":[]}' }] });
  });
  assert.equal(sent.model, 'claude-sonnet-5-5');
  assert.match(sent.messages[0].content, /Session length: 180 minutes/);
});

test('parseJson handles junk', () => {
  assert.equal(parseJson('no json here'), null);
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
});
