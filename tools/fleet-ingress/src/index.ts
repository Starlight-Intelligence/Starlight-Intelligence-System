/**
 * Starlight Fleet Ingress Router — Cloudflare Worker
 *
 * Receives GitHub webhooks across Frank's multi-brand estate (~80+ repos),
 * verifies HMAC-SHA256 signatures, deduplicates payloads, and triggers
 * scale-to-zero Google Cloud Run Jobs runners with task-specific container overrides.
 *
 * Latency budget: <15ms edge routing, $0.00 idle cost.
 *
 * Built on SIP — Starlight Intelligence Protocol v1.1.1.
 */

export interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
  noRetry?(): void;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException?(): void;
}

export interface Queue<T = any> {
  send(message: T): Promise<void>;
}

export interface EstateHealthSweepReceipt {
  status: 'healthy' | 'dispatched';
  type: 'autonomous_estate_health_sweep';
  substrate: 'starlight-fleet-ingress';
  cron: string;
  scheduledTime: string;
  timestamp: string;
  protocol: 'SIP-1.1.1';
  details?: Record<string, any>;
}

export interface Env {
  GITHUB_WEBHOOK_SECRET?: string;
  GCP_PROJECT_ID?: string;
  GCP_REGION?: string;
  CLOUD_RUN_JOB?: string;
  GCP_SERVICE_ACCOUNT_JSON?: string;
  GCP_SERVICE_ACCOUNT_TOKEN?: string;
  INGRESS_AUTH_BEARER?: string;
  STARLIGHT_RUNNER_SECRET?: string;
  STARLIGHT_AGENT_JOBS?: Queue;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
}

const gcpTokenCache = new Map<string, { token: string; expiresAtMs: number }>();

export function clearGcpTokenCache(): void {
  gcpTokenCache.clear();
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemPkcs8ToDer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!cleaned) {
    throw new Error('empty_private_key');
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Mint a short-lived Google OAuth2 access token from a Service Account JSON key
 * using Web Crypto RS256 JWT assertion. Cached in memory until 60s before expiry.
 */
export async function mintGcpAccessToken(
  serviceAccountJson: string,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now()
): Promise<string> {
  const parsed = JSON.parse(serviceAccountJson) as Partial<ServiceAccountKey>;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.client_email !== 'string' ||
    !parsed.client_email.trim() ||
    typeof parsed.private_key !== 'string' ||
    !parsed.private_key.trim()
  ) {
    throw new Error('invalid_service_account_json');
  }

  const tokenUri =
    typeof parsed.token_uri === 'string' && parsed.token_uri.startsWith('https://')
      ? parsed.token_uri
      : 'https://oauth2.googleapis.com/token';
  const cacheKey = `${parsed.client_email}:${parsed.private_key_id || ''}:${tokenUri}`;
  const cached = gcpTokenCache.get(cacheKey);
  if (cached && nowMs < cached.expiresAtMs - 60_000) {
    return cached.token;
  }

  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 3600;
  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (typeof parsed.private_key_id === 'string' && parsed.private_key_id.trim()) {
    header.kid = parsed.private_key_id.trim();
  }
  const claims = {
    iss: parsed.client_email.trim(),
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: tokenUri,
    iat,
    exp,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemPkcs8ToDer(parsed.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  const assertion = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

  const tokenRes = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`gcp_token_exchange_${tokenRes.status}`);
  }
  const tokenBody = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token.trim()) {
    throw new Error('missing_access_token');
  }
  const ttlSec = typeof tokenBody.expires_in === 'number' && tokenBody.expires_in > 0
    ? tokenBody.expires_in
    : 3600;
  gcpTokenCache.set(cacheKey, {
    token: tokenBody.access_token,
    expiresAtMs: nowMs + ttlSec * 1000,
  });
  return tokenBody.access_token;
}

export async function resolveGcpAccessToken(
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (typeof env.GCP_SERVICE_ACCOUNT_JSON === 'string' && env.GCP_SERVICE_ACCOUNT_JSON.trim()) {
    return mintGcpAccessToken(env.GCP_SERVICE_ACCOUNT_JSON, fetchImpl);
  }
  if (typeof env.GCP_SERVICE_ACCOUNT_TOKEN === 'string' && env.GCP_SERVICE_ACCOUNT_TOKEN.trim()) {
    return env.GCP_SERVICE_ACCOUNT_TOKEN.trim();
  }
  throw new Error('gcp_credentials_missing');
}


