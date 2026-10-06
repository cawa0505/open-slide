## Context

The existing MCP server is stdio-only and returns local paths. The CLI already owns Vite dev and preview behavior, while export-html produces a self-contained file. Remote callers need a transport boundary, addressable sessions, and downloadable artifacts without receiving arbitrary filesystem access.

## Goals / Non-Goals

**Goals:**

- Add a remote HTTP MCP entrypoint without duplicating tool business logic.
- Return usable preview URLs and short-lived artifact URLs.
- Keep stdio and CLI behavior backward compatible.
- Make workspace, authentication, TTL, and resource limits explicit.

**Non-Goals:**

- Public permanent hosting of slide decks.
- Arbitrary shell execution or arbitrary host file access.
- Replacing Zola or implementing a Zola deployment service.
- Adding a browser UI for remote administration.

## Decisions

### Shared tool registration

Keep tool definitions in a transport-neutral factory. Stdio and HTTP entrypoints supply different transports and result adapters, but invoke the same core/CLI functions. This avoids behavior drift; a separate remote-only tool registry is rejected.

### Streamable HTTP boundary

Use the MCP SDK's supported HTTP transport for the remote entrypoint rather than inventing an RPC protocol. Put authentication, workspace selection, rate/resource limits, and artifact routing at the HTTP boundary. The exact SDK transport class is an implementation detail to verify against the pinned SDK before coding.

### In-process preview sessions first

Start preview sessions in the remote server process and retain a close handle, session owner, and expiry. This is the smallest viable implementation and matches the existing Vite APIs. A worker-process pool is deferred until isolation or crash containment requires it.

### File-backed artifact store

Store artifacts under a server-controlled temporary root keyed by opaque IDs. Return URLs containing only the opaque ID, never an absolute path. Cleanup runs on expiry and on startup. A database is unnecessary for the first version because artifact state is ephemeral.

### Explicit deployment base URL

Construct returned URLs from a configured public base URL, not from request `Host` headers. This prevents incorrect links behind reverse proxies and avoids trusting spoofable forwarding headers.

### Authentication boundary

Require a configured bearer token for the first remote release. No anonymous mode is supported. Token rotation and multiple users are deferred; sessions and artifacts are scoped to the authenticated token identity even if the first deployment has one configured identity.

## Risks / Trade-offs

- [In-process preview crash] -> Track sessions and close handles; document that production deployments should use a process supervisor. Add worker isolation only when required.
- [Reverse-proxy URL mismatch] -> Require an explicit public base URL and test proxy-style path prefixes.
- [Artifact disk growth] -> Enforce per-artifact and total-store limits, TTL cleanup, and startup cleanup.
- [Workspace escape] -> Resolve and validate paths against one configured root before every filesystem operation.
- [MCP SDK transport drift] -> Pin the existing SDK version and add an integration test against the selected transport before exposing the entrypoint.

## Migration Plan

1. Add the remote entrypoint and shared registration without changing the stdio command.
2. Add opt-in configuration; remote mode fails closed when its token or public base URL is missing.
3. Verify build, typecheck, check, unit tests, and an authenticated HTTP integration test.
4. Document reverse-proxy deployment and enable remote mode only in deployments that provide authentication and isolated workspaces.

Rollback is disabling the remote entrypoint or reverting the package release; stdio MCP and CLI remain independently usable.

## Open Questions

- [待討論] Should the first remote deployment support one workspace per server only, or a token-to-workspace mapping? The capability requires an explicit workspace policy; the initial implementation can use one configured root.
