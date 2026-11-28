import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeHtmlSurface,
  detectSlopSignals,
  formatScorecardMarkdown,
} from '../scripts/audit-production-surfaces.mjs';

const CLEAN_FLAGSHIP_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Turn one source into a week of content | GenCreator</title>
  <meta name="description" content="Bring material you own, inspect each draft and export a signed edition with zero lock-in." />
  <link rel="canonical" href="https://gencreator.ai/" />
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication"}</script>
</head>
<body>
  <main>
    <h1>Turn one source into signed drafts</h1>
    <p>Inspect claims, review every derivative and export cleanly.</p>
  </main>
</body>
</html>`;

const SLOP_TEMPLATE_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Next-Gen Revolutionary Game-Changer AI Platform</title>
</head>
<body>
  <h1>Imagine it. Build it. Witness it. And also unlock your infinite potential today across every channel</h1>
  <p>Most AI advice is noise. This is not just a tool, it's a paradigm shift that runs without you. Built after 40+ AI Centers of Excellence.</p>
  ${'<span>filler</span>'.repeat(20000)}
</body>
</html>`;

test('analyzeHtmlSurface scores a clean flagship surface high with zero slop flags', () => {
  const result = analyzeHtmlSurface(CLEAN_FLAGSHIP_HTML, {
    url: 'https://gencreator.ai',
    status: 200,
    ttfbMs: 180,
    ax: { llmsTxt: true, agentsMd: true, agentCard: true },
  });

  assert.equal(result.score, 100);
  assert.deepEqual(result.slopFlags, []);
  assert.equal(result.canonical, 'https://gencreator.ai/');
  assert.equal(result.jsonLdCount, 1);
  assert.equal(result.h1WordCount, 6);
});

test('detectSlopSignals catches AI clichés, retired claims, long H1, and oversized HTML', () => {
  const result = analyzeHtmlSurface(SLOP_TEMPLATE_HTML, {
    url: 'https://slop.example',
    status: 200,
    ttfbMs: 320,
    ax: { llmsTxt: false, agentsMd: false, agentCard: false },
  });

  const flagIds = result.slopFlags.map((f) => f.id);
  assert.ok(flagIds.includes('cliche-noise-opener'));
  assert.ok(flagIds.includes('cliche-runs-without-you'));
  assert.ok(flagIds.includes('cliche-triad-imagine'));
  assert.ok(flagIds.includes('cliche-game-changer'));
  assert.ok(flagIds.includes('cliche-unlock-your'));
  assert.ok(flagIds.includes('cliche-not-x-but-y'));
  assert.ok(flagIds.includes('retired-40-coes'));
  assert.ok(flagIds.includes('h1-too-long'));
  assert.ok(flagIds.includes('oversized-html'));
  assert.equal(result.breakdown.ax, 0);
  assert.ok(result.score < 35);
});

test('formatScorecardMarkdown renders domain table and detail section', () => {
  const clean = analyzeHtmlSurface(CLEAN_FLAGSHIP_HTML, {
    url: 'https://gencreator.ai',
    status: 200,
    ttfbMs: 120,
    ax: { llmsTxt: true, agentsMd: false, agentCard: true },
  });
  const md = formatScorecardMarkdown([clean], { generatedAt: '2026-11-28T01:00:00Z' });
  assert.match(md, /Production Surface Excellence & Anti-Slop Scorecard/);
  assert.match(md, /https:\/\/gencreator\.ai/);
  assert.match(md, /\*\*93\/100\*\*/);
});

test('detectSlopSignals catches concatenated Buildintelligence regression', () => {
  const flags = detectSlopSignals({
    title: 'FrankX',
    h1: 'Buildintelligence that compounds',
    visibleText: 'Hello world',
    htmlBytes: 1024,
  });
  assert.ok(flags.some((f) => f.id === 'bug-concatenated-h1'));
});
