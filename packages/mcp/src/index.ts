#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { init } from '@open-slide/cli';
import {
  build,
  detectSkillsDrift,
  exportHtml,
  resolveBuiltinSkillsDir,
  syncSkills,
} from '@open-slide/core/cli';
import { z } from 'zod';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'open-slide',
    version: '0.1.0',
  });

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
        const dir = path.resolve(args.dir ?? process.cwd());
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
        throw new Error(
          `open_slide_init failed: ${error instanceof Error ? error.message : error}`,
        );
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
        base: z
          .string()
          .optional()
          .describe('Base path for asset URLs (e.g. "/deck/")'),
        route: z
          .string()
          .optional()
          .describe('SPA route to force at load (e.g. "/deck/s/slide-id"). Injects history.replaceState into built index.html so subdirectory-deployed decks boot into the presentation.'),
      },
    },
    async (args) => {
      try {
        const cwd = args.cwd ?? process.cwd();
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
        throw new Error(
          `open_slide_build failed: ${error instanceof Error ? error.message : error}`,
        );
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
        base: z
          .string()
          .optional()
          .describe('Base path for asset URLs (e.g. "/deck/")'),
      },
    },
    async (args) => {
      try {
        const { outFile } = await exportHtml({ cwd: args.cwd, outFile: args.outFile, base: args.base });
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, outFile }) }] };
      } catch (error) {
        throw new Error(
          `open_slide_export_html failed: ${error instanceof Error ? error.message : error}`,
        );
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
        const cwd = args.cwd ?? process.cwd();
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
        throw new Error(
          `open_slide_sync_skills failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    },
  );

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function isEntryPoint(moduleUrl: string, entryPath: string | undefined): boolean {
  return (
    entryPath !== undefined &&
    realpathSync(fileURLToPath(moduleUrl)) === realpathSync(path.resolve(entryPath))
  );
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
