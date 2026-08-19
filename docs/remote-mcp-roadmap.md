# Remote MCP Roadmap

## Scope

Remote MCP lets an agent or container client use OpenSlide remotely:

- Start dev/preview servers and receive an accessible preview URL.
- Build and export slides and receive a short-lived `.html` or `.zip` artifact URL.
- Preserve stdio MCP local-path responses and existing CLI behavior.

Remote MCP is not public slide hosting and does not replace Zola. Zola only needs to host the exported HTML or unpack a Zola-ready ZIP.

## Contract

| Mode | Preview/dev | Build/export |
| --- | --- | --- |
| stdio | Local server URL/status | Local directory/file path |
| remote HTTP | Client-accessible preview URL | Short-lived artifact URL |

Remote artifact responses include `url`, `expiresAt`, `filename`, `mediaType`, `size`, and a checksum when available. Preview responses also include `sessionId`. URLs use opaque IDs and never expose host filesystem paths.

## Phases

### Phase 0: Contract and boundaries

- Complete the OpenSpec for transport, sessions, artifacts, isolation, and security.
- Confirm the pinned MCP SDK's supported HTTP transport.
- Define authentication, URL construction, TTL, size limits, error format, and workspace policy.
- Explicitly prohibit shell execution, arbitrary file access, anonymous mode, and permanent hosting.

### Phase 1: Remote server skeleton

- Add an opt-in HTTP entrypoint while keeping stdio unchanged.
- Add health/readiness handling and configuration loading.
- Share tool registration between transports.
- Fail closed when token or public base URL configuration is missing.

### Phase 2: Preview sessions

- Add `open_slide_dev` and `open_slide_preview`.
- Return accessible URL, opaque session ID, and expiry.
- Add `open_slide_stop_preview` and automatic TTL cleanup.
- Verify proxy path prefixes and graceful shutdown.

### Phase 3: Artifact delivery

- Add remote adapters for build and export-html.
- Add opaque artifact storage, download routing, metadata, checksum, TTL, and cleanup.
- Add Zola-ready ZIP export only after the HTML artifact contract is stable.

### Phase 4: Security and operations

- Enforce bearer authentication, workspace root checks, request/resource limits, and concurrency limits.
- Add structured audit logs without recording secrets or slide source contents.
- Document reverse proxy, HTTPS, token injection, storage location, and container deployment.

### Phase 5: Release and hardening

- Run `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Add authenticated HTTP integration tests and expiry/limit/path-traversal tests.
- Add a `@open-slide/mcp` changeset; add a core changeset only if its public API changes.
- Release remote mode as opt-in and keep stdio as the default.

## Decisions to Preserve

- Local stdio returns local paths; remote HTTP returns URLs.
- CLI `dev`, `preview`, and `--open` remain unchanged.
- Remote mode uses explicit public URL configuration, not guessed request headers.
- Artifact/session URLs are short-lived and opaque.
- Remote MCP is a controlled execution and delivery layer, not a hosting platform.
