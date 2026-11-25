import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearGcpTokenCache,
  handleRequest,
  mintGcpAccessToken,
  verifySignature,
} from '../src/index.ts';
import { createHmac, generateKeyPairSync } from 'node:crypto';

const secret = 'synthetic-fixture-secret';
const credentials = {
  GITHUB_WEBHOOK_SECRET: secret,
  GCP_PROJECT_ID: 'fixture-project',
  GCP_REGION: 'europe-west4',
  CLOUD_RUN_JOB: 'fixture-job',
  GCP_SERVICE_ACCOUNT_TOKEN: 'synthetic-fixture-token',
};
const push = { ref: 'refs/heads/main', after: 'a'.repeat(40), repository: { full_name: 'fixture/example' } };

function signedRequest(payload = push, path = '/webhook') {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request('https://local.invalid' + path, {
    method: 'POST',
    headers: {
      'x-github-event': 'push',
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
    },
    body,
  });
}

test('webhook refuses unsigned traffic when no verification secret is configured', async () => {
  const response = await handleRequest(new Request('https://local.invalid/webhook', {
    method: 'POST',
    headers: { 'x-github-event': 'ping' },
    body: '{}',
  }), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'webhook_unavailable' });
});

test('malformed HMAC never reaches Web Crypto as a partial signature', async () => {
  for (const signature of ['sha256=', 'sha256=00', 'sha256=' + 'g'.repeat(64), 'sha256=' + 'a'.repeat(63)]) {
    assert.equal(await verifySignature('{}', signature, 'fixture-secret'), false);
  }
});

test('blank verification secret fails closed without calling the executor', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('executor must not run'); });
  const response = await handleRequest(signedRequest(), { ...credentials, GITHUB_WEBHOOK_SECRET: '  ' });
  assert.equal(response.status, 503);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('missing or incorrect signature is rejected before dispatch', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('executor must not run'); });
  for (const signature of [null, 'sha256=' + '0'.repeat(64)]) {
    const request = signedRequest();
    if (signature) request.headers.set('x-hub-signature-256', signature);
    else request.headers.delete('x-hub-signature-256');
    const response = await handleRequest(request, credentials);
    assert.equal(response.status, 401);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('both webhook aliases refuse an unconfigured executor', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('executor must not run'); });
  for (const path of ['/webhook', '/v1/github/events']) {
    const response = await handleRequest(signedRequest(push, path), { GITHUB_WEBHOOK_SECRET: secret });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'runner_unavailable' });
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('a missing or blank dispatch binding never returns a queued receipt', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('executor must not run'); });
  for (const key of ['GCP_PROJECT_ID', 'GCP_REGION', 'CLOUD_RUN_JOB', 'GCP_SERVICE_ACCOUNT_TOKEN']) {
    for (const value of [undefined, '  ']) {
      const response = await handleRequest(signedRequest(), { ...credentials, [key]: value });
      assert.equal(response.status, 503);
    }
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('signed malformed or non-object JSON returns 400', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('executor must not run'); });
  for (const payload of ['{', 'null', '[]', '1', '"text"']) {
    const response = await handleRequest(signedRequest(payload), credentials);
    assert.equal(response.status, 400);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('upstream denial or outage returns a sanitized 502', async (t) => {
  for (const status of [401, 403, 500]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('private upstream diagnostic', { status }));
    const response = await handleRequest(signedRequest(), credentials);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'runner_dispatch_failed' });
    t.mock.restoreAll();
  }
});

test('network failure returns a sanitized 502', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private upstream diagnostic'); });
  const response = await handleRequest(signedRequest(), credentials);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'runner_dispatch_failed' });
});

