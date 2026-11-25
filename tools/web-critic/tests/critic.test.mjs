import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_VIEWPORTS,
  parseViewports,
  validateTargetUrl,
  assertSafeDestination,
  isBlockedIpAddress,
  evaluateAuditFindings,
  buildCriticReceipt,
  deliverSignedReceipt,
  signPayload,
} from '../src/critic.mjs';

test('parseViewports defaults to 375, 768, 1440 and parses custom specs', () => {
  const defaults = parseViewports();
  assert.deepEqual(
    defaults.map((v) => v.width),
    [375, 768, 1440]
  );
  assert.equal(DEFAULT_VIEWPORTS.length, 3);

  const custom = parseViewports('390x844, 1280x720');
  assert.deepEqual(custom, [
    { name: 'vp-390x844', width: 390, height: 844 },
    { name: 'vp-1280x720', width: 1280, height: 720 },
  ]);

  assert.throws(() => parseViewports('wide'), /Invalid viewport/);
});

test('validateTargetUrl fails closed on SSRF hosts, metadata IPs, embedded credentials, and non-HTTPS', () => {
  assert.throws(() => validateTargetUrl(''), /TARGET_URL is required/);
  assert.throws(() => validateTargetUrl('ftp://example.com'), /Unsupported TARGET_URL protocol/);
  assert.throws(() => validateTargetUrl('http://starlightintelligence.ai'), /Unsupported TARGET_URL protocol/);
  assert.throws(() => validateTargetUrl('https://user:pass@starlightintelligence.ai'), /embedded credentials/);
  assert.throws(() => validateTargetUrl('https://169.254.169.254/latest/meta-data/'), /Blocked TARGET_URL host/);
  assert.throws(() => validateTargetUrl('https://metadata.google.internal/'), /Blocked TARGET_URL host/);
  assert.throws(() => validateTargetUrl('https://127.0.0.1/'), /Blocked TARGET_URL host/);
  assert.throws(() => validateTargetUrl('https://10.0.0.5/'), /Blocked TARGET_URL host/);
  assert.throws(() => validateTargetUrl('https://localhost:3000/'), /Blocked TARGET_URL host/);

  assert.equal(validateTargetUrl('https://starlightintelligence.ai'), 'https://starlightintelligence.ai/');
  assert.equal(
    validateTargetUrl('http://127.0.0.1:3199/brand', { allowLocalhost: true }),
    'http://127.0.0.1:3199/brand'
  );
});

test('assertSafeDestination blocks DNS rebinding to private or metadata IP addresses', async () => {
  assert.equal(isBlockedIpAddress('169.254.169.254'), true);
  assert.equal(isBlockedIpAddress('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedIpAddress('93.184.216.34'), false);

  await assert.rejects(
    () =>
      assertSafeDestination('https://rebind.example.invalid/', {
        lookup: async () => [{ address: '169.254.169.254', family: 4 }],
      }),
    /Blocked TARGET_URL resolved IP/
  );

  const ok = await assertSafeDestination('https://starlightintelligence.ai/', {
    lookup: async () => [{ address: '76.76.21.21', family: 4 }],
  });
  assert.equal(ok, 'https://starlightintelligence.ai/');
});

test('evaluateAuditFindings catches console errors, failed subresources, reduced-motion mismatch, and layout issues', () => {
  const clean = evaluateAuditFindings([
    {
      label: 'mobile-375',
      httpStatus: 200,
      pageErrors: [],
      consoleErrors: [],
      failedResponses: [],
      failedRequests: [],
      horizontalOverflowPx: 0,
      hasMainLandmark: true,
      hasH1: true,
      imagesMissingAlt: 0,
      focusableCount: 4,
      reducedMotion: false,
      reducedMotionMatched: false,
    },
  ]);
  assert.equal(clean.passed, true);
  assert.equal(clean.errorCount, 0);
  assert.equal(clean.warningCount, 0);

  const broken = evaluateAuditFindings([
    {
      label: 'desktop-1440-reduced-motion',
      httpStatus: 200,
      pageErrors: ['TypeError: x'],
      consoleErrors: ['Failed to load font'],
      failedResponses: [{ url: 'https://starlightintelligence.ai/missing.css', status: 404 }],
      failedRequests: [],
      horizontalOverflowPx: 42,
      hasMainLandmark: false,
      hasH1: false,
      imagesMissingAlt: 2,
      focusableCount: 0,
      reducedMotion: true,
      reducedMotionMatched: false,
    },
  ]);
  assert.equal(broken.passed, false);
  assert.equal(broken.errorCount, 6);
  assert.equal(broken.warningCount, 3);
});

test('deliverSignedReceipt fails closed when STARLIGHT_RUNNER_SECRET is missing or delivery fails', async () => {
  await assert.rejects(
    () =>
      deliverSignedReceipt('{"status":"pass"}', {
        STARLIGHT_CALLBACK_URL: 'https://ingress.example.invalid/v1/runner/callback',
      }),
    /STARLIGHT_RUNNER_SECRET is required/
  );

  await assert.rejects(
    () =>
      deliverSignedReceipt(
        '{"status":"pass"}',
        {
          STARLIGHT_CALLBACK_URL: 'http://127.0.0.1:8787/v1/runner/callback',
          STARLIGHT_RUNNER_SECRET: 'fixture-secret',
          STARLIGHT_ALLOW_LOCALHOST: 'true',
        },
        async () => new Response('nope', { status: 401 })
      ),
    /Callback delivery failed with HTTP 401/
  );
});

test('buildCriticReceipt includes screenshot SHA-256 hashes and signPayload generates sha256 HMAC', () => {
  const receipt = buildCriticReceipt({
    url: 'https://starlightintelligence.ai/',
    repo: 'Starlight-Intelligence/starlightintelligence.ai',
    ref: 'agent/antigravity/liquid-glass-brand-identity',
    observations: [
      {
        label: 'desktop-1440-reduced-motion',
        width: 1440,
        height: 900,
        reducedMotion: true,
        reducedMotionMatched: true,
        httpStatus: 200,
        pageErrors: [],
        consoleErrors: [],
        failedResponses: [],
        failedRequests: [],
        horizontalOverflowPx: 0,
        hasMainLandmark: true,
        hasH1: true,
        imagesMissingAlt: 0,
        focusableCount: 5,
      },
    ],
    screenshots: [
      {
        label: 'desktop-1440-reduced-motion',
        path: '/tmp/web-critic-artifacts/desktop-1440-reduced-motion.png',
        bytes: 12345,
        sha256: 'a'.repeat(64),
      },
    ],
    duration: 4,
    timestamp: '2026-11-24T18:00:00.000Z',
  });

  assert.equal(receipt.protocol, 'SIP-1.1.1');
  assert.equal(receipt.agent, 'starlight-web-design-critic');
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.viewports[0].reducedMotion, true);
  assert.equal(receipt.viewports[0].reducedMotionMatched, true);
  assert.equal(receipt.screenshots[0].sha256, 'a'.repeat(64));

  const sig = signPayload(JSON.stringify(receipt), 'test-secret');
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
});
