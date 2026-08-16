import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer, isEntryPoint } from '../src/index.ts';

async function connect(): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), createServer().connect(serverTransport)]);
  return client;
}

describe('open-slide MCP server', () => {
  it('recognizes a symlinked CLI entry point', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'open-slide-mcp-entry-'));
    try {
      const entry = path.join(dir, 'index.js');
      const link = path.join(dir, 'open-slide-mcp');
      await writeFile(entry, '');
      await symlink(entry, link);
      expect(isEntryPoint(new URL(`file://${entry}`).href, link)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('registers all four tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'open_slide_build',
      'open_slide_export_html',
      'open_slide_init',
      'open_slide_sync_skills',
    ]);
  });

  it('open_slide_init scaffolds a workspace', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'open-slide-mcp-'));
    try {
      const client = await connect();
      const res = await client.callTool({
        name: 'open_slide_init',
        arguments: { dir, install: false, git: false },
      });
      const text = res.content[0].type === 'text' ? res.content[0].text : '';
      expect(JSON.parse(text)).toEqual({ ok: true, dir });
      expect(await readdir(path.join(dir, 'slides'))).not.toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
