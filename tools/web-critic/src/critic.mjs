import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

/**
 * Parse comma-separated WxH viewport overrides or return the canonical 375/768/1440 matrix.
 */
export function parseViewports(spec) {
  if (!spec || !String(spec).trim()) {
    return DEFAULT_VIEWPORTS.map((vp) => ({ ...vp }));
  }

  return String(spec)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(\d+)x(\d+)$/i);
      if (!match) {
        throw new Error(`Invalid viewport "${entry}". Expected WxH such as 375x812.`);
      }
      const width = Number(match[1]);
      const height = Number(match[2]);
      return { name: `vp-${width}x${height}`, width, height };
    });
}

/**
 * Validate target URL; fails closed unless http(s)://.
 */
export function validateTargetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('TARGET_URL is required.');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid TARGET_URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported TARGET_URL protocol: ${parsed.protocol}`);
  }
  return parsed.toString();
}

/**
 * Evaluate viewport DOM/network observations against WEB-PRODUCTION-KERNEL checks.
 */
export function evaluateAuditFindings(observations) {
  const findings = [];

  for (const obs of observations) {
    const label = obs.label || obs.name || 'viewport';
    if (typeof obs.httpStatus === 'number' && obs.httpStatus >= 400) {
      findings.push({ severity: 'error', viewport: label, code: 'HTTP_ERROR', message: `HTTP ${obs.httpStatus}` });
    }
    if (Array.isArray(obs.pageErrors) && obs.pageErrors.length > 0) {
      findings.push({
        severity: 'error',
        viewport: label,
        code: 'PAGE_ERROR',
        message: `${obs.pageErrors.length} uncaught page error(s)`,
      });
    }
    if (obs.horizontalOverflowPx > 1) {
      findings.push({
        severity: 'error',
        viewport: label,
        code: 'HORIZONTAL_OVERFLOW',
        message: `Overflow by ${obs.horizontalOverflowPx}px`,
      });
    }
    if (obs.hasMainLandmark === false) {
      findings.push({
        severity: 'warn',
        viewport: label,
        code: 'MISSING_MAIN_LANDMARK',
        message: 'No <main> landmark found',
      });
    }
    if (obs.hasH1 === false) {
      findings.push({
        severity: 'warn',
        viewport: label,
        code: 'MISSING_H1',
        message: 'No visible <h1> heading found',
      });
    }
    if (typeof obs.imagesMissingAlt === 'number' && obs.imagesMissingAlt > 0) {
      findings.push({
        severity: 'error',
        viewport: label,
        code: 'MISSING_IMAGE_ALT',
        message: `${obs.imagesMissingAlt} image(s) missing alt text`,
      });
    }
    if (typeof obs.focusableCount === 'number' && obs.focusableCount === 0) {
      findings.push({
        severity: 'warn',
        viewport: label,
        code: 'NO_FOCUSABLE_CONTROLS',
        message: 'No keyboard-focusable controls found',
      });
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warn').length;
  return {
    passed: errorCount === 0,
    errorCount,
    warningCount,
    findings,
  };
}

/**
 * Build a SIP-1.1.1 structured critic receipt compatible with /v1/runner/callback.
 */
export function buildCriticReceipt({
  url,
  repo = 'unknown',
  ref = 'preview',
  observations = [],
  screenshotPaths = [],
  duration = 0,
  timestamp = new Date().toISOString(),
}) {
  const evaluation = evaluateAuditFindings(observations);
  return {
    protocol: 'SIP-1.1.1',
    agent: 'starlight-web-design-critic',
    repo,
    ref,
    url,
    status: evaluation.passed ? 'pass' : 'fail',
    exitCode: evaluation.passed ? 0 : 1,
    duration,
    errorCount: evaluation.errorCount,
    warningCount: evaluation.warningCount,
    findings: evaluation.findings,
    viewports: observations.map((o) => ({
      label: o.label || o.name,
      width: o.width,
      height: o.height,
      reducedMotion: Boolean(o.reducedMotion),
      httpStatus: o.httpStatus ?? null,
      horizontalOverflowPx: o.horizontalOverflowPx ?? 0,
    })),
    screenshotPaths,
    timestamp,
  };
}

/**
 * Compute HMAC-SHA256 signature header matching fleet-ingress verifySignature.
 */
export function signPayload(rawBody, secret) {
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${digest}`;
}

async function inspectViewport(browser, targetUrl, vp, { reducedMotion = false, outDir }) {
  const label = reducedMotion ? `${vp.name}-reduced-motion` : vp.name;
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  let httpStatus = null;
  try {
    const response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 45000 });
    httpStatus = response ? response.status() : null;
  } catch (err) {
    pageErrors.push(err.message);
  }

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const imgs = Array.from(document.querySelectorAll('img'));
    const missingAlt = imgs.filter((img) => !img.hasAttribute('alt')).length;
    const focusable = document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])').length;
    return {
      horizontalOverflowPx: Math.max(0, Math.round(doc.scrollWidth - window.innerWidth)),
      hasMainLandmark: Boolean(document.querySelector('main, [role="main"]')),
      hasH1: Boolean(document.querySelector('h1')),
      imagesMissingAlt: missingAlt,
      focusableCount: focusable,
    };
  });

  const screenshotPath = path.join(outDir, `${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await context.close();

  return {
    label,
    width: vp.width,
    height: vp.height,
    reducedMotion,
    httpStatus,
    pageErrors,
    screenshotPath,
    ...metrics,
  };
}

export async function runCritic(env = process.env) {
  const start = Date.now();
  const targetUrl = validateTargetUrl(env.TARGET_URL || env.STARLIGHT_TARGET_URL);
  const viewports = parseViewports(env.STARLIGHT_VIEWPORTS);
  const outDir = env.OUT_DIR || '/tmp/web-critic-artifacts';
  await fs.mkdir(outDir, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const observations = [];

  try {
    for (const vp of viewports) {
      observations.push(await inspectViewport(browser, targetUrl, vp, { reducedMotion: false, outDir }));
    }
    const desktopVp = viewports.find((vp) => vp.width >= 1200) || viewports[viewports.length - 1];
    observations.push(await inspectViewport(browser, targetUrl, desktopVp, { reducedMotion: true, outDir }));
  } finally {
    await browser.close();
  }

  const receipt = buildCriticReceipt({
    url: targetUrl,
    repo: env.STARLIGHT_REPO || 'unknown',
    ref: env.STARLIGHT_REF || 'preview',
    observations,
    screenshotPaths: observations.map((o) => o.screenshotPath),
    duration: Math.round((Date.now() - start) / 1000),
  });

  const receiptJson = JSON.stringify(receipt, null, 2);
  await fs.writeFile(path.join(outDir, 'receipt.json'), receiptJson, 'utf8');

  const callbackUrl = env.STARLIGHT_CALLBACK_URL;
  if (callbackUrl) {
    const headers = { 'Content-Type': 'application/json' };
    if (env.STARLIGHT_RUNNER_SECRET) {
      headers['X-Starlight-Signature'] = signPayload(receiptJson, env.STARLIGHT_RUNNER_SECRET);
    }
    await fetch(callbackUrl, { method: 'POST', headers, body: receiptJson }).catch(() => null);
  }

  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCritic()
    .then((receipt) => {
      console.log(JSON.stringify(receipt, null, 2));
      process.exit(receipt.exitCode);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
