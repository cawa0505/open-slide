#!/usr/bin/env node
import crypto from 'node:crypto';
import { createReadStream, realpathSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { init } from '@open-slide/cli';
import {
  build,
  detectSkillsDrift,
  exportHtml,
  type RunningServer,
  resolveBuiltinSkillsDir,
  startDevServer,
  startPreviewServer,
  syncSkills,
} from '@open-slide/core/cli';
import { z } from 'zod';

function toolError(toolName: string, error: unknown): never {
  throw new Error(`${toolName} failed: ${error instanceof Error ? error.message : String(error)}`);
}

function jsonBody(
  status: number,
  body: unknown,
): { statusCode: number; headers: Record<string, string>; body: string } {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function isEntryPoint(moduleUrl: string, entryPath: string): boolean {
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(path.resolve(entryPath));
  } catch {
    return false;
  }
}

interface ArtifactInfo {
  id: string;
  url: string;
  filename: string;
  mediaType: string;
  size: number;
  sha256: string;
  expiresAt: number;
}

interface ArtifactStoreOptions {
  storeDir: string;
  publicBaseUrl: string;
  ttlMs: number;
  maxArtifactBytes: number;
  maxTotalBytes: number;
  now?: () => number;
}

export class ArtifactStore {
  private readonly now: () => number;
  constructor(private readonly opts: ArtifactStoreOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  async store(
    sourcePath: string,
    meta: { filename: string; mediaType: string },
  ): Promise<ArtifactInfo> {
    await mkdir(this.opts.storeDir, { recursive: true });
    const { size } = await stat(sourcePath);
    if (size > this.opts.maxArtifactBytes) {
      throw new Error(`artifact exceeds the ${this.opts.maxArtifactBytes} byte limit`);
    }
    const running = await this.totalBytes();
    if (running + size > this.opts.maxTotalBytes) {
      throw new Error('artifact storage total limit exceeded');
    }
    const id = crypto.randomUUID();
    const dest = path.join(this.opts.storeDir, id);
    await copyFile(sourcePath, dest);
    const sha256 = await this.digest(dest);
    const info: ArtifactInfo = {
      id,
      url: `${this.opts.publicBaseUrl.replace(/\/$/, '')}/artifact/${id}`,
      filename: meta.filename,
      mediaType: meta.mediaType,
      size,
      sha256,
      expiresAt: this.now() + this.opts.ttlMs,
    };
    await writeFile(`${dest}.meta.json`, JSON.stringify(info), 'utf8');
    return info;
  }

  async resolve(id: string): Promise<{ info: ArtifactInfo; filePath: string } | null> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const filePath = path.join(this.opts.storeDir, id);
    const metaPath = `${filePath}.meta.json`;
    let info: ArtifactInfo;
    try {
      info = JSON.parse(await readFile(metaPath, 'utf8')) as ArtifactInfo;
    } catch {
      return null;
    }
    if (this.now() >= info.expiresAt) {
      await this.remove(id).catch(() => undefined);
      return null;
    }
    return { info, filePath };
  }

  async download(res: ServerResponse, id: string): Promise<void> {
    const found = await this.resolve(id);
    if (!found) {
      const { statusCode, headers, body } = jsonBody(404, {
        error: 'artifact not found or expired',
      });
      res.writeHead(statusCode, headers);
      res.end(body);
      return;
    }
    const { size } = await stat(found.filePath);
    res.writeHead(200, {
      'Content-Type': found.info.mediaType,
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${found.info.filename.replace(/"/g, '')}"`,
    });
    await pipeline(createReadStream(found.filePath), res).catch(() => undefined);
  }

  async cleanupExpired(): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await readdir(this.opts.storeDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (!name.endsWith('.meta.json')) continue;
      const id = name.slice(0, -'.meta.json'.length);
      try {
        const info = JSON.parse(
          await readFile(path.join(this.opts.storeDir, name), 'utf8'),
        ) as ArtifactInfo;
        if (this.now() >= info.expiresAt) await this.remove(id);
      } catch {
        /* corrupt entry — leave for manual cleanup */
      }
    }
  }

  private async totalBytes(): Promise<number> {
    let entries: string[] = [];
    try {
      entries = await readdir(this.opts.storeDir);
    } catch {
      return 0;
    }
    let total = 0;
    for (const name of entries) {
      if (!name.endsWith('.meta.json')) continue;
      try {
        const info = JSON.parse(
          await readFile(path.join(this.opts.storeDir, name), 'utf8'),
        ) as ArtifactInfo;
        if (this.now() < info.expiresAt) total += info.size;
      } catch {
        /* ignore unreadable sidecars */
      }
    }
    return total;
  }

  private async remove(id: string): Promise<void> {
    await unlink(path.join(this.opts.storeDir, id)).catch(() => undefined);
    await unlink(path.join(this.opts.storeDir, `${id}.meta.json`)).catch(() => undefined);
  }

  private async digest(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    await pipeline(createReadStream(filePath), hash);
    return hash.digest('hex');
  }
}

export interface PreviewSession {
  id: string;
  url: string;
  expiresAt: number;
  server: RunningServer;
}

export interface PreviewSessionManagerOptions {
  publicBaseUrl: string;
  ttlMs: number;
  maxConcurrent: number;
}

export class PreviewSessionManager {
  private readonly sessions = new Map<string, PreviewSession & { timer: NodeJS.Timeout }>();
  constructor(private readonly opts: PreviewSessionManagerOptions) {}

  get activeCount(): number {
    return this.sessions.size;
  }

  async start(spawn: (opts: { base: string }) => Promise<RunningServer>): Promise<PreviewSession> {
    if (this.sessions.size >= this.opts.maxConcurrent) {
      throw new Error(`too many preview sessions (max ${this.opts.maxConcurrent})`);
    }
    const id = crypto.randomUUID();
    const url = `${this.opts.publicBaseUrl.replace(/\/$/, '')}/preview/${id}/`;
    const server = await spawn({ base: new URL(url).pathname });
    const expiresAt = Date.now() + this.opts.ttlMs;
    const timer = setTimeout(() => this.stop(id).catch(() => undefined), this.opts.ttlMs);
    timer.unref?.();
    const session = { id, url, expiresAt, server, timer };
    this.sessions.set(id, session);
    return { id, url, expiresAt, server };
  }

  async stop(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.sessions.delete(id);
    clearTimeout(session.timer);
    await session.server.close().catch(() => undefined);
    return true;
  }

  async proxy(res: ServerResponse, req: IncomingMessage): Promise<void> {
    const pathname = new URL(req.url ?? '/', 'http://internal').pathname;
    const segments = pathname.split('/').filter(Boolean);
    const id = segments[1] ?? '';
    const session = this.sessions.get(id);
    if (!session || Date.now() >= session.expiresAt) {
      const { statusCode, headers, body } = jsonBody(404, {
        error: 'preview session not found or expired',
      });
      res.writeHead(statusCode, headers);
      res.end(body);
      return;
    }
    const base = new URL(session.server.url);
    const rest = pathname.slice(`/preview/${id}`.length);
    const targetPath = rest === '' ? base.pathname : `${base.pathname.replace(/\/$/, '')}${rest}`;
    const search = (req.url ?? '').split('?')[1];
    const target = `${base.origin}${targetPath}${search ? `?${search}` : ''}`;
    const upstream = http.request(target, { method: req.method, headers: req.headers });
    upstream.on('response', (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'preview server unreachable' }));
    });
    req.pipe(upstream);
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.stop(id);
  }
}

export interface ToolContext {
  resolveDir: (dir?: string) => string;
  artifacts?: ArtifactStore;
  preview?: PreviewSessionManager;
}

export function makeWorkspaceResolver(workspaceRoot: string): (dir?: string) => string {
  const resolvedRoot = path.resolve(workspaceRoot);
  return (dir?: string) => {
    const target = path.resolve(resolvedRoot, dir ?? '.');
    if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`path escapes the workspace root: ${dir ?? '.'}`);
    }
    return target;
  };
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'open_slide_init',
    {
      description: 'Scaffold a new open-slide slides workspace.',
      inputSchema: {
        dir: z
          .string()
          .optional()
          .describe('Directory to scaffold into (default: current working directory)'),
        force: z.boolean().optional().describe('Overwrite existing files'),
        name: z.string().optional().describe('Project name'),
        install: z.boolean().optional().describe('Install dependencies after scaffolding'),
        git: z.boolean().optional().describe('Initialize a git repository'),
        packageManager: z
          .enum(['npm', 'pnpm', 'yarn', 'bun'])
          .optional()
          .describe('Package manager to use'),
      },
    },
    async (args) => {
      try {
        const dir = ctx.resolveDir(args.dir);
        await init({
          dir,
          force: args.force ?? false,
          name: args.name,
          install: args.install ?? true,
          git: args.git ?? true,
          packageManager: args.packageManager ?? 'npm',
        });
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, dir }) }] };
      } catch (error) {
        toolError('open_slide_init', error);
      }
    },
  );

  server.registerTool(
    'open_slide_build',
    {
      description: 'Build an open-slide workspace into a static SPA.',
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe('Workspace directory (default: current working directory)'),
        outDir: z.string().optional().describe('Output directory (default: dist)'),
        base: z.string().optional().describe('Base path for asset URLs (e.g. "/deck/")'),
        route: z
          .string()
          .optional()
          .describe(
            'SPA route to force at load (e.g. "/deck/s/slide-id"). Injects history.replaceState into built index.html so subdirectory-deployed decks boot into the presentation.',
          ),
      },
    },
    async (args) => {
      try {
        const cwd = ctx.resolveDir(args.cwd);
        await build({ cwd, outDir: args.outDir, base: args.base, route: args.route });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, outDir: path.resolve(cwd, args.outDir ?? 'dist') }),
            },
          ],
        };
      } catch (error) {
        toolError('open_slide_build', error);
      }
    },
  );

  server.registerTool(
    'open_slide_export_html',
    {
      description: 'Build an open-slide workspace and export a single self-contained HTML file.',
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe('Workspace directory (default: current working directory)'),
        outFile: z.string().optional().describe('Output file path (default: export.html)'),
        base: z.string().optional().describe('Base path for asset URLs (e.g. "/deck/")'),
      },
    },
    async (args) => {
      try {
        const cwd = ctx.resolveDir(args.cwd);
        const { outFile } = await exportHtml({ cwd, outFile: args.outFile, base: args.base });
        if (!ctx.artifacts) {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, outFile }) }] };
        }
        const artifact = await ctx.artifacts.store(outFile, {
          filename: path.basename(outFile),
          mediaType: 'text/html',
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, outFile, artifact }) }],
        };
      } catch (error) {
        toolError('open_slide_export_html', error);
      }
    },
  );

  server.registerTool(
    'open_slide_sync_skills',
    {
      description:
        'Sync built-in agent skills from @open-slide/core into the workspace (.agents/skills).',
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe('Workspace directory (default: current working directory)'),
        dryRun: z.boolean().optional().describe('Report drift without writing files'),
      },
    },
    async (args) => {
      try {
        const cwd = ctx.resolveDir(args.cwd);
        const skillsDir = resolveBuiltinSkillsDir();
        const drift = await detectSkillsDrift(skillsDir, cwd);
        if (args.dryRun) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, dryRun: true, drift }) }],
          };
        }
        await syncSkills(skillsDir, { cwd });
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, drift }) }] };
      } catch (error) {
        toolError('open_slide_sync_skills', error);
      }
    },
  );

  if (!ctx.preview) return;
  const preview = ctx.preview;

  const serverShape = {
    cwd: z.string().optional().describe('Workspace directory (default: workspace root)'),
    port: z.number().int().positive().optional().describe('Port for the local server'),
    host: z
      .union([z.string(), z.boolean()])
      .optional()
      .describe('Host for the local server (default: localhost)'),
  };

  server.registerTool(
    'open_slide_preview',
    {
      description: 'Build a workspace and start a preview session behind the MCP server.',
      inputSchema: serverShape,
    },
    async (args) => {
      try {
        const cwd = ctx.resolveDir(args.cwd);
        const session = await preview.start(async ({ base }) => {
          await build({ cwd, base });
          return startPreviewServer({
            cwd,
            port: args.port,
            host: args.host,
            base,
          });
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: true,
                sessionId: session.id,
                url: session.url,
                expiresAt: session.expiresAt,
              }),
            },
          ],
        };
      } catch (error) {
        toolError('open_slide_preview', error);
      }
    },
  );

  server.registerTool(
    'open_slide_dev',
    {
      description: 'Start a dev server session behind the MCP server (hot reload).',
      inputSchema: serverShape,
    },
    async (args) => {
      try {
        const cwd = ctx.resolveDir(args.cwd);
        const session = await preview.start(async ({ base }) =>
          startDevServer({
            cwd,
            port: args.port,
            host: args.host,
            base,
          }),
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: true,
                sessionId: session.id,
                url: session.url,
                expiresAt: session.expiresAt,
              }),
            },
          ],
        };
      } catch (error) {
        toolError('open_slide_dev', error);
      }
    },
  );

  server.registerTool(
    'open_slide_stop_preview',
    {
      description: 'Stop a running preview or dev session by id.',
      inputSchema: {
        sessionId: z
          .string()
          .describe('Session id returned by open_slide_preview or open_slide_dev'),
      },
    },
    async (args) => {
      try {
        const stopped = await preview.stop(args.sessionId);
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: stopped, stopped }) }],
        };
      } catch (error) {
        toolError('open_slide_stop_preview', error);
      }
    },
  );
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'open-slide', version: '0.1.0' });
  registerTools(server, { resolveDir: (dir) => path.resolve(dir ?? process.cwd()) });
  return server;
}

export interface RemoteServerOptions {
  token: string;
  workspaceRoot: string;
  publicBaseUrl: string;
  previewTtlMs?: number;
  artifactTtlMs?: number;
  maxConcurrentPreviews?: number;
  maxArtifactBytes?: number;
  maxTotalArtifactBytes?: number;
  artifactsDir?: string;
}

export interface RemoteServer {
  httpServer: Server;
  preview: PreviewSessionManager;
  artifacts: ArtifactStore;
}

export async function createRemoteServer(options: RemoteServerOptions): Promise<RemoteServer> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const storeDir =
    options.artifactsDir ?? (await mkdtemp(path.join(os.tmpdir(), 'open-slide-artifacts-')));
  const artifacts = new ArtifactStore({
    storeDir,
    publicBaseUrl: options.publicBaseUrl,
    ttlMs: options.artifactTtlMs ?? 24 * 60 * 60 * 1000,
    maxArtifactBytes: options.maxArtifactBytes ?? 50 * 1024 * 1024,
    maxTotalBytes: options.maxTotalArtifactBytes ?? 200 * 1024 * 1024,
  });
  const preview = new PreviewSessionManager({
    publicBaseUrl: options.publicBaseUrl,
    ttlMs: options.previewTtlMs ?? 30 * 60 * 1000,
    maxConcurrent: options.maxConcurrentPreviews ?? 5,
  });
  const resolveDir = makeWorkspaceResolver(workspaceRoot);

  const handleMcpRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const server = new McpServer({ name: 'open-slide', version: '0.1.0' });
    registerTools(server, { resolveDir, artifacts, preview });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    try {
      await transport.handleRequest(req, res);
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  };

  const validToken = (req: IncomingMessage): boolean => {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
    const supplied = Buffer.from(header.slice(7));
    const expected = Buffer.from(options.token);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  };

  const httpServer = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://internal').pathname;
    if (req.method === 'GET' && pathname === '/health') {
      const { statusCode, headers, body } = jsonBody(200, { status: 'ok' });
      res.writeHead(statusCode, headers);
      res.end(body);
      return;
    }
    if (!validToken(req)) {
      const { statusCode, headers, body } = jsonBody(401, { error: 'unauthorized' });
      res.writeHead(statusCode, headers);
      res.end(body);
      return;
    }
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      handleMcpRequest(req, res).catch((error) => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        if (!res.writableEnded) res.end(JSON.stringify({ error: String(error) }));
      });
      return;
    }
    if (pathname.startsWith('/preview/')) {
      preview.proxy(res, req).catch(() => undefined);
      return;
    }
    if (pathname.startsWith('/artifact/')) {
      artifacts.download(res, pathname.slice('/artifact/'.length)).catch(() => undefined);
      return;
    }
    const { statusCode, headers, body } = jsonBody(404, { error: 'not found' });
    res.writeHead(statusCode, headers);
    res.end(body);
  });

  return { httpServer, preview, artifacts };
}

export async function main(): Promise<void> {
  const remoteToken = process.env.OPEN_SLIDE_REMOTE_TOKEN;
  if (!remoteToken) {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }
  const publicBaseUrl = process.env.OPEN_SLIDE_PUBLIC_BASE_URL;
  const workspaceRoot = process.env.OPEN_SLIDE_WORKSPACE_ROOT;
  if (!publicBaseUrl || !workspaceRoot) {
    console.error(
      'OPEN_SLIDE_PUBLIC_BASE_URL and OPEN_SLIDE_WORKSPACE_ROOT are required for remote mode.',
    );
    process.exit(1);
  }
  const remote = await createRemoteServer({ token: remoteToken, workspaceRoot, publicBaseUrl });
  await remote.artifacts.cleanupExpired();
  const port = Number(process.env.OPEN_SLIDE_REMOTE_PORT ?? 3100);
  await new Promise<void>((resolve) => remote.httpServer.listen(port, resolve));
  console.log(`open-slide remote MCP listening on :${port} (public base ${publicBaseUrl})`);

  const shutdown = async () => {
    remote.httpServer.close();
    await remote.preview.stopAll();
    await remote.artifacts.cleanupExpired();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
