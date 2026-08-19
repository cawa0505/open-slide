import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeWorkspaceResolver, PreviewSessionManager } from '../src/index.ts';

const TOKEN = 'test-token';
const PUBLIC_BASE = 'http://localhost:3100';

async function startTestServer(opts?: {
  maxConcurrentPreviews?: number;
  artifactTtlMs?: number;
  maxArtifactBytes?: number;
}) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'open-slide-mcp-ws-'));
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'open-slide-mcp-art-'));
  const { createRemoteServer } = await import('../src/index.ts');
  const remote = await createRemoteServer({
    token: TOKEN,
    workspaceRoot,
    publicBaseUrl: PUBLIC_BASE,
    artifactsDir,
    ...opts,
  });
  await new Promise<void>((resolve) => remote.httpServer.listen(0, resolve));
  const port = (remote.httpServer.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  return { remote, base, workspaceRoot, artifactsDir };
}

function fetchJson(base: string, url: string, token?: string) {
  return fetch(base + url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

describe('remote HTTP server', () => {
  it('serves /health without authentication', async () => {
    const { remote, base } = await startTestServer();
    try {
      const res = await fetchJson(base, '/health');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    } finally {
      remote.httpServer.close();
    }
  });

  it('rejects missing and wrong bearer tokens', async () => {
    const { remote, base } = await startTestServer();
    try {
      expect((await fetchJson(base, '/mcp')).status).toBe(401);
      expect((await fetchJson(base, '/mcp', 'wrong')).status).toBe(401);
      expect((await fetchJson(base, '/artifact/whatever')).status).toBe(401);
    } finally {
      remote.httpServer.close();
    }
  });

  it('exposes seven tools in remote mode', async () => {
    const { remote, base } = await startTestServer();
    try {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/streamableHttp.js'
      );
      const client = new Client({ name: 'test', version: '0.0.1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL('/mcp', base), {
          requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
        }),
      );
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'open_slide_build',
        'open_slide_dev',
        'open_slide_export_html',
        'open_slide_init',
        'open_slide_preview',
        'open_slide_stop_preview',
        'open_slide_sync_skills',
      ]);
      await client.close();
    } finally {
      remote.httpServer.close();
    }
  });

  it('rejects paths escaping the workspace root', async () => {
    const { remote } = await startTestServer();
    try {
      const resolveDir = makeWorkspaceResolver('/tmp/ws');
      expect(() => resolveDir('../../etc')).toThrow(/escapes the workspace/);
      expect(() => resolveDir('/etc/passwd')).toThrow(/escapes the workspace/);
      expect(resolveDir('ok')).toBe('/tmp/ws/ok');
      expect(resolveDir()).toBe('/tmp/ws');
    } finally {
      remote.httpServer.close();
    }
  });

  it('stores and streams artifact downloads', async () => {
    const { remote, base, artifactsDir } = await startTestServer();
    try {
      const src = path.join(artifactsDir, 'src.html');
      await writeFile(src, '<html>hello</html>');
      const info = await remote.artifacts.store(src, {
        filename: 'deck.html',
        mediaType: 'text/html',
      });
      expect(info.url).toBe(`${PUBLIC_BASE}/artifact/${info.id}`);
      expect(info.sha256).toMatch(/^[0-9a-f]{64}$/);

      const res = await fetchJson(base, `/artifact/${info.id}`, TOKEN);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html');
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="deck.html"');
      expect(await res.text()).toBe('<html>hello</html>');

      expect((await fetchJson(base, '/artifact/not-a-real-id', TOKEN)).status).toBe(404);
    } finally {
      remote.httpServer.close();
    }
  });

  it('enforces artifact size limits and expiry', async () => {
    const { remote, base, artifactsDir } = await startTestServer({
      maxArtifactBytes: 8,
      artifactTtlMs: 1,
    });
    try {
      const src = path.join(artifactsDir, 'too-big.html');
      await writeFile(src, '<html>this is way over eight bytes</html>');
      await expect(
        remote.artifacts.store(src, { filename: 'deck.html', mediaType: 'text/html' }),
      ).rejects.toThrow(/byte limit/);

      const small = path.join(artifactsDir, 'small.html');
      await writeFile(small, 'tiny');
      const info = await remote.artifacts.store(small, {
        filename: 's.html',
        mediaType: 'text/html',
      });
      await new Promise((r) => setTimeout(r, 5));
      expect((await fetchJson(base, `/artifact/${info.id}`, TOKEN)).status).toBe(404);
    } finally {
      remote.httpServer.close();
    }
  });

  it('proxies preview sessions and honors the TTL + concurrency limits', async () => {
    const { remote } = await startTestServer({ maxConcurrentPreviews: 2 });
    try {
      const manager = new PreviewSessionManager({
        publicBaseUrl: 'https://host/sub',
        ttlMs: 60_000,
        maxConcurrent: 2,
      });
      const session = await manager.start(async ({ base: vBase }) => ({
        url: `http://127.0.0.1:1${vBase}`,
        port: 1,
        close: async () => undefined,
      }));
      expect(session.url).toMatch(/^https:\/\/host\/sub\/preview\/[0-9a-f-]+\/$/);
      await manager.start(async ({ base: vBase }) => ({
        url: `http://127.0.0.1:1${vBase}`,
        port: 1,
        close: async () => undefined,
      }));
      await expect(
        manager.start(async ({ base: vBase }) => ({
          url: `http://127.0.0.1:1${vBase}`,
          port: 1,
          close: async () => undefined,
        })),
      ).rejects.toThrow(/too many preview sessions/);
      await manager.stopAll();
      expect(manager.activeCount).toBe(0);
    } finally {
      remote.httpServer.close();
    }
  });
});