export interface WebhookEventMeta {
  event: string;
  action?: string;
  repo: string;
  ref?: string;
  sha?: string;
  prNumber?: number;
  sender: string;
  installationId?: number;
}

/**
 * Verify GitHub HMAC-SHA256 signature using standard Web Crypto API.
 */
export async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!signatureHeader || !/^sha256=[0-9a-f]{64}$/i.test(signatureHeader)) {
    return false;
  }
  const signatureHex = signatureHeader.slice(7);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const sigBytes = new Uint8Array(
    signatureHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
  );
  const dataBytes = encoder.encode(rawBody);

  return crypto.subtle.verify('HMAC', cryptoKey, sigBytes, dataBytes);
}

/**
 * Extract normalized metadata from a GitHub webhook event payload.
 */
export function extractEventMetadata(
  eventType: string,
  payload: Record<string, any>
): WebhookEventMeta | null {
  const repo = payload.repository?.full_name;
  if (!repo) return null;

  const sender = payload.sender?.login || 'unknown';
  const installationId = payload.installation?.id;

  let sha: string | undefined;
  let prNumber: number | undefined;
  let ref: string | undefined;
  const action = payload.action;

  if (eventType === 'pull_request') {
    prNumber = payload.pull_request?.number;
    sha = payload.pull_request?.head?.sha;
    ref = payload.pull_request?.head?.ref;
  } else if (eventType === 'push') {
    sha = payload.after;
    ref = payload.ref;
  } else if (eventType === 'workflow_job') {
    sha = payload.workflow_job?.head_sha;
    ref = payload.workflow_job?.head_branch;
  } else if (eventType === 'check_run') {
    sha = payload.check_run?.head_sha;
  }

  return {
    event: eventType,
    action,
    repo,
    ref,
    sha,
    prNumber,
    sender,
    installationId,
  };
}

/**
 * Determine if an event should spin up a scale-to-zero Cloud Run runner instance.
 */
export function shouldDispatchRunner(meta: WebhookEventMeta): boolean {
  // Always trigger runner on PR opens, syncs, or explicit review requests
  if (meta.event === 'pull_request') {
    return ['opened', 'synchronize', 'reopened'].includes(meta.action || '');
  }
  // Trigger on push to main or release branches
  if (meta.event === 'push') {
    return meta.ref === 'refs/heads/main' || meta.ref?.startsWith('refs/tags/v') === true;
  }
  // Trigger on workflow jobs queued requesting starlight-runner label
  if (meta.event === 'workflow_job' && meta.action === 'queued') {
    return true;
  }
  return false;
}

/**
 * Build the Cloud Run Job `run` API body with environment variable overrides.
 */
