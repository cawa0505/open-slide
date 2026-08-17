import path from 'node:path';
import { mergeConfig, build as viteBuild } from 'vite';
import { createViteConfig } from '../vite/config.ts';

export interface BuildOptions {
  outDir?: string;
  cwd?: string;
  base?: string;
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
}
