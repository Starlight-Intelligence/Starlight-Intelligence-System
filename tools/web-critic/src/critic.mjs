import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
]);

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

function normalizeIpv4(ip) {
  if (net.isIPv4(ip)) return ip;
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return v4Mapped ? v4Mapped[1] : null;
}

export function isBlockedIpAddress(ip) {
  const normalized = String(ip || '').trim().toLowerCase();
  if (!normalized) return true;

  const ipv4 = normalizeIpv4(normalized);
  if (ipv4) {
    const parts = ipv4.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // RFC1918 10.0.0.0/8
    if (a === 127) return true; // Loopback 127.0.0.0/8
    if (a === 169 && b === 254) return true; // Link-local & GCP metadata 169.254.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16.0.0/12
    if (a === 192 && b === 168) return true; // RFC1918 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // Multicast / reserved
    return false;
  }

  if (net.isIPv6(normalized)) {
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA fc00::/7
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true; // Link-local fe80::/10
    }
    return false;
  }

  return true;
}

function isBlockedHostname(hostname, { allowLocalhost = false } = {}) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return true;
  if (allowLocalhost && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
    return false;
  }
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.internal') || host.endsWith('.local')) {
    return true;
  }
  if (net.isIP(host)) {
    return isBlockedIpAddress(host);
  }
  return false;
}

/**
 * Validate target URL; fails closed on non-HTTPS, credentials, and private/metadata/loopback hosts.
 */
export function validateTargetUrl(rawUrl, { allowLocalhost = false, envName = 'TARGET_URL' } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error(`${envName} is required.`);
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid ${envName}: ${rawUrl}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${envName} must not contain embedded credentials.`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol !== 'https:' && !(allowLocalhost && isLoopback && parsed.protocol === 'http:')) {
    throw new Error(`Unsupported ${envName} protocol: ${parsed.protocol}`);
  }
  if (isBlockedHostname(parsed.hostname, { allowLocalhost })) {
    throw new Error(`Blocked ${envName} host: ${parsed.hostname}`);
  }
  return parsed.toString();
}

/**
 * Resolve DNS and enforce fail-closed private/metadata IP denylist against DNS rebinding.
 */
export async function assertSafeDestination(rawUrl, { allowLocalhost = false, lookup = dns.lookup, envName = 'TARGET_URL' } = {}) {
  const normalized = validateTargetUrl(rawUrl, { allowLocalhost, envName });
  const parsed = new URL(normalized);
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (allowLocalhost && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
    return normalized;
  }
  if (net.isIP(host)) {
    if (isBlockedIpAddress(host)) {
      throw new Error(`Blocked ${envName} IP address: ${host}`);
    }
    return normalized;
  }

  const records = await lookup(host, { all: true });
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`DNS resolution failed for ${host}`);
  }
  for (const record of records) {
    if (isBlockedIpAddress(record.address)) {
      throw new Error(`Blocked ${envName} resolved IP: ${record.address}`);
    }
  }
  return normalized;
}

/**
 * Evaluate viewport DOM/network observations against WEB-PRODUCTION-KERNEL checks.
 */
export function evaluateAuditFindings(observations) {
  const findings = [];

  for (const obs of observations) {
    const label = obs.label || obs.name || 'viewport';
    const httpFailed = typeof obs.httpStatus === 'number' && obs.httpStatus >= 400;
    if (httpFailed) {
      findings.push({ severity: 'error', viewport: label, code: 'HTTP_ERROR', message: `HTTP ${obs.httpStatus}` });
    }
    if (obs.navigationError) {
      findings.push({
        severity: 'error',
        viewport: label,
        code: 'NAVIGATION_ERROR',
        message: obs.navigationError,
      });
    }
    if (Array.isArray(obs.pageErrors) && obs.pageErrors.length > 0) {
      findings.push({
        severity: 'error',
        viewport: label,
        code: 'PAGE_ERROR',
        message: `${obs.pageErrors.length} uncaught page error(s)`,
      });
    }
    if (Array.isArray(obs.consoleErrors) && obs.consoleErrors.length > 0) {
      findings.push({
        severity: 'error',
        viewport: label,
        code: 'CONSOLE_ERROR',
        message: `${obs.consoleErrors.length} console error(s)`,
      });
    }
    if (Array.isArray(obs.failedResponses) && obs.failedResponses.length > 0) {
      findings.push({
        severity: 'error',
        viewport: label,
        code: 'FAILED_SUBRESOURCE',
        message: `${obs.failedResponses.length} failed HTTP >=400 subresource(s)`,
      });
    }
    if (Array.isArray(obs.failedRequests) && obs.failedRequests.length > 0) {
      findings.push({
        severity: 'error',
        viewport: label,
        code: 'REQUEST_FAILED',
        message: `${obs.failedRequests.length} failed network request(s)`,
      });
    }
    if (obs.reducedMotion === true && obs.reducedMotionMatched === false) {
      findings.push({
        severity: 'error',
        viewport: label,
        code: 'REDUCED_MOTION_MISMATCH',
        message: 'Page did not observe prefers-reduced-motion: reduce',
      });
    }
    if (!httpFailed && !obs.navigationError) {
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
  screenshots = [],
  screenshotPaths = [],
  duration = 0,
  timestamp = new Date().toISOString(),
}) {
  const evaluation = evaluateAuditFindings(observations);
  const paths = screenshots.length > 0 ? screenshots.map((s) => s.path) : screenshotPaths;
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
      reducedMotionMatched: o.reducedMotionMatched ?? null,
      httpStatus: o.httpStatus ?? null,
      horizontalOverflowPx: o.horizontalOverflowPx ?? 0,
      consoleErrorCount: Array.isArray(o.consoleErrors) ? o.consoleErrors.length : 0,
      failedResponseCount: Array.isArray(o.failedResponses) ? o.failedResponses.length : 0,
    })),
    screenshots,
    screenshotPaths: paths,
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

/**
 * Post a signed critic receipt to a validated callback URL; fails closed without signing secret.
 */
export async function deliverSignedReceipt(receiptJson, env = process.env, fetchImpl = fetch) {
  const callbackUrl = env.STARLIGHT_CALLBACK_URL;
  if (!callbackUrl || !String(callbackUrl).trim()) {
    return null;
  }
  const secret = env.STARLIGHT_RUNNER_SECRET;
  if (!secret || !String(secret).trim()) {
    throw new Error('STARLIGHT_RUNNER_SECRET is required whenever STARLIGHT_CALLBACK_URL is set.');
  }
  const allowLocalhost = env.STARLIGHT_ALLOW_LOCALHOST === 'true';
  const safeCallback = await assertSafeDestination(callbackUrl, {
    allowLocalhost,
    envName: 'STARLIGHT_CALLBACK_URL',
  });

  const res = await fetchImpl(safeCallback, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Starlight-Signature': signPayload(receiptJson, secret.trim()),
    },
    body: receiptJson,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Callback delivery failed with HTTP ${res.status}`);
  }
  return res.status;
}

