// Run: node --test src/llm/ai-gateway.test.mjs   (Node 22.6+ strips the .ts types)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  UnifiedAiGateway,
  ROUTES,
  EMBEDDING_ROUTE,
  __resetGatewayCache,
  __gatewayCacheSize,
} from './ai-gateway.ts';

const MESSAGES = [{ role: 'user', content: 'Summarise the release notes.' }];

/** Fake Workers AI binding that records calls and returns scripted outputs. */
function fakeAi(outputs) {
  const calls = [];
  return {
    calls,
    run: async (model, input, options) => {
      calls.push({ model, input, options });
      const out = typeof outputs === 'function' ? outputs(model, calls.length) : outputs[model];
      if (out instanceof Error) throw out;
      if (out === undefined) throw new Error(`no scripted output for ${model}`);
      return out;
    },
  };
}

/** Fake fetch that records calls and replies per host. */
function fakeFetch(handlers) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    const host = new URL(url).host;
    const h = handlers[host];
    if (!h) throw new Error(`unexpected host ${host}`);
    const { status = 200, json } = typeof h === 'function' ? h() : h;
    return new Response(JSON.stringify(json ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}

beforeEach(() => __resetGatewayCache());

test('no configured route returns 503 with a fixed message and no model text', async () => {
  const r = await UnifiedAiGateway.complete({ model: 'starlight-auto', messages: MESSAGES }, {}, { tenantId: 't1' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'no_provider_configured');
  assert.equal(r.body.error.message, 'No model provider is configured for this model.');
  assert.equal(r.body.choices, undefined);
});

test('all routes failing returns 502 and never fabricates output', async () => {
  const AI = fakeAi({ [ROUTES['edge-reason'].defaultModel]: new Error('boom'), [ROUTES['edge-fast'].defaultModel]: new Error('boom') });
  const fetchImpl = fakeFetch({
    'api.anthropic.com': { status: 529, json: { error: { message: 'overloaded sk-ant-secret' } } },
    'api.openai.com': { status: 500, json: { error: { message: 'server' } } },
  });
  const env = { AI, ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' };
  const r = await UnifiedAiGateway.complete({ messages: MESSAGES }, env, { tenantId: 't1', fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.status, 502);
  assert.equal(r.body.error.code, 'all_routes_failed');
  assert.deepEqual(r.body.attempts.map(a => a.route), ['anthropic', 'openai', 'edge-reason', 'edge-fast']);
  assert.deepEqual(r.body.attempts.map(a => a.status), [529, 500, 'error', 'error']);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes('sk-ant-secret'), 'upstream error text is not exposed');
  assert.ok(!/Sovereign Engine|processed:/i.test(text));
  assert.equal(__gatewayCacheSize(), 0, 'errors are never cached');
});

test('failover follows route order and reports the route that answered', async () => {
  const AI = fakeAi({ [ROUTES['edge-reason'].defaultModel]: { response: 'edge answer', usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } } });
  const fetchImpl = fakeFetch({
    'api.anthropic.com': { status: 500 },
    'api.openai.com': { status: 429 },
  });
  const env = { AI, ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' };
  const r = await UnifiedAiGateway.complete({ messages: MESSAGES }, env, { tenantId: 't1', fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.deepEqual(fetchImpl.calls.map(c => new URL(c.url).host), ['api.anthropic.com', 'api.openai.com']);
  assert.equal(r.body.starlight_route, 'edge-reason');
  assert.equal(r.body.model, ROUTES['edge-reason'].defaultModel);
  assert.equal(r.body.choices[0].message.content, 'edge answer');
  assert.deepEqual(r.body.usage, { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 });
  assert.equal(r.body.usage_complete, true);
});

test('edge-code fails over to edge-reason', async () => {
  const AI = fakeAi({
    [ROUTES['edge-code'].defaultModel]: new Error('capacity'),
    [ROUTES['edge-reason'].defaultModel]: { choices: [{ message: { content: 'fn()' }, finish_reason: 'stop' }] },
  });
  const r = await UnifiedAiGateway.complete({ model: 'starlight-edge-code', messages: MESSAGES }, { AI }, { tenantId: 't1' });
  assert.equal(r.status, 200);
  assert.deepEqual(AI.calls.map(c => c.model), [ROUTES['edge-code'].defaultModel, ROUTES['edge-reason'].defaultModel]);
  assert.equal(r.body.starlight_route, 'edge-reason');
});

test('usage is null with usage_complete false when the provider omits it', async () => {
  const AI = fakeAi({ [ROUTES['edge-fast'].defaultModel]: { response: 'hi' } });
  const r = await UnifiedAiGateway.complete({ model: 'starlight-edge-fast', messages: MESSAGES }, { AI }, { tenantId: 't1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.usage, null);
  assert.equal(r.body.usage_complete, false);
});

test('unknown model returns 400 without calling any provider', async () => {
  const AI = fakeAi({});
  const r = await UnifiedAiGateway.complete({ model: 'gpt-made-up', messages: MESSAGES }, { AI }, { tenantId: 't1' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'model_not_found');
  assert.equal(AI.calls.length, 0);
});

test('cache is isolated per tenant and reused within a tenant', async () => {
  let n = 0;
  const AI = fakeAi(() => ({ response: `answer-${++n}` }));
  const req = { model: 'starlight-edge-fast', messages: MESSAGES };
  const a1 = await UnifiedAiGateway.complete(req, { AI }, { tenantId: 'tenant-a' });
  const b1 = await UnifiedAiGateway.complete(req, { AI }, { tenantId: 'tenant-b' });
  const a2 = await UnifiedAiGateway.complete(req, { AI }, { tenantId: 'tenant-a' });
  assert.equal(a1.body.choices[0].message.content, 'answer-1');
  assert.equal(b1.body.choices[0].message.content, 'answer-2', 'tenant B does not receive tenant A answer');
  assert.equal(b1.body.cached, false);
  assert.equal(a2.body.choices[0].message.content, 'answer-1');
  assert.equal(a2.body.cached, true);
  assert.equal(AI.calls.length, 2);
});

test('long prompts sharing a prefix and length do not collide', async () => {
  let n = 0;
  const AI = fakeAi(() => ({ response: `answer-${++n}` }));
  const prefix = 'x'.repeat(200);
  const r1 = await UnifiedAiGateway.complete({ model: 'starlight-edge-fast', messages: [{ role: 'user', content: `${prefix}A` }] }, { AI }, { tenantId: 't1' });
  const r2 = await UnifiedAiGateway.complete({ model: 'starlight-edge-fast', messages: [{ role: 'user', content: `${prefix}B` }] }, { AI }, { tenantId: 't1' });
  assert.notEqual(r1.body.choices[0].message.content, r2.body.choices[0].message.content);
  assert.equal(r2.body.cached, false);
});

test('requests with caller-supplied provider keys are never cached', async () => {
  let n = 0;
  const fetchImpl = fakeFetch({
    'api.anthropic.com': () => ({ json: { id: `msg_${++n}`, model: 'claude-sonnet-5-5', content: [{ type: 'text', text: `byok-${n}` }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } } }),
  });
  const headers = new Headers({ 'X-Anthropic-Key': 'caller-key' });
  const req = { model: 'starlight-anthropic', messages: MESSAGES };
  const r1 = await UnifiedAiGateway.complete(req, {}, { tenantId: 't1', headers, fetchImpl });
  const r2 = await UnifiedAiGateway.complete(req, {}, { tenantId: 't1', headers, fetchImpl });
  assert.equal(r1.body.choices[0].message.content, 'byok-1');
  assert.equal(r2.body.choices[0].message.content, 'byok-2');
  assert.equal(r2.body.cached, false);
  assert.equal(__gatewayCacheSize(), 0);
  assert.equal(fetchImpl.calls[0].init.headers['x-api-key'], 'caller-key');
  assert.deepEqual(r1.body.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
});

test('cache is bounded by STARLIGHT_CHAT_CACHE_MAX', async () => {
  const AI = fakeAi(() => ({ response: 'ok' }));
  const env = { AI, STARLIGHT_CHAT_CACHE_MAX: '3' };
  for (let i = 0; i < 6; i++) {
    await UnifiedAiGateway.complete({ model: 'starlight-edge-fast', messages: [{ role: 'user', content: `q${i}` }] }, env, { tenantId: 't1' });
  }
  assert.equal(__gatewayCacheSize(), 3);
});

test('Workers AI calls pass the AI Gateway option when AI_GATEWAY_ID is set', async () => {
  const AI = fakeAi(() => ({ response: 'ok' }));
  await UnifiedAiGateway.complete({ model: 'starlight-edge-fast', messages: MESSAGES }, { AI, AI_GATEWAY_ID: 'starlight-gw' }, {});
  assert.deepEqual(AI.calls[0].options, { gateway: { id: 'starlight-gw' } });
  await UnifiedAiGateway.complete({ model: 'starlight-edge-fast', messages: MESSAGES }, { AI }, {});
  assert.equal(AI.calls[1].options, undefined);
});

test('model ids come from env overrides and OpenAI uses max_completion_tokens', async () => {
  const fetchImpl = fakeFetch({
    'api.openai.com': { json: { id: 'chatcmpl-1', model: 'gpt-custom', choices: [{ message: { role: 'assistant', content: 'yo' }, finish_reason: 'stop' }] } },
  });
  const env = { OPENAI_API_KEY: 'o', STARLIGHT_OPENAI_MODEL: 'gpt-custom' };
  const r = await UnifiedAiGateway.complete({ model: 'starlight-openai', messages: MESSAGES, max_tokens: 64 }, env, { tenantId: 't1', fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(fetchImpl.calls[0].body.model, 'gpt-custom');
  assert.equal(fetchImpl.calls[0].body.max_completion_tokens, 64);
  assert.equal(fetchImpl.calls[0].body.max_tokens, undefined);
  assert.equal(r.body.usage, null);
  assert.equal(r.body.usage_complete, false);
});

test('external providers go through AI Gateway when CF_ACCOUNT_ID and AI_GATEWAY_ID are set', async () => {
  const fetchImpl = fakeFetch({
    'gateway.ai.cloudflare.com': { json: { id: 'msg_1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 1 } } },
  });
  const env = { ANTHROPIC_API_KEY: 'a', AI_GATEWAY_ID: 'gw', CF_ACCOUNT_ID: 'acct' };
  const r = await UnifiedAiGateway.complete({ model: 'starlight-anthropic', messages: MESSAGES }, env, { tenantId: 't1', fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(fetchImpl.calls[0].url, 'https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/v1/messages');
});

test('streaming requests and malformed messages are rejected with 400', async () => {
  const AI = fakeAi(() => ({ response: 'ok' }));
  const s = await UnifiedAiGateway.complete({ model: 'starlight-edge-fast', messages: MESSAGES, stream: true }, { AI }, {});
  assert.equal(s.status, 400);
  assert.equal(s.body.error.code, 'stream_unsupported');
  const m = await UnifiedAiGateway.complete({ model: 'starlight-edge-fast', messages: [] }, { AI }, {});
  assert.equal(m.status, 400);
  assert.equal(AI.calls.length, 0);
});

test('embedding model matches the 768-dimension Vectorize index', () => {
  assert.equal(EMBEDDING_ROUTE.defaultModel, '@cf/baai/bge-base-en-v1.5');
  assert.equal(EMBEDDING_ROUTE.dimensions, 768);
});
