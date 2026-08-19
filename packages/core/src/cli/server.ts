import { mergeConfig, createServer as viteCreateServer, preview as vitePreview } from 'vite';
import { createViteConfig } from '../vite/config.ts';

export interface RunningServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

interface LiveServer {
  httpServer: { address(): { port: number; address: string } | string | null } | null;
  resolvedUrls: { local: string[]; network: string[] } | null;
  close(): Promise<void>;
}

function displayHost(host: string): string {
  return host === '0.0.0.0' || host === '::' || host === '::0' ? 'localhost' : host;
}

function describeServer(
  server: LiveServer,
  fallback: { port?: number; host?: string | boolean },
): RunningServer {
  const address = server.httpServer?.address();
  const resolved = server.resolvedUrls;
  const port = typeof address === 'object' && address ? address.port : (fallback.port ?? 5173);
  const url =
    resolved?.local[0] ??
    resolved?.network[0] ??
    `http://${typeof address === 'object' && address ? displayHost(address.address) : 'localhost'}:${port}/`;
  return { url, port, close: () => server.close() };
}

/** Serves a previously built `dist/` — run `build()` first. */
export async function startPreviewServer(opts: {
  cwd?: string;
  port?: number;
  host?: string | boolean;
  base?: string;
}): Promise<RunningServer> {
  const config = mergeConfig(await createViteConfig({ userCwd: opts.cwd ?? process.cwd() }), {
    preview: {
      ...(opts.port !== undefined ? { port: opts.port } : {}),
      ...(opts.host !== undefined ? { host: opts.host } : {}),
    },
    ...(opts.base !== undefined ? { base: opts.base } : {}),
  });
  const server = await vitePreview(config);
  return describeServer(server, opts);
}

export async function startDevServer(opts: {
  cwd?: string;
  port?: number;
  host?: string | boolean;
  base?: string;
}): Promise<RunningServer> {
  const config = mergeConfig(await createViteConfig({ userCwd: opts.cwd ?? process.cwd() }), {
    server: {
      ...(opts.port !== undefined ? { port: opts.port } : {}),
      ...(opts.host !== undefined ? { host: opts.host } : {}),
    },
    ...(opts.base !== undefined ? { base: opts.base } : {}),
  });
  const server = await viteCreateServer(config);
  await server.listen();
  return describeServer(server, opts);
}
