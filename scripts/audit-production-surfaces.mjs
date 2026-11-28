#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PRODUCTION_URLS = [
  'https://www.frankx.ai',
  'https://starlightintelligence.ai',
  'https://gencreator.ai',
  'https://www.arcanea.ai',
  'https://www.agenticincome.ai',
  'https://www.realityarchitect.ai',
  'https://vibeclubs.ai',
  'https://aiarchitectacademy.com',
  'https://www.animelegends.ai',
  'https://arcanea.academy',
  'https://starlightintelligence.org',
];

const SLOP_RULES = [
  { id: 'cliche-noise-opener', pattern: /\bmost\s+ai\s+advice\s+is\s+noise\b/i, label: 'Staged opener ("Most AI advice is noise")' },
  { id: 'cliche-engineered-revenue', pattern: /\bengineered\s+revenue\b/i, label: 'Unbacked outcome claim ("Engineered revenue")' },
  { id: 'cliche-runs-without-you', pattern: /\bruns?\s+without\s+you\b/i, label: 'Autopilot claim ("runs without you")' },
  { id: 'cliche-triad-imagine', pattern: /\bimagine\s+it\.\s*build\s+it\.\s*witness\s+it\b/i, label: 'Generic triad ("Imagine it. Build it. Witness it.")' },
  { id: 'cliche-game-changer', pattern: /\bgame[- ]?changer\b/i, label: 'AI hype word ("game-changer")' },
  { id: 'cliche-unlock-your', pattern: /\bunlock\s+your\b/i, label: 'AI hype phrase ("unlock your")' },
  { id: 'cliche-revolutionize', pattern: /\brevolutionize\b/i, label: 'AI hype word ("revolutionize")' },
  { id: 'cliche-fast-paced', pattern: /\bin\s+today['’]s\s+fast[- ]paced\s+world\b/i, label: 'Stock AI filler ("in today\'s fast-paced world")' },
  { id: 'cliche-not-x-but-y', pattern: /\bnot\s+just\s+[^.]{1,40}[,;—–-]\s*(?:it['’]s|it\s+is)\b/i, label: 'Rhetorical "not just X, it\'s Y" contrast' },
  { id: 'bug-concatenated-h1', pattern: /\bbuildintelligence\b/i, label: 'Concatenated H1 text ("Buildintelligence")' },
  { id: 'retired-40-coes', pattern: /\b40\+?\s*(?:enterprise\s+)?(?:ai\s+)?(?:coes?|cent(?:er|re)s\s+of\s+excellence)\b/i, label: 'Retired unsourced 40+ CoEs claim' },
  { id: 'retired-12k-songs', pattern: /\b12[,.]?000\+?\s*(?:ai[- ]generated\s+)?songs\b/i, label: 'Retired unsourced 12,000+ songs claim' },
  { id: 'retired-fortune-500', pattern: /\bfortune[- ]?500s?\b/i, label: 'Retired unsourced Fortune 500 claim' },
];

function decodeBasicEntities(text) {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

export function stripHtmlToText(html) {
  const withoutBlocks = String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeBasicEntities(withoutBlocks).replace(/\s+/g, ' ').trim();
}

function extractTagContent(html, tagName) {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(html);
  return match ? stripHtmlToText(match[1]) : '';
}

function extractMetaDescription(html) {
  const patterns = [
    /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
    /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return decodeBasicEntities(m[1]).trim();
  }
  return '';
}

function extractCanonical(html) {
  const patterns = [
    /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i,
    /<link\b[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return decodeBasicEntities(m[1]).trim();
  }
  return '';
}

function countJsonLd(html) {
  const matches = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>/gi);
  return matches ? matches.length : 0;
}

export function detectSlopSignals({ title = '', h1 = '', visibleText = '', htmlBytes = 0 }) {
  const flags = [];
  const haystack = `${title}\n${h1}\n${visibleText}`;

  for (const rule of SLOP_RULES) {
    if (rule.pattern.test(haystack)) {
      flags.push({ id: rule.id, label: rule.label });
    }
  }

  const h1Words = h1 ? h1.split(/\s+/).filter(Boolean).length : 0;
  if (!h1) {
    flags.push({ id: 'missing-h1', label: 'Missing <h1> element' });
  } else if (h1Words > 10) {
    flags.push({ id: 'h1-too-long', label: `Hero H1 exceeds 10 words (${h1Words} words)` });
  }

  if (htmlBytes > 200 * 1024) {
    const kb = Math.round(htmlBytes / 1024);
    flags.push({ id: 'oversized-html', label: `HTML payload exceeds 200 KB (${kb} KB)` });
  }

  return flags;
}

export function analyzeHtmlSurface(html, { url, status = 200, ttfbMs = 0, ax = {} } = {}) {
  const rawHtml = String(html || '');
  const htmlBytes = Buffer.byteLength(rawHtml, 'utf8');
  const title = extractTagContent(rawHtml, 'title');
  const description = extractMetaDescription(rawHtml);
  const canonical = extractCanonical(rawHtml);
  const h1 = extractTagContent(rawHtml, 'h1');
  const h1WordCount = h1 ? h1.split(/\s+/).filter(Boolean).length : 0;
  const jsonLdCount = countJsonLd(rawHtml);
  const visibleText = stripHtmlToText(rawHtml);

  const slopFlags = detectSlopSignals({ title, h1, visibleText, htmlBytes });

  const availability =
    (status === 200 ? 15 : 0) +
    (ttfbMs > 0 && ttfbMs <= 1200 ? 5 : ttfbMs > 0 && ttfbMs <= 2500 ? 2 : status === 200 && ttfbMs === 0 ? 5 : 0) +
    (htmlBytes > 0 && htmlBytes <= 200 * 1024 ? 5 : 0);

  const seo =
    (title.length > 0 && title.length <= 75 ? 6 : title.length > 0 ? 3 : 0) +
    (description.length >= 40 ? 6 : description.length > 0 ? 3 : 0) +
    (canonical.length > 0 ? 7 : 0) +
    (jsonLdCount > 0 ? 6 : 0);

  const axState = {
    llmsTxt: Boolean(ax.llmsTxt),
    agentsMd: Boolean(ax.agentsMd),
    agentCard: Boolean(ax.agentCard),
  };
  const axScore =
    (axState.llmsTxt ? 12 : 0) +
    (axState.agentsMd ? 7 : 0) +
    (axState.agentCard ? 6 : 0);

  const nonSizeFlags = slopFlags.filter((f) => f.id !== 'oversized-html' && f.id !== 'missing-h1' && f.id !== 'h1-too-long');
  const h1Points = h1 && h1WordCount <= 10 ? 10 : h1 ? 5 : 0;
  const craft = h1Points + Math.max(0, 15 - nonSizeFlags.length * 5);

  const score = availability + seo + axScore + craft;

  return {
    url,
    status,
    ttfbMs,
    htmlBytes,
    title,
    description,
    canonical,
    h1,
    h1WordCount,
    jsonLdCount,
    ax: axState,
    slopFlags,
    breakdown: {
      availability,
      seo,
      ax: axScore,
      craft,
    },
    score,
  };
}

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'StarlightSurfaceLever/1.0' },
    });
    const text = await res.text();
    return { ok: true, status: res.status, ttfbMs: Date.now() - start, text };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ttfbMs: Date.now() - start,
      text: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeOk(url, timeoutMs = 6000) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'StarlightSurfaceLever/1.0' },
    });
    if (res.status !== 200) return false;
    const text = await res.text();
    return text.trim().length > 0;
  } catch {
    return false;
  }
}