test('202 requires a successful executor response and preserves the source binding', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{"name":"fixture-operation"}', { status: 200 }));
  const response = await handleRequest(signedRequest(), credentials);
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.gcp.dispatched, true);
  assert.equal(result.gcp.queued, undefined);
  assert.equal(fetchMock.mock.callCount(), 1);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, 'https://run.googleapis.com/v2/projects/fixture-project/locations/europe-west4/jobs/fixture-job:run');
  const env = JSON.parse(options.body).overrides.containerOverrides[0].env;
  assert.equal(env.find((item) => item.name === 'COMMIT_SHA').value, push.after);
  assert.equal(env.find((item) => item.name === 'STARLIGHT_REPO').value, 'fixture/example');
  assert.equal(env.find((item) => item.name === 'STARLIGHT_REF').value, 'main');
});

function signedCallbackRequest(payload, runnerSecret = secret) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request('https://local.invalid/v1/runner/callback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-starlight-signature': 'sha256=' + createHmac('sha256', runnerSecret).update(body).digest('hex'),
    },
    body,
  });
}

test('runner callback fails closed when STARLIGHT_RUNNER_SECRET is missing or blank', async () => {
  for (const runnerSecret of [undefined, '  ']) {
    const response = await handleRequest(
      signedCallbackRequest({ repo: 'fixture/example', ref: 'main', status: 'pass', exitCode: 0 }),
      { STARLIGHT_RUNNER_SECRET: runnerSecret }
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'callback_unavailable' });
  }
});

test('runner callback rejects missing or invalid HMAC signature', async () => {
  const validReceipt = { repo: 'fixture/example', ref: 'main', status: 'pass', exitCode: 0 };
  const badSigReq = signedCallbackRequest(validReceipt, 'wrong-secret');
  const badRes = await handleRequest(badSigReq, { STARLIGHT_RUNNER_SECRET: secret });
  assert.equal(badRes.status, 401);
  assert.deepEqual(await badRes.json(), { error: 'invalid_signature' });

  const noSigReq = new Request('https://local.invalid/v1/runner/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validReceipt),
  });
  const noSigRes = await handleRequest(noSigReq, { STARLIGHT_RUNNER_SECRET: secret });
  assert.equal(noSigRes.status, 401);
});

test('runner callback rejects malformed JSON and invalid receipt fields', async () => {
  for (const badBody of ['{', '[]', 'null']) {
    const res = await handleRequest(signedCallbackRequest(badBody), { STARLIGHT_RUNNER_SECRET: secret });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'malformed_json' });
  }

  for (const badReceipt of [
    { ref: 'main', status: 'pass', exitCode: 0 },
    { repo: 'fixture/example', ref: 'main', status: 'unknown', exitCode: 0 },
    { repo: 'fixture/example', ref: 'main', status: 'pass', exitCode: '0' },
  ]) {
    const res = await handleRequest(signedCallbackRequest(badReceipt), { STARLIGHT_RUNNER_SECRET: secret });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_receipt' });
  }
});

test('runner callback accepts valid signed receipt and queues to STARLIGHT_AGENT_JOBS', async () => {
  const queued = [];
  const receiptPayload = {
    repo: 'fixture/example',
    ref: 'main',
    status: 'pass',
    duration: 12,
    installDuration: 4,
    exitCode: 0,
    timestamp: '2026-11-24T15:00:00Z',
  };

  const res = await handleRequest(signedCallbackRequest(receiptPayload), {
    STARLIGHT_RUNNER_SECRET: secret,
    STARLIGHT_AGENT_JOBS: {
      async send(msg) {
        queued.push(msg);
      },
    },
  });

  assert.equal(res.status, 202);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.received, true);
  assert.equal(json.protocol, 'SIP-1.1.1');
  assert.equal(json.receipt.repo, 'fixture/example');
  assert.equal(json.receipt.status, 'pass');
  assert.equal(json.receipt.exitCode, 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].job, 'runner-receipt');
  assert.equal(queued[0].receipt.repo, 'fixture/example');
});

function createEphemeralSaJson(overrides = {}) {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return JSON.stringify({
    client_email: 'runner-test@fixture-project.iam.gserviceaccount.com',
    private_key: privateKey,
    private_key_id: 'ephemeral-kid-' + Math.random().toString(36).slice(2, 8),
    token_uri: 'https://oauth2.googleapis.com/token',
    ...overrides,
  });
}

