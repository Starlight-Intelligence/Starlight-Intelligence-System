import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
const binary = path.join(directory, 'node_modules', '@starlight-intelligence', 'memory', 'bin', 'starlight-memory.mjs');
const home = await mkdtemp(path.join(tmpdir(), 'starlight-community-'));
const vault = path.join(home, 'vault');

async function withClient(profile, check) {
  const client = new Client({ name: 'community-install-check', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    cwd: directory,
    args: [binary, 'mcp', 'serve', '--vault', vault, '--tenant', 'demo', '--embeddings', 'off', '--profile', profile],
    env: { HOME: home, USERPROFILE: home },
  });
  try {
    await client.connect(transport);
    await check(client);
  } finally {
    await client.close();
  }
}

try {
  await mkdir(vault, { mode: 0o700 });
  await withClient('writes', async client => {
    const write = await client.callTool({
      name: 'memory_remember',
      arguments: {
        summary: 'Amber Lantern chose Juniper as its fictional milestone.',
        content: 'The synthetic project milestone is Juniper.',
        privacy_class: 'private',
      },
    });
    assert.ok(!write.isError, 'Synthetic write failed');
  });
  await withClient('reads', async client => {
    const { tools } = await client.listTools();
    assert.ok(tools.some(tool => tool.name === 'memory_recall'));
    assert.ok(!tools.some(tool => tool.name === 'memory_remember'));
    const result = await client.callTool({ name: 'memory_recall', arguments: { query: 'Amber Lantern' } });
    assert.ok(!result.isError, 'Recall failed');
    assert.match(JSON.stringify(result.content), /Juniper/, 'Expected the stored milestone after restart');
  });
  console.log('PASS: the published package recalled the synthetic milestone after a read-only restart.');
} finally {
  await rm(home, { recursive: true, force: true });
}