export async function auditUrl(baseUrl) {
  const origin = baseUrl.replace(/\/+$/, '');
  const [home, llmsTxt, agentsMd, wellKnownAgent, wellKnownAiCatalog, wellKnownStarlight] =
    await Promise.all([
      fetchWithTimeout(`${origin}/`),
      probeOk(`${origin}/llms.txt`),
      probeOk(`${origin}/agents.md`),
      probeOk(`${origin}/.well-known/agent.json`),
      probeOk(`${origin}/.well-known/ai-catalog.json`),
      probeOk(`${origin}/.well-known/starlight.json`),
    ]);

  const result = analyzeHtmlSurface(home.text, {
    url: origin,
    status: home.status,
    ttfbMs: home.ttfbMs,
    ax: {
      llmsTxt,
      agentsMd,
      agentCard: wellKnownAgent || wellKnownAiCatalog || wellKnownStarlight,
    },
  });

  if (home.error) result.error = home.error;
  return result;
}

export function formatScorecardMarkdown(results, { generatedAt = new Date().toISOString() } = {}) {
  const lines = [
    `# Production Surface Excellence & Anti-Slop Scorecard`,
    ``,
    `Generated: ${generatedAt}`,
    ``,
    `| Domain | Score | Avail | SEO | AX | Craft | HTML KB | H1 | Flags |`,
    `|---|---:|---:|---:|---:|---:|---:|---|---|`,
  ];

  for (const r of results) {
    const kb = Math.round((r.htmlBytes || 0) / 1024);
    const h1Preview = (r.h1 || 'MISSING').replace(/\|/g, '\\|').slice(0, 48);
    const flagSummary = r.slopFlags.length ? r.slopFlags.map((f) => f.id).join(', ') : 'none';
    lines.push(
      `| ${r.url} | **${r.score}/100** | ${r.breakdown.availability}/25 | ${r.breakdown.seo}/25 | ${r.breakdown.ax}/25 | ${r.breakdown.craft}/25 | ${kb} KB | ${h1Preview} | ${flagSummary} |`,
    );
  }

  lines.push('', '## Detailed Findings', '');
  for (const r of results) {
    lines.push(`### ${r.url} — ${r.score}/100 (HTTP ${r.status}, ${r.ttfbMs}ms)`);
    lines.push(`- **Title:** ${r.title || 'MISSING'}`);
    lines.push(`- **Canonical:** ${r.canonical || 'MISSING'}`);
    lines.push(`- **JSON-LD blocks:** ${r.jsonLdCount}`);
    lines.push(`- **AX endpoints:** llms.txt=${r.ax.llmsTxt}, agents.md=${r.ax.agentsMd}, well-known=${r.ax.agentCard}`);
    if (r.slopFlags.length) {
      lines.push(`- **Flags:** ${r.slopFlags.map((f) => f.label).join('; ')}`);
    } else {
      lines.push(`- **Flags:** None`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const liveMode = args.includes('--live') || args.length === 0;
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
  const urlsIdx = args.indexOf('--urls');
  const urls = urlsIdx !== -1 && args[urlsIdx + 1]
    ? args[urlsIdx + 1].split(',').map((u) => u.trim()).filter(Boolean)
    : DEFAULT_PRODUCTION_URLS;

  if (!liveMode) {
    console.error('Pass --live to probe production custom domains.');
    process.exit(2);
  }

  const results = [];
  for (let i = 0; i < urls.length; i += 4) {
    const batch = urls.slice(i, i + 4);
    const batchResults = await Promise.all(batch.map((u) => auditUrl(u)));
    results.push(...batchResults);
  }

  results.sort((a, b) => b.score - a.score);
  const payload = { generatedAt: new Date().toISOString(), count: results.length, results };
  const output = jsonMode
    ? JSON.stringify(payload, null, 2)
    : formatScorecardMarkdown(results, { generatedAt: payload.generatedAt });

  if (outPath) {
    await writeFile(outPath, output, 'utf8');
  }
  console.log(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