test('mintGcpAccessToken signs RS256 JWT assertion, exchanges for OAuth2 token, and caches result', async () => {
  clearGcpTokenCache();
  const saJson = createEphemeralSaJson();
  let calls = 0;
  let capturedGrantType = '';
  let capturedAssertion = '';

  const mockFetch = async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const params = new URLSearchParams(init.body);
    capturedGrantType = params.get('grant_type') || '';
    capturedAssertion = params.get('assertion') || '';
    return new Response(JSON.stringify({ access_token: 'short-lived-gcp-token', expires_in: 3600 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const now = 1_700_000_000_000;
  const token1 = await mintGcpAccessToken(saJson, mockFetch, now);
  const token2 = await mintGcpAccessToken(saJson, mockFetch, now + 30_000);

  assert.equal(token1, 'short-lived-gcp-token');
  assert.equal(token2, 'short-lived-gcp-token');
  assert.equal(calls, 1);
  assert.equal(capturedGrantType, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(capturedAssertion.split('.').length, 3);
  const claims = JSON.parse(Buffer.from(capturedAssertion.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.iss, 'runner-test@fixture-project.iam.gserviceaccount.com');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/cloud-platform');

  // Near expiry (<60s remaining), cache refreshes cleanly
  const token3 = await mintGcpAccessToken(saJson, async () => {
    calls += 1;
    return new Response(JSON.stringify({ access_token: 'refreshed-gcp-token', expires_in: 3600 }), { status: 200 });
  }, now + 3_550_000);
  assert.equal(token3, 'refreshed-gcp-token');
  assert.equal(calls, 2);
});

test('webhook dispatches via GCP_SERVICE_ACCOUNT_JSON when GCP_SERVICE_ACCOUNT_TOKEN is unset', async (t) => {
  clearGcpTokenCache();
  const saJson = createEphemeralSaJson();
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'minted-sa-bearer', expires_in: 3600 }), { status: 200 });
    }
    assert.equal(url, 'https://run.googleapis.com/v2/projects/fixture-project/locations/europe-west4/jobs/fixture-job:run');
    assert.equal(init.headers.Authorization, 'Bearer minted-sa-bearer');
    return new Response('{"name":"op-sa-json"}', { status: 200 });
  });

  const envWithSaJson = {
    GITHUB_WEBHOOK_SECRET: secret,
    GCP_PROJECT_ID: 'fixture-project',
    GCP_REGION: 'europe-west4',
    CLOUD_RUN_JOB: 'fixture-job',
    GCP_SERVICE_ACCOUNT_JSON: saJson,
  };
  const response = await handleRequest(signedRequest(), envWithSaJson);
  assert.equal(response.status, 202);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('malformed GCP_SERVICE_ACCOUNT_JSON or failed token exchange fails closed without secret leakage', async (t) => {
  clearGcpTokenCache();
  const badRes = await handleRequest(signedRequest(), {
    GITHUB_WEBHOOK_SECRET: secret,
    GCP_PROJECT_ID: 'fixture-project',
    GCP_REGION: 'europe-west4',
    CLOUD_RUN_JOB: 'fixture-job',
    GCP_SERVICE_ACCOUNT_JSON: '{not-valid-json',
  });
  assert.equal(badRes.status, 502);
  assert.deepEqual(await badRes.json(), { error: 'runner_dispatch_failed' });

  t.mock.method(globalThis, 'fetch', async () => new Response('sensitive internal oauth error', { status: 400 }));
  const failedExchange = await handleRequest(signedRequest(), {
    GITHUB_WEBHOOK_SECRET: secret,
    GCP_PROJECT_ID: 'fixture-project',
    GCP_REGION: 'europe-west4',
    CLOUD_RUN_JOB: 'fixture-job',
    GCP_SERVICE_ACCOUNT_JSON: createEphemeralSaJson(),
  });
  assert.equal(failedExchange.status, 502);
  assert.deepEqual(await failedExchange.json(), { error: 'runner_dispatch_failed' });
});
