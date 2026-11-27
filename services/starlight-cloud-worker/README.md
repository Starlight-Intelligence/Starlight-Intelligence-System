# Starlight cloud worker

Cloudflare Worker for the Starlight memory API, the virtual MCP router and the
OpenAI-compatible chat endpoint. Protected routes return 503 until a verified
identity and tenant-membership check is wired into `resolveTenant` in
`src/index.ts`.

## Chat completions

`POST /v1/chat/completions` accepts the OpenAI chat request shape and returns
the OpenAI `chat.completion` shape, plus these fields:

| Field | Meaning |
| --- | --- |
| `starlight_model` | The public model name you asked for. |
| `starlight_route` | The route that answered after failover. |
| `model` | The upstream model id that produced the answer. |
| `usage` | Token counts from the provider, or `null` when the provider did not return them. |
| `usage_complete` | `true` only when both prompt and completion counts came from the provider. |
| `cached` | `true` when the answer came from the worker cache. |

Streaming is not supported yet. `stream: true` returns 400.

### Public models

Each public model tries its routes in order. Routes without a binding or key are
skipped.

| `model` | Routes, in order |
| --- | --- |
| `starlight-auto` (default) | `anthropic`, `openai`, `edge-reason`, `edge-fast` |
| `starlight-edge-fast` | `edge-fast` |
| `starlight-edge-reason` | `edge-reason`, `edge-fast` |
| `starlight-edge-code` | `edge-code`, `edge-reason` |
| `starlight-anthropic` | `anthropic` |
| `starlight-openai` | `openai` |
| `starlight-edge` | Legacy alias for `starlight-edge-fast` |

Any other `model` value returns 400 with code `model_not_found`.

### Routes and default upstream models

Defaults were checked on 2026-11-27. Set the env var to change one without a
code change.

| Route | Provider | Default model | Override |
| --- | --- | --- | --- |
| `edge-fast` | Workers AI | `@cf/meta/llama-3.1-8b-instruct-fast` | `STARLIGHT_EDGE_FAST_MODEL` |
| `edge-reason` | Workers AI | `@cf/openai/gpt-oss-120b` | `STARLIGHT_EDGE_REASON_MODEL` |
| `edge-code` | Workers AI | `@cf/qwen/qwen2.5-coder-32b-instruct` | `STARLIGHT_EDGE_CODE_MODEL` |
| `anthropic` | Anthropic Messages API | `claude-sonnet-5-5` | `STARLIGHT_ANTHROPIC_MODEL` |
| `openai` | OpenAI Chat Completions | `gpt-6.2-sol` | `STARLIGHT_OPENAI_MODEL` |
| embeddings (not served here) | Workers AI | `@cf/baai/bge-base-en-v1.5` (768 dimensions, matches `starlight-memories-768`) | `STARLIGHT_EMBEDDING_MODEL` |

Sources: the Workers AI model catalog
(developers.cloudflare.com/workers-ai/models), Anthropic's models overview
(docs.anthropic.com/en/docs/about-claude/models/overview) and OpenAI's models
page (developers.openai.com/api/docs/models).

OpenAI requests send `max_completion_tokens`. Callers may send `max_tokens` or
`max_completion_tokens`; the default is 1024.

### Errors

The worker never writes an answer itself. When no model answers, you get an
error with an OpenAI-style `error` object.

| Status | Code | When |
| --- | --- | --- |
| 400 | `model_not_found`, `invalid_messages`, `stream_unsupported` | The request cannot be served. |
| 503 | `no_provider_configured` | No route for the model has a binding or key. |
| 502 | `all_routes_failed` | Every configured route failed. `attempts` lists each route and its status. Upstream error text is not returned. |

### Cache

Successful answers are cached in worker memory for 5 minutes.

- The key is a SHA-256 hash of the tenant id, public model, upstream model ids,
  the full message list (including recalled memory) and the request parameters.
- Requests that send `X-Anthropic-Key` or `X-Openai-Key` are not cached.
- Requests without a verified tenant id are not cached.
- Errors are not cached.
- The cache holds at most `STARLIGHT_CHAT_CACHE_MAX` entries (default 500) and
  evicts the least recently used entry.

### AI Gateway

Set `AI_GATEWAY_ID` to the name of an AI Gateway in the same Cloudflare account.
Workers AI calls then pass `{ gateway: { id } }` to `env.AI.run`, so they get
AI Gateway logging, caching and rate limits. If `CF_ACCOUNT_ID` is also set,
Anthropic and OpenAI calls go through
`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/<provider>`.

## Environment

| Name | Kind | Purpose |
| --- | --- | --- |
| `AI` | Binding | Workers AI. Required for the `edge-*` routes. |
| `AI_GATEWAY_ID` | Var | AI Gateway name. Optional. |
| `CF_ACCOUNT_ID` | Var | Account id, used with `AI_GATEWAY_ID` for external providers. Optional. |
| `ANTHROPIC_API_KEY` | Secret | Enables the `anthropic` route. Set with `wrangler secret put`. |
| `OPENAI_API_KEY` | Secret | Enables the `openai` route. Set with `wrangler secret put`. |
| `STARLIGHT_*_MODEL` | Var | Upstream model overrides, listed above. |
| `STARLIGHT_CHAT_CACHE_MAX` | Var | Cache entry cap. Default 500. |
| `UPSTREAM_TIMEOUT_MS` | Var | Timeout for Anthropic and OpenAI calls. Default 30000. |

## Tests

```
node --test src/llm/ai-gateway.test.mjs
```

Node 22.6 or later runs the TypeScript source directly. The tests use a fake
`env.AI` and an injected `fetch`, so they make no network calls.
