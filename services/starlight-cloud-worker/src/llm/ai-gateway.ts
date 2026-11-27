/**
 * Starlight AI gateway
 * OpenAI-compatible /v1/chat/completions router over Cloudflare Workers AI,
 * Anthropic and OpenAI, with ordered failover and a tenant-scoped response cache.
 *
 * Honesty rules:
 * - The gateway never writes model output itself. No configured route -> 503.
 *   Every configured route failed -> 502. Unknown model -> 400.
 * - Usage is reported only when the provider returns it; otherwise `usage` is null
 *   and `usage_complete` is false.
 * - Cache keys are SHA-256 over tenant, model, full messages and params. Requests
 *   carrying caller-supplied provider keys (BYOK) and errors are never cached.
 *
 * Built on SIP v1.1.1
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  injectMemory?: boolean;
}

export interface ChatUsage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  /** Upstream model id that produced the answer. */
  model: string;
  /** Public Starlight route the caller asked for, e.g. `starlight-edge-fast`. */
  starlight_model: string;
  /** Route that answered after failover, e.g. `edge-reason` or `anthropic`. */
  starlight_route: RouteId;
  cached: boolean;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: ChatUsage | null;
  usage_complete: boolean;
}

export interface GatewayErrorBody {
  error: {
    message: string;
    type: 'invalid_request_error' | 'service_unavailable' | 'upstream_error';
    code: string;
  };
  /** Routes tried, with status only. Upstream error text is not exposed. */
  attempts?: Array<{ route: RouteId; status: number | 'error' }>;
}

export type GatewayResult =
  | { ok: true; status: 200; body: ChatCompletionResponse }
  | { ok: false; status: 400 | 502 | 503; body: GatewayErrorBody };

export interface GatewayOptions {
  headers?: Headers;
  /** Verified tenant id. Without it the response is not cached. */
  tenantId?: string;
  injectedMemories?: string[];
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

// ---------- route table ----------

export type RouteId = 'edge-fast' | 'edge-reason' | 'edge-code' | 'anthropic' | 'openai';
type Provider = 'workers-ai' | 'anthropic' | 'openai';

interface RouteSpec {
  provider: Provider;
  /** Env var that overrides the upstream model id. */
  modelEnv: string;
  defaultModel: string;
}

/**
 * Default upstream ids, checked 2026-11-27:
 * - Workers AI ids: developers.cloudflare.com/workers-ai/models/
 * - Anthropic: docs.anthropic.com/en/docs/about-claude/models/overview
 * - OpenAI: developers.openai.com/api/docs/models
 * Override any of them with the env var named in `modelEnv`.
 */
export const ROUTES: Record<RouteId, RouteSpec> = {
  'edge-fast': { provider: 'workers-ai', modelEnv: 'STARLIGHT_EDGE_FAST_MODEL', defaultModel: '@cf/meta/llama-3.1-8b-instruct-fast' },
  'edge-reason': { provider: 'workers-ai', modelEnv: 'STARLIGHT_EDGE_REASON_MODEL', defaultModel: '@cf/openai/gpt-oss-120b' },
  'edge-code': { provider: 'workers-ai', modelEnv: 'STARLIGHT_EDGE_CODE_MODEL', defaultModel: '@cf/qwen/qwen2.5-coder-32b-instruct' },
  anthropic: { provider: 'anthropic', modelEnv: 'STARLIGHT_ANTHROPIC_MODEL', defaultModel: 'claude-sonnet-5-5' },
  openai: { provider: 'openai', modelEnv: 'STARLIGHT_OPENAI_MODEL', defaultModel: 'gpt-6.2-sol' },
};

/**
 * Embedding model for the 768-dimension Vectorize index `starlight-memories-768`.
 * Not served by /v1/chat/completions; exported so ingestion code uses the same id.
 */
export const EMBEDDING_ROUTE = {
  provider: 'workers-ai' as const,
  modelEnv: 'STARLIGHT_EMBEDDING_MODEL',
  defaultModel: '@cf/baai/bge-base-en-v1.5',
  dimensions: 768,
};

/** Public model name -> ordered routes. Only configured routes are tried. */
export const PUBLIC_MODELS: Record<string, RouteId[]> = {
  'starlight-auto': ['anthropic', 'openai', 'edge-reason', 'edge-fast'],
  'starlight-edge-fast': ['edge-fast'],
  'starlight-edge-reason': ['edge-reason', 'edge-fast'],
  'starlight-edge-code': ['edge-code', 'edge-reason'],
  'starlight-anthropic': ['anthropic'],
  'starlight-openai': ['openai'],
  // Legacy alias kept for existing callers.
  'starlight-edge': ['edge-fast'],
};

const DEFAULT_MAX_TOKENS = 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_MAX = 500;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;
const BYOK_HEADERS = ['X-Anthropic-Key', 'X-Openai-Key'];

export function resolveUpstreamModel(route: RouteId | 'embedding', env: any): string {
  const spec = route === 'embedding' ? EMBEDDING_ROUTE : ROUTES[route];
  const override = env?.[spec.modelEnv];
  return typeof override === 'string' && override.trim() ? override.trim() : spec.defaultModel;
}

// ---------- bounded LRU cache ----------

const EDGE_PROMPT_CACHE = new Map<string, { response: ChatCompletionResponse; expiresAt: number }>();

function cacheGet(key: string): ChatCompletionResponse | null {
  const entry = EDGE_PROMPT_CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    EDGE_PROMPT_CACHE.delete(key);
    return null;
  }
  // Refresh recency: Map iteration order is insertion order.
  EDGE_PROMPT_CACHE.delete(key);
  EDGE_PROMPT_CACHE.set(key, entry);
  return { ...entry.response, cached: true };
}

