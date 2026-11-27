// node --import ./scripts/test/register.mjs --test src/lib/desk/ask-client.test.mjs
//
// The browser side of the Desk, proven without a browser: one limit for every
// caller, and every status the route sends maps to something a page can say.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MAX_QUESTION_CHARS as CASCADE_MAX } from "./cascade.ts";
import { MAX_QUESTION_CHARS } from "./question.ts";
import { askDesk, failureKind, outcomeFromResponse, parseRetryAfter, waitPhrase } from "./ask-client.ts";

test("the client limit is the cascade's limit", () => {
  assert.equal(MAX_QUESTION_CHARS, CASCADE_MAX);
  assert.equal(MAX_QUESTION_CHARS, 400);
});

test("client modules never import the cascade or node built-ins", async () => {
  for (const file of ["./ask-client.ts", "./question.ts", "../../components/ask/AskStarlight.tsx", "../../components/desk/DeskBrief.tsx"]) {
    const text = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(text, /from ["'][^"']*cascade["']/, file);
    assert.doesNotMatch(text, /from ["']node:/, file);
  }
});

test("each refusal status maps to a kind", () => {
  assert.equal(failureKind(429), "limit");
  assert.equal(failureKind(503), "offline");
  assert.equal(failureKind(422), "invalid");
  assert.equal(failureKind(400), "invalid");
  assert.equal(failureKind(502), "failed");
  assert.equal(failureKind(401), "failed");
});

test("a 429 keeps the server's words and its retry-after", () => {
  const outcome = outcomeFromResponse(429, "120", { error: "Too many runs from this address; try again in a minute." });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, "limit");
  assert.equal(outcome.retryAfter, 120);
  assert.match(outcome.error, /Too many runs/);
});

test("a 503 without a key is offline", () => {
  const outcome = outcomeFromResponse(503, null, { error: "The Desk needs NEBIUS_API_KEY and TAVILY_API_KEY in the environment." });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, "offline");
  assert.equal(outcome.retryAfter, null);
});

test("a body with no error text says the status", () => {
  const outcome = outcomeFromResponse(502, null, null);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, "The Desk answered 502.");
});

test("a 200 with no body is a failure, not an empty result", () => {
  const outcome = outcomeFromResponse(200, null, null);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, "failed");
});

test("a 200 with a body is the result", () => {
  const body = { brief: "## TAKEAWAY\nok", sources: [] };
  const outcome = outcomeFromResponse(200, null, body);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.data, body);
});

test("retry-after reads seconds and ignores the rest", () => {
  assert.equal(parseRetryAfter("60"), 60);
  assert.equal(parseRetryAfter(" 2.4 "), 3);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT"), null);
  assert.equal(parseRetryAfter("-5"), null);
});

test("waits read as a person would say them", () => {
  assert.equal(waitPhrase(1), "about 1 second");
  assert.equal(waitPhrase(45), "about 45 seconds");
  assert.equal(waitPhrase(60), "about 1 minute");
  assert.equal(waitPhrase(150), "about 3 minutes");
  assert.equal(waitPhrase(5 * 3600), "about 5 hours");
});

test("askDesk posts the question and never throws", async () => {
  let seen;
  const ok = await askDesk("why?", async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ brief: "b", sources: [] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(seen.url, "/api/desk/run");
  assert.equal(seen.init.method, "POST");
  assert.deepEqual(JSON.parse(seen.init.body), { question: "why?" });
  assert.equal(ok.ok, true);

  const limited = await askDesk("why?", async () =>
    new Response(JSON.stringify({ error: "ceiling" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "30" },
    }),
  );
  assert.equal(limited.ok, false);
  assert.equal(limited.kind, "limit");
  assert.equal(limited.retryAfter, 30);

  const down = await askDesk("why?", async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(down.ok, false);
  assert.equal(down.kind, "unreachable");
  assert.equal(down.status, null);

  const html = await askDesk("why?", async () => new Response("<html>", { status: 504, headers: { "content-type": "text/html" } }));
  assert.equal(html.ok, false);
  assert.equal(html.error, "The Desk answered 504.");
});
