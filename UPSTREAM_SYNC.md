# Upstream sync workflow

This repo is a fork of [1weiho/open-slide](https://github.com/1weiho/open-slide) that adds `@open-slide/mcp`. `main` stays a **pure mirror of upstream** — all fork-specific work lives on feature branches.

## Branch layout

| Branch | Contents |
| --- | --- |
| `main` | Pure upstream mirror. Never commit fork work here. |
| `feat/*` | Fork additions (MCP tooling, docs). This is where `@open-slide/mcp` lives. |

## Remotes

```bash
git remote add upstream https://github.com/1weiho/open-slide.git
git fetch upstream
```

## Sync steps

```bash
# 1. Refresh the mirror
git switch main
git fetch upstream
git merge upstream/main --ff-only   # must stay a pure mirror; abort if non-ff

# 2. Rebase fork branches onto the new main
git switch feat/mcp-tools
git rebase main

# 3. Adapt the MCP layer to upstream changes (see checklist below)
# 4. Commit the adaptation on the feature branch (add a changeset if core/cli/mcp changed)
```

## MCP adaptation checklist

After each sync, walk this list against the upstream diff:

- [ ] **New CLI commands in `packages/core/src/cli/run.ts`?** If a one-shot command is useful to agents, expose it as an MCP tool (mirroring the existing `open_slide_*` tools). Skip long-running servers (`dev`, `preview`) — MCP is request/response.
- [ ] **Changed signatures** of `build()`, `init()`, `exportHtml()`, `syncSkills()`? Update the MCP tool handlers and input schemas.
- [ ] **New built-in skills** in `packages/core/skills/`? Verify `open_slide_sync_skills` picks them up (it syncs from `resolveBuiltinSkillsDir()`).
- [ ] **New core exports** worth exposing? Keep the tool surface minimal — only add tools for commands that map cleanly onto agent workflows.
- [ ] **Changesets** — `pnpm changeset`, pick `@open-slide/core` / `@open-slide/cli` / `@open-slide/mcp`, `patch` for fixes, `minor` for new tools/API.

## Version note

The MCP server version in `packages/mcp/package.json` is bumped via changesets, same as core/cli. Don't edit it by hand.