function cacheSet(key: string, response: ChatCompletionResponse, max: number): void {
  EDGE_PROMPT_CACHE.delete(key);
  EDGE_PROMPT_CACHE.set(key, { response, expiresAt: Date.now() + CACHE_TTL_MS });
  while (EDGE_PROMPT_CACHE.size > max) {
    const oldest = EDGE_PROMPT_CACHE.keys().next().value;
    if (oldest === undefined) break;
    EDGE_PROMPT_CACHE.delete(oldest);
  }
}

/** Test hooks. */
export function __resetGatewayCache(): void {
  EDGE_PROMPT_CACHE.clear();
}
export function __gatewayCacheSize(): number {
  return EDGE_PROMPT_CACHE.size;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- gateway ----------

class UpstreamError extends Error {
  status: number | 'error';
  constructor(status: number | 'error', message: string) {
    super(message);
    this.status = status;
  }
}

interface UpstreamResult {
  model: string;
  content: string;
  finishReason: string;
  usage: ChatUsage | null;
  usageComplete: boolean;
  upstreamId?: string;
}

function fail(status: 400 | 502 | 503, type: GatewayErrorBody['error']['type'], code: string, message: string, attempts?: GatewayErrorBody['attempts']): GatewayResult {
  const body: GatewayErrorBody = { error: { message, type, code } };
  if (attempts) body.attempts = attempts;
  return { ok: false, status, body };
}

export class UnifiedAiGateway {
  /** Routes a chat completion through the configured routes for the requested model. */
  public static async complete(req: ChatCompletionRequest, env: any, opts: GatewayOptions = {}): Promise<GatewayResult> {
    const headers = opts.headers;
    const doFetch = opts.fetchImpl ?? fetch;

    // 1. Validate the request.
    if (!req || !Array.isArray(req.messages) || req.messages.length === 0) {
      return fail(400, 'invalid_request_error', 'invalid_messages', '`messages` must be a non-empty array.');
    }
    for (const m of req.messages) {
      if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
        return fail(400, 'invalid_request_error', 'invalid_messages', 'Each message needs a role of system, user or assistant and string content.');
      }
    }
    if (req.stream === true) {
      return fail(400, 'invalid_request_error', 'stream_unsupported', 'Streaming is not supported by this endpoint yet. Send `stream: false`.');
    }
    const publicModel = req.model || 'starlight-auto';
    const chain = PUBLIC_MODELS[publicModel];
    if (!chain) {
      return fail(400, 'invalid_request_error', 'model_not_found', `Unknown model. Use one of: ${Object.keys(PUBLIC_MODELS).join(', ')}.`);
    }

    // 2. Add recalled tenant context.
    const messages: ChatMessage[] = req.messages.map(m => ({ role: m.role, content: m.content }));
    const memories = opts.injectedMemories ?? [];
    if (memories.length > 0 && req.injectMemory !== false) {
      const memoryContext = `[STARLIGHT RECALLED CONTEXT]\n${memories.join('\n---\n')}\n[END RECALLED CONTEXT]`;
      if (messages[0].role === 'system') {
        messages[0] = { role: 'system', content: `${messages[0].content}\n\n${memoryContext}` };
      } else {
        messages.unshift({ role: 'system', content: memoryContext });
      }
    }

    const maxTokens = req.max_completion_tokens ?? req.max_tokens ?? DEFAULT_MAX_TOKENS;
    const temperature = typeof req.temperature === 'number' ? req.temperature : undefined;

    // 3. Resolve which routes are configured.
    const byok = BYOK_HEADERS.some(h => !!headers?.get(h));
    const anthropicKey = headers?.get('X-Anthropic-Key') || env?.ANTHROPIC_API_KEY;
    const openaiKey = headers?.get('X-Openai-Key') || env?.OPENAI_API_KEY;
    const configured = chain.filter(route => {
      const provider = ROUTES[route].provider;
      if (provider === 'workers-ai') return !!env?.AI && typeof env.AI.run === 'function';
      if (provider === 'anthropic') return !!anthropicKey;
      return !!openaiKey;
    });
    if (configured.length === 0) {
      return fail(503, 'service_unavailable', 'no_provider_configured', 'No model provider is configured for this model.');
    }

    // 4. Tenant-scoped cache lookup. BYOK and tenant-less requests skip the cache.
    const cacheable = !byok && !!opts.tenantId;
    let cacheKey: string | null = null;
    if (cacheable) {
      cacheKey = await sha256Hex(JSON.stringify({
        v: 1,
        tenant: opts.tenantId,
        model: publicModel,
        upstream: configured.map(r => resolveUpstreamModel(r, env)),
        messages,
        params: { max_tokens: maxTokens, temperature: temperature ?? null },
      }));
      const hit = cacheGet(cacheKey);
      if (hit) return { ok: true, status: 200, body: hit };
    }

    // 5. Try routes in order.
    const attempts: NonNullable<GatewayErrorBody['attempts']> = [];
    for (const route of configured) {
      const upstreamModel = resolveUpstreamModel(route, env);
      try {
        let result: UpstreamResult;
        const provider = ROUTES[route].provider;
        if (provider === 'workers-ai') {
          result = await this.callWorkersAi(upstreamModel, messages, maxTokens, temperature, env);
        } else if (provider === 'anthropic') {
          result = await this.callAnthropic(upstreamModel, messages, maxTokens, temperature, anthropicKey, env, doFetch);
        } else {
          result = await this.callOpenAi(upstreamModel, messages, maxTokens, temperature, openaiKey, env, doFetch);
        }

        const body: ChatCompletionResponse = {
          id: `chatcmpl_${result.upstreamId ?? crypto.randomUUID()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: result.model,
          starlight_model: publicModel,
          starlight_route: route,
          cached: false,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: result.content },
            finish_reason: result.finishReason,
          }],
          usage: result.usage,
          usage_complete: result.usageComplete,
        };
        if (cacheKey) cacheSet(cacheKey, body, this.cacheMax(env));
        return { ok: true, status: 200, body };
      } catch (err: any) {
        attempts.push({ route, status: err instanceof UpstreamError ? err.status : 'error' });
      }
    }

    return fail(502, 'upstream_error', 'all_routes_failed', 'Every configured model provider failed for this request. Try again later.', attempts);
  }

  private static cacheMax(env: any): number {
    const n = Number(env?.STARLIGHT_CHAT_CACHE_MAX);
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_CACHE_MAX;
  }

  private static timeoutSignal(env: any): AbortSignal | undefined {
    const n = Number(env?.UPSTREAM_TIMEOUT_MS);
    const ms = Number.isFinite(n) && n > 0 ? n : DEFAULT_UPSTREAM_TIMEOUT_MS;
    return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined;
  }

  /** AI Gateway base URL for external providers, when both ids are configured. */
  private static gatewayBase(env: any): string | null {
    if (env?.AI_GATEWAY_ID && env?.CF_ACCOUNT_ID) {
      return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(env.CF_ACCOUNT_ID)}/${encodeURIComponent(env.AI_GATEWAY_ID)}`;
    }
    return null;
  }

  private static async callWorkersAi(model: string, messages: ChatMessage[], maxTokens: number, temperature: number | undefined, env: any): Promise<UpstreamResult> {
    const input: Record<string, unknown> = { messages, max_tokens: maxTokens };
    if (temperature !== undefined) input.temperature = temperature;
    // Route through AI Gateway for logging, caching and rate limits when configured.
    const options = env?.AI_GATEWAY_ID ? { gateway: { id: String(env.AI_GATEWAY_ID) } } : undefined;
    let out: any;
    try {
      out = await env.AI.run(model, input, options);
    } catch (err: any) {
      throw new UpstreamError('error', `Workers AI ${model} failed`);
    }
    // Older models return { response, usage }; newer ones return a chat completion shape.
    const content = typeof out?.response === 'string'
      ? out.response
      : out?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new UpstreamError('error', `Workers AI ${model} returned no text`);
    const usage = parseOpenAiUsage(out?.usage);
    return {
      model,
      content,
      finishReason: out?.choices?.[0]?.finish_reason ?? 'stop',
      usage: usage.usage,
      usageComplete: usage.complete,
    };
  }

  private static async callAnthropic(model: string, messages: ChatMessage[], maxTokens: number, temperature: number | undefined, apiKey: string, env: any, doFetch: typeof fetch): Promise<UpstreamResult> {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const payload: Record<string, unknown> = {
      model,
      messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
    };
    if (system) payload.system = system;
    if (temperature !== undefined) payload.temperature = temperature;

    const base = this.gatewayBase(env);
    const url = base ? `${base}/anthropic/v1/messages` : 'https://api.anthropic.com/v1/messages';
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: this.timeoutSignal(env),
    });
    if (!res.ok) throw new UpstreamError(res.status, `Anthropic ${res.status}`);
    const data = await res.json() as any;
    const blocks = Array.isArray(data?.content) ? data.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string') : [];
    if (blocks.length === 0) throw new UpstreamError('error', 'Anthropic returned no text');

    const input = data?.usage?.input_tokens;
    const output = data?.usage?.output_tokens;
    const complete = typeof input === 'number' && typeof output === 'number';
    return {
      model: typeof data?.model === 'string' ? data.model : model,
      content: blocks.map((b: any) => b.text).join(''),
      finishReason: mapAnthropicStop(data?.stop_reason),
      usage: data?.usage ? {
        prompt_tokens: typeof input === 'number' ? input : null,
        completion_tokens: typeof output === 'number' ? output : null,
        total_tokens: complete ? input + output : null,
      } : null,
      usageComplete: complete,
      upstreamId: typeof data?.id === 'string' ? data.id : undefined,
    };
  }

  private static async callOpenAi(model: string, messages: ChatMessage[], maxTokens: number, temperature: number | undefined, apiKey: string, env: any, doFetch: typeof fetch): Promise<UpstreamResult> {
    // Current OpenAI models take `max_completion_tokens`; `max_tokens` is deprecated.
    const payload: Record<string, unknown> = { model, messages, max_completion_tokens: maxTokens };
    if (temperature !== undefined) payload.temperature = temperature;

    const base = this.gatewayBase(env);
    const url = base ? `${base}/openai/chat/completions` : 'https://api.openai.com/v1/chat/completions';
    const res = await doFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: this.timeoutSignal(env),
    });
    if (!res.ok) throw new UpstreamError(res.status, `OpenAI ${res.status}`);
    const data = await res.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new UpstreamError('error', 'OpenAI returned no text');
    const usage = parseOpenAiUsage(data?.usage);
    return {
      model: typeof data?.model === 'string' ? data.model : model,
      content,
      finishReason: data?.choices?.[0]?.finish_reason ?? 'stop',
      usage: usage.usage,
      usageComplete: usage.complete,
      upstreamId: typeof data?.id === 'string' ? data.id.replace(/^chatcmpl[-_]/, '') : undefined,
    };
  }
}

function parseOpenAiUsage(u: any): { usage: ChatUsage | null; complete: boolean } {
  if (!u || typeof u !== 'object') return { usage: null, complete: false };
  const p = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : null;
  const c = typeof u.completion_tokens === 'number' ? u.completion_tokens : null;
  const t = typeof u.total_tokens === 'number' ? u.total_tokens : (p !== null && c !== null ? p + c : null);
  if (p === null && c === null && t === null) return { usage: null, complete: false };
  return { usage: { prompt_tokens: p, completion_tokens: c, total_tokens: t }, complete: p !== null && c !== null };
}

function mapAnthropicStop(reason: unknown): string {
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool_calls';
  return 'stop';
}