async function inspectViewport(browser, targetUrl, vp, { reducedMotion = false, outDir, allowLocalhost = false }) {
  const label = reducedMotion ? `${vp.name}-reduced-motion` : vp.name;
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });

  try {
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const failedResponses = [];
    const failedRequests = [];

    await page.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:')) {
        return route.continue();
      }
      try {
        await assertSafeDestination(reqUrl, { allowLocalhost, envName: 'REQUEST_URL' });
        return route.continue();
      } catch {
        failedRequests.push(`Blocked unsafe subresource: ${reqUrl.slice(0, 160)}`);
        return route.abort('blockedbyclient');
      }
    });

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text().slice(0, 240));
      }
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        failedResponses.push({ url: res.url().slice(0, 160), status: res.status() });
      }
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.url().slice(0, 160)} (${req.failure()?.errorText || 'failed'})`);
    });

    let httpStatus = null;
    let navigationError = null;
    try {
      const response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 45000 });
      httpStatus = response ? response.status() : null;
    } catch (err) {
      navigationError = err.message;
    }

    let metrics = {
      horizontalOverflowPx: 0,
      hasMainLandmark: null,
      hasH1: null,
      imagesMissingAlt: 0,
      focusableCount: 0,
      reducedMotionMatched: null,
    };

    if (!navigationError && (httpStatus === null || httpStatus < 400)) {
      metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const imgs = Array.from(document.querySelectorAll('img'));
        const missingAlt = imgs.filter((img) => !img.hasAttribute('alt')).length;
        const focusable = document.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ).length;
        return {
          horizontalOverflowPx: Math.max(0, Math.round(doc.scrollWidth - window.innerWidth)),
          hasMainLandmark: Boolean(document.querySelector('main, [role="main"]')),
          hasH1: Boolean(document.querySelector('h1')),
          imagesMissingAlt: missingAlt,
          focusableCount: focusable,
          reducedMotionMatched: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
      });
    }

    const screenshotPath = path.join(outDir, `${label}.png`);
    const screenshotBytes = await page.screenshot({ path: screenshotPath, fullPage: false });
    const screenshotSha256 = crypto.createHash('sha256').update(screenshotBytes).digest('hex');

    return {
      label,
      width: vp.width,
      height: vp.height,
      reducedMotion,
      httpStatus,
      navigationError,
      pageErrors,
      consoleErrors,
      failedResponses,
      failedRequests,
      screenshotPath,
      screenshotBytes: screenshotBytes.length,
      screenshotSha256,
      ...metrics,
    };
  } finally {
    await context.close();
  }
}

export async function runCritic(env = process.env) {
  const start = Date.now();
  const allowLocalhost = env.STARLIGHT_ALLOW_LOCALHOST === 'true';
  const targetUrl = await assertSafeDestination(env.TARGET_URL || env.STARLIGHT_TARGET_URL, {
    allowLocalhost,
    envName: 'TARGET_URL',
  });
  const viewports = parseViewports(env.STARLIGHT_VIEWPORTS);
  const outDir = env.OUT_DIR || '/tmp/web-critic-artifacts';
  await fs.mkdir(outDir, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const observations = [];

  try {
    for (const vp of viewports) {
      observations.push(
        await inspectViewport(browser, targetUrl, vp, { reducedMotion: false, outDir, allowLocalhost })
      );
    }
    const desktopVp = viewports.find((vp) => vp.width >= 1200) || viewports[viewports.length - 1];
    observations.push(
      await inspectViewport(browser, targetUrl, desktopVp, { reducedMotion: true, outDir, allowLocalhost })
    );
  } finally {
    await browser.close();
  }

  const screenshots = observations.map((o) => ({
    label: o.label,
    path: o.screenshotPath,
    bytes: o.screenshotBytes,
    sha256: o.screenshotSha256,
  }));

  const receipt = buildCriticReceipt({
    url: targetUrl,
    repo: env.STARLIGHT_REPO || 'unknown',
    ref: env.STARLIGHT_REF || 'preview',
    observations,
    screenshots,
    duration: Math.round((Date.now() - start) / 1000),
  });

  const receiptJson = JSON.stringify(receipt, null, 2);
  await fs.writeFile(path.join(outDir, 'receipt.json'), receiptJson, 'utf8');
  await deliverSignedReceipt(receiptJson, env);

  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCritic()
    .then((receipt) => {
      console.log(JSON.stringify(receipt, null, 2));
      process.exit(receipt.exitCode);
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(2);
    });
}
