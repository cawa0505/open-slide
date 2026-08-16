# @open-slide/mcp

MCP server for [open-slide](https://open-slide.dev) — lets Claude (or any MCP client) scaffold, build, export, and sync skills in slide workspaces.

## Tools

| Tool | Description |
| --- | --- |
| `open_slide_init` | Scaffold a new open-slide workspace |
| `open_slide_build` | Build a workspace into a static SPA |
| `open_slide_export_html` | Build and export a single self-contained HTML file |
| `open_slide_sync_skills` | Sync built-in agent skills into the workspace (`.agents/skills`) |

## Usage

Run `npx open-slide-mcp` (stdio transport). Example MCP client config:

```json
{
  "mcpServers": {
    "open-slide": {
      "command": "npx",
      "args": ["open-slide-mcp"]
    }
  }
}
```
