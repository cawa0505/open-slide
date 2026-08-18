import fs from 'node:fs/promises';
import path from 'node:path';
import { mergeConfig, build as viteBuild } from 'vite';
import { createViteConfig } from '../vite/config.ts';

export interface BuildOptions {
  outDir?: string;
  cwd?: string;
  base?: string;
  /**
   * SPA route to force at load, e.g. "/deck/s/slide-id".
   * Injects `history.replaceState(null, "", "<route>")` into the built
   * index.html so a deck deployed under a subdirectory (Zola static embed)
   * boots directly into the presentation instead of the editor home.
   * Survives rebuilds — the previous manual post-build patch did not.
   */
  route?: string;
}

export async function build(opts: BuildOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const viteConfig = await createViteConfig({ userCwd: cwd, mode: 'build' });
  const config = mergeConfig(viteConfig, {
    ...(opts.base !== undefined ? { base: opts.base } : {}),
    build: {
      ...(opts.outDir !== undefined ? { outDir: path.resolve(cwd, opts.outDir) } : {}),
    },
  });
  await viteBuild(config);

  if (opts.route !== undefined) {
    const indexHtml = path.resolve(cwd, opts.outDir ?? 'dist', 'index.html');
    await injectRouteBootstrap(indexHtml, opts.route);
  }
}

// injectRouteBootstrap rewrites dist/index.html to force a client-side route
// on load. The replaceState script must run before the module script.
async function injectRouteBootstrap(indexHtml: string, route: string): Promise<void> {
  const html = await fs.readFile(indexHtml, 'utf8');
  const marker = `history.replaceState(null,"","${route}")`;
  if (html.includes(marker)) {
    return; // already injected (idempotent)
  }
  const script = `<script>${marker}</script>`;
  const updated = html.replace(/<script type="module"/, `${script}\n    <script type="module"`);
  if (updated === html) {
    throw new Error(`route injection failed: no module script tag found in ${indexHtml}`);
  }
  await fs.writeFile(indexHtml, updated, 'utf8');
}