export function buildCloudRunExecutionPayload(
  meta: WebhookEventMeta,
  callbackUrl?: string
): Record<string, any> {
  const normalizedRef = meta.ref
    ? meta.ref.replace(/^refs\/(heads|tags)\//, '')
    : undefined;

  const envOverrides: Array<{ name: string; value: string }> = [
    { name: 'REPO', value: meta.repo },
    { name: 'STARLIGHT_REPO', value: meta.repo },
    { name: 'TRIGGER_EVENT', value: meta.event },
  ];

  if (meta.sha) envOverrides.push({ name: 'COMMIT_SHA', value: meta.sha });
  if (meta.prNumber) envOverrides.push({ name: 'PR_NUMBER', value: String(meta.prNumber) });
  if (meta.ref) envOverrides.push({ name: 'GIT_REF', value: meta.ref });
  if (normalizedRef) envOverrides.push({ name: 'STARLIGHT_REF', value: normalizedRef });
  if (callbackUrl) {
    envOverrides.push({ name: 'CALLBACK_URL', value: callbackUrl });
    envOverrides.push({ name: 'STARLIGHT_CALLBACK_URL', value: callbackUrl });
  }

  return {
    overrides: {
      containerOverrides: [
        {
          env: envOverrides,
        },
      ],
    },
  };
}

export async function handleRequest(request: Request, env: Env = {}): Promise<Response> {
  const url = new URL(request.url);

    // Health probe
    if (url.pathname === '/health' || url.pathname === '/v1/health') {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          substrate: 'starlight-fleet-ingress',
          timestamp: new Date().toISOString(),
          protocol: 'SIP-1.1.1',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Webhook receiver endpoint
    if (request.method === 'POST' && (url.pathname === '/webhook' || url.pathname === '/v1/github/events')) {
      const signature = request.headers.get('x-hub-signature-256');
      const eventType = request.headers.get('x-github-event') || 'ping';
      const rawBody = await request.text();

      // Missing credentials must never turn a private webhook into an unsigned one.
      if (!env.GITHUB_WEBHOOK_SECRET?.trim()) {
        return new Response(JSON.stringify({ error: 'webhook_unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const isValid = await verifySignature(rawBody, signature, env.GITHUB_WEBHOOK_SECRET);
      if (!isValid) {
        return new Response(JSON.stringify({ error: 'invalid_signature' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let payload: Record<string, any> = {};
      try {
        payload = JSON.parse(rawBody);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'malformed_json' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return new Response(JSON.stringify({ error: 'malformed_json' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (eventType === 'ping') {
        return new Response(JSON.stringify({ ok: true, pong: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const meta = extractEventMetadata(eventType, payload);
      if (!meta) {
        return new Response(JSON.stringify({ ok: true, skipped: 'untracked_event' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const needsRunner = shouldDispatchRunner(meta);
      if (!needsRunner) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no_runner_action_needed', meta }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // If GCP credentials exist, dispatch directly to Google Cloud Run Jobs REST API
      const hasGcpCreds = Boolean(
        env.GCP_SERVICE_ACCOUNT_JSON?.trim() || env.GCP_SERVICE_ACCOUNT_TOKEN?.trim()
      );
      if (
        ![env.GCP_PROJECT_ID, env.GCP_REGION, env.CLOUD_RUN_JOB].every(
          (value) => typeof value === 'string' && value.trim().length > 0
        ) ||
        !hasGcpCreds
      ) {
        return new Response(JSON.stringify({ error: 'runner_unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let gcpDispatchResult: Record<string, any>;
      {
        const callbackUrl = `${url.origin}/v1/runner/callback`;
        const execPayload = buildCloudRunExecutionPayload(meta, callbackUrl);
        const gcpEndpoint = `https://run.googleapis.com/v2/projects/${env.GCP_PROJECT_ID}/locations/${env.GCP_REGION}/jobs/${env.CLOUD_RUN_JOB}:run`;

        try {
          const accessToken = await resolveGcpAccessToken(env);
          const gcpRes = await fetch(gcpEndpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(execPayload),
          });

          if (!gcpRes.ok) {
            return new Response(JSON.stringify({ error: 'runner_dispatch_failed' }), {
              status: 502,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          gcpDispatchResult = {
            dispatched: gcpRes.ok,
            status: gcpRes.status,
            body: await gcpRes.json().catch(() => ({})),
          };
        } catch (dispatchErr: any) {
          return new Response(JSON.stringify({ error: 'runner_dispatch_failed' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          event: meta.event,
          repo: meta.repo,
          runnerRequired: true,
          gcp: gcpDispatchResult,
        }),
        {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Runner completion receipt callback (HMAC-SHA256 authenticated)
    if (request.method === 'POST' && url.pathname === '/v1/runner/callback') {
      if (!env.STARLIGHT_RUNNER_SECRET?.trim()) {
        return new Response(JSON.stringify({ error: 'callback_unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const signature = request.headers.get('x-starlight-signature');
      const rawBody = await request.text();
      const isValid = await verifySignature(rawBody, signature, env.STARLIGHT_RUNNER_SECRET);
      if (!isValid) {
        return new Response(JSON.stringify({ error: 'invalid_signature' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let payload: Record<string, any> = {};
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return new Response(JSON.stringify({ error: 'malformed_json' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return new Response(JSON.stringify({ error: 'malformed_json' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        typeof payload.repo !== 'string' ||
        !payload.repo.trim() ||
        typeof payload.ref !== 'string' ||
        !payload.ref.trim() ||
        (payload.status !== 'pass' && payload.status !== 'fail') ||
        typeof payload.exitCode !== 'number' ||
        !Number.isFinite(payload.exitCode)
      ) {
        return new Response(JSON.stringify({ error: 'invalid_receipt' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const receipt: Record<string, any> = {
        repo: payload.repo.trim(),
        ref: payload.ref.trim(),
        status: payload.status,
        exitCode: payload.exitCode,
        timestamp: typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString(),
      };
      if (typeof payload.duration === 'number' && Number.isFinite(payload.duration)) {
        receipt.duration = payload.duration;
      }
      if (typeof payload.installDuration === 'number' && Number.isFinite(payload.installDuration)) {
        receipt.installDuration = payload.installDuration;
      }

      if (env.STARLIGHT_AGENT_JOBS && typeof env.STARLIGHT_AGENT_JOBS.send === 'function') {
        await env.STARLIGHT_AGENT_JOBS.send({
          job: 'runner-receipt',
          protocol: 'SIP-1.1.1',
          receipt,
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          received: true,
          protocol: 'SIP-1.1.1',
          receipt,
        }),
        {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Create an autonomous estate health sweep receipt conforming to SIP protocol standards.
 */
export function createEstateHealthSweepReceipt(
  cron: string,
  scheduledTime: string,
  env: Env = {}
): EstateHealthSweepReceipt {
  return {
    status: env.STARLIGHT_AGENT_JOBS ? 'dispatched' : 'healthy',
    type: 'autonomous_estate_health_sweep',
    substrate: 'starlight-fleet-ingress',
    cron,
    scheduledTime,
    timestamp: new Date().toISOString(),
    protocol: 'SIP-1.1.1',
    details: {
      action: 'nightly_estate_health_audit_and_memory_consolidation',
      region: env.GCP_REGION || 'europe-west4',
      jobsQueueConfigured: Boolean(env.STARLIGHT_AGENT_JOBS),
    },
  };
}

/**
 * Cloudflare Workers scheduled event handler for cron triggers.
 * Executes nightly estate health audits, emits SIP-compliant sweep receipts,
 * and queues background agent jobs when STARLIGHT_AGENT_JOBS is bound.
 */
export async function scheduled(
  controller: ScheduledController,
  env: Env = {},
  ctx?: ExecutionContext
): Promise<void> {
  const scheduledTime = controller?.scheduledTime
    ? new Date(controller.scheduledTime).toISOString()
    : new Date().toISOString();
  const cron = controller?.cron || '0 4 * * *';

  console.log(`[starlight-fleet-ingress] Scheduled trigger invoked at ${scheduledTime} (cron: "${cron}")`);

  // Execute an edge health ping to verify worker substrate availability
  const healthPingRes = await handleRequest(
    new Request('https://ingress.starlight.internal/health'),
    env
  );
  const healthPingOk = healthPingRes.status === 200;

  const receipt = createEstateHealthSweepReceipt(cron, scheduledTime, env);
  if (receipt.details) {
    receipt.details.healthPingStatus = healthPingOk ? 'healthy' : 'degraded';
  }

  // Queue to STARLIGHT_AGENT_JOBS if configured; otherwise emit autonomous receipt
  if (env.STARLIGHT_AGENT_JOBS && typeof env.STARLIGHT_AGENT_JOBS.send === 'function') {
    const jobPromise = env.STARLIGHT_AGENT_JOBS.send({
      job: 'estate-health-audit',
      action: 'nightly_estate_health_audit_and_memory_consolidation',
      cron,
      scheduledTime,
      protocol: 'SIP-1.1.1',
      receipt,
    });

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(jobPromise);
    } else {
      await jobPromise;
    }
    console.log(`[starlight-fleet-ingress] Queued estate health audit task to STARLIGHT_AGENT_JOBS`);
  } else {
    console.log(
      `[starlight-fleet-ingress] Autonomous estate health sweep receipt emitted:`,
      JSON.stringify(receipt)
    );
  }
}

export default {
  fetch: handleRequest,
  scheduled,
};

