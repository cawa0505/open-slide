# open-slide (MCP fork)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**open-slide with an MCP server.** This fork adds `@open-slide/mcp` on top of the upstream [open-slide](https://github.com/1weiho/open-slide) framework, so an agent can scaffold, build, and export decks directly through Model Context Protocol.

The deck runtime itself is unchanged upstream — this branch tracks [upstream `main`](https://github.com/1weiho/open-slide) and layers the MCP tooling on top (see [UPSTREAM_SYNC.md](UPSTREAM_SYNC.md)).

---

## 🤖 MCP tools

Expose slide automation to any MCP client (Claude Code, Cursor, …) via stdio or authenticated HTTP.

| Tool | Description |
| --- | --- |
| `open_slide_init` | Scaffold a new open-slide workspace |
| `open_slide_build` | Build a workspace into a static SPA |
| `open_slide_export_html` | Build and export a single self-contained HTML file |
| `open_slide_sync_skills` | Sync built-in agent skills into the workspace (`.agents/skills`) |

### Configure

Build and install the CLI:

```bash
git clone https://github.com/cawa0505/open-slide.git
cd open-slide
pnpm install
pnpm build
pnpm mcp:install
```

```json
{
  "mcpServers": {
    "open-slide": {
      "command": "open-slide-mcp"
    }
  }
}
```

### Remote server

Run the MCP server over Streamable HTTP when the client and slide workspace are on different machines. The server requires a bearer token, an explicit workspace root, and a public base URL for preview and artifact links:

```bash
OPEN_SLIDE_REMOTE_TOKEN='replace-me' \
OPEN_SLIDE_PUBLIC_BASE_URL='https://slides.example.com' \
OPEN_SLIDE_WORKSPACE_ROOT='/workspace/slides' \
OPEN_SLIDE_REMOTE_PORT=3100 \
open-slide-mcp
```

Put the service behind HTTPS and inject the token through the MCP client's `Authorization: Bearer ...` header. Remote filesystem paths are restricted to `OPEN_SLIDE_WORKSPACE_ROOT`; preview sessions and downloadable artifacts expire automatically. The normal `open_slide_build` result remains a complete `dist/` directory, while `open_slide_export_html` can return a self-contained HTML artifact.

### Example agent flow

1. `open_slide_init` — scaffold `my-deck`
2. agent writes slides in `slides/<id>/index.tsx`
3. `open_slide_build` — verify the build
4. `open_slide_export_html` — produce a shareable single-file export

---

## About open-slide

**The slide framework built for agents.** Describe your deck in natural language — your coding agent writes the React. open-slide handles the canvas, scaling, navigation, hot reload, and present mode so the agent can focus on content.

Every slide renders into a fixed **1920 × 1080** canvas. Pages are arbitrary React components, not a constrained DSL.

- 🤖 **Agent-native authoring** — ships with `/create-slide` and `/slide-authoring` skills
- 🎯 **In-browser inspector** — click to attach comments, apply them via `/apply-comments`
- 🎬 **Professional present mode** — presenter view, speaker notes, timer
- 📦 **Static export** — deploy to Vercel, Cloudflare Pages, Netlify, or any static host

```bash
npx @open-slide/cli init my-slide
cd my-slide
pnpm dev
```

## Repo layout

| Path | Description |
| --- | --- |
| [packages/core](packages/core) | `@open-slide/core` — runtime + `open-slide` dev/build/preview CLI |
| [packages/cli](packages/cli) | `@open-slide/cli` — scaffolder |
| [packages/mcp](packages/mcp) | `@open-slide/mcp` — **this fork's addition**: MCP server |
| [apps/demo](apps/demo) | Example workspace for local development |

## Development

```bash
pnpm install
pnpm dev      # runs the demo against the local @open-slide/core
pnpm build    # builds all packages
pnpm check    # biome format + lint
pnpm typecheck
pnpm test     # vitest (root config)
```

## License

MIT
