import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mergeConfig, build as viteBuild } from 'vite';
import { createViteConfig } from '../vite/config.ts';

export interface ExportHtmlOptions {
  cwd?: string;
  outFile?: string;
  base?: string;
}

export async function exportHtml(opts: ExportHtmlOptions = {}): Promise<{ outFile: string }> {
  const cwd = opts.cwd ?? process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'open-slide-export-'));
  try {
    const config = mergeConfig(await createViteConfig({ userCwd: cwd, mode: 'build' }), {
      build: {
        outDir: path.join(tempDir, 'dist'),
        // inline every asset as a data URL so nothing references emitted files
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
          },
        },
      },
    });
    // override base after merge — mergeConfig does not always override it
    if (opts.base !== undefined) {
      config.base = opts.base;
    } else {
      config.base = '/';
    }
    await viteBuild(config);
    const outFile = path.resolve(cwd, opts.outFile ?? 'export.html');
    let html = await inlineAssets(path.join(tempDir, 'dist'));
    // prepend a script that resets the URL pathname to "/" before the SPA initializes
    // so that the SPA's client-side router doesn't try to match the export file's path
    html = html.replace('<head>', '<head><script>history.replaceState(null,"","/")</script>');
    await writeFile(outFile, html);
    return { outFile };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const MIME_BY_EXT: Record<string, string> = {
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function inlineAssets(outDir: string): Promise<string> {
  let html = await readFile(path.join(outDir, 'index.html'), 'utf8');
  html = await inlineBundles(html, outDir);
  html = await inlineResidualRefs(html, outDir);
  return html;
}

/** Strip leading slash so path.join produces a correct relative path. */
function relPath(outDir: string, file: string): string {
  return path.join(outDir, file.startsWith('/') ? file.slice(1) : file);
}

async function inlineBundles(html: string, outDir: string): Promise<string> {
  const scripts = html.match(/<script\b(?=[^>]*\bsrc=")[^>]*>[\s\S]*?<\/script>/g) ?? [];
  const styles = html.match(/<link\b(?=[^>]*\brel="stylesheet")[^>]*>/g) ?? [];
  let result = html;
  for (const tag of scripts) {
    const file = tag.match(/\bsrc="([^"]+)"/)?.[1];
    if (!file) continue;
    const content = await readFile(relPath(outDir, file), 'utf8');
    // replacement function: a string replacement would re-interpret `$&`/`$'`/`$$` inside the bundle
    result = result.replace(
      tag,
      () => `<script type="module">${escapeClosingTag(content)}</script>`,
    );
  }
  for (const tag of styles) {
    const file = tag.match(/\bhref="([^"]+)"/)?.[1];
    if (!file) continue;
    const content = await readFile(relPath(outDir, file), 'utf8');
    result = result.replace(tag, () => `<style>${escapeClosingTag(content)}</style>`);
  }
  return result;
}

async function inlineResidualRefs(html: string, outDir: string): Promise<string> {
  const refs = html.match(/<(?:link|script)\b(?=[^>]*\b(?:href|src)=")[^>]*>/g) ?? [];
  let result = html;
  for (const tag of refs) {
    const ref = tag.match(/\b(?:href|src)="([^"]+)"/)?.[1];
    if (!ref) continue;
    const ext = path.extname(ref).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) continue;
    const content = await readFile(relPath(outDir, ref)).catch(() => null);
    if (content === null) continue;
    const data =
      mime.startsWith('text/') || ext === '.svg'
        ? `data:${mime},${encodeURIComponent(content.toString('utf8'))}`
        : `data:${mime};base64,${content.toString('base64')}`;
    result = result.replace(tag, () => tag.replace(/\b(?:href|src)="[^"]*"/, `="${data}"`));
  }
  return result;
}

function escapeClosingTag(content: string): string {
  return content.replace(/<\/(script|style)>/gi, '<\\/$1>');
}
