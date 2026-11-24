import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_VIEWPORTS,
  parseViewports,
  validateTargetUrl,
  evaluateAuditFindings,
  buildCriticReceipt,
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

test('validateTargetUrl fails closed on missing or non-http(s) URLs', () => {
  assert.throws(() => validateTargetUrl(''), /TARGET_URL is required/);
  assert.throws(() => validateTargetUrl('ftp://example.com'), /Unsupported TARGET_URL protocol/);
  assert.throws(() => validateTargetUrl('not-a-url'), /Invalid TARGET_URL/);
  assert.equal(validateTargetUrl('https://starlightintelligence.ai'), 'https://starlightintelligence.ai/');
});

test('evaluateAuditFindings passes clean viewport metrics and catches layout/accessibility errors', () => {
  const clean = evaluateAuditFindings([
    {
      label: 'mobile-375',
      httpStatus: 200,
      pageErrors: [],
      horizontalOverflowPx: 0,
      hasMainLandmark: true,
      hasH1: true,
      imagesMissingAlt: 0,
      focusableCount: 4,
    },
  ]);
  assert.equal(clean.passed, true);
  assert.equal(clean.errorCount, 0);
  assert.equal(clean.warningCount, 0);

  const broken = evaluateAuditFindings([
    {
      label: 'mobile-375',
      httpStatus: 500,
      pageErrors: ['TypeError: x'],
      horizontalOverflowPx: 42,
      hasMainLandmark: false,
      hasH1: false,
      imagesMissingAlt: 2,
      focusableCount: 0,
    },
  ]);
  assert.equal(broken.passed, false);
  assert.equal(broken.errorCount, 4);
  assert.equal(broken.warningCount, 3);
});

test('buildCriticReceipt produces SIP-1.1.1 receipt and signPayload generates sha256 HMAC', () => {
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
        httpStatus: 200,
        pageErrors: [],
        horizontalOverflowPx: 0,
        hasMainLandmark: true,
        hasH1: true,
        imagesMissingAlt: 0,
        focusableCount: 5,
      },
    ],
    screenshotPaths: ['/tmp/web-critic-artifacts/desktop-1440-reduced-motion.png'],
    duration: 4,
    timestamp: '2026-11-24T18:00:00.000Z',
  });

  assert.equal(receipt.protocol, 'SIP-1.1.1');
  assert.equal(receipt.agent, 'starlight-web-design-critic');
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.viewports[0].reducedMotion, true);

  const sig = signPayload(JSON.stringify(receipt), 'test-secret');
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
});
