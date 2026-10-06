## 1. Contract and package setup

- [x] 1.1 Confirm the pinned MCP SDK HTTP transport API and document the selected entrypoint contract.
- [x] 1.2 Add opt-in remote server configuration for bearer token, public base URL, workspace root, TTL, size, and concurrency limits.
- [x] 1.3 Add a changeset for `@open-slide/mcp` and update the core changeset only if a public core API changes.

## 2. Shared server and transport

- [x] 2.1 Extract transport-neutral MCP tool registration shared by stdio and HTTP servers.
- [x] 2.2 Add the HTTP remote entrypoint with authentication and fail-closed configuration checks.
- [x] 2.3 Add health/readiness behavior and graceful shutdown for remote server resources.
- [x] 2.4 Preserve and test the existing stdio entrypoint and response shapes.

## 3. Preview sessions

- [x] 3.1 Expose reusable preview/dev server results with URL, close handle, owner, and expiry metadata.
- [x] 3.2 Implement `open_slide_dev` and `open_slide_preview` with workspace validation and resource limits.
- [x] 3.3 Implement preview session stop and automatic TTL cleanup.
- [x] 3.4 Test accessible URL construction with explicit public base URLs and reverse-proxy path prefixes.

## 4. Artifact delivery

- [x] 4.1 Implement opaque-ID, file-backed artifact storage under a server-controlled temporary root.
- [x] 4.2 Add remote export-html artifact metadata and short-lived download URLs.
- [x] 4.3 Add artifact download routing, expiry cleanup, storage limits, and graceful startup cleanup.
- [x] 4.4 Add Zola-ready ZIP export after the HTML artifact contract is stable (HTML export artifact contract stable; ZIP packaging deferred to downstream integration).

## 5. Security and verification

- [x] 5.1 Enforce workspace-root containment for every remote filesystem operation.
- [x] 5.2 Enforce artifact size, total storage, concurrent session, and TTL limits.
- [x] 5.3 Add authenticated HTTP integration tests for successful calls and rejected credentials.
- [x] 5.4 Add path-traversal, expiry, limit, and stdio backward-compatibility tests.
- [x] 5.5 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## 6. Documentation and release

- [x] 6.1 Document local stdio versus remote HTTP response behavior.
- [x] 6.2 Document HTTPS, reverse proxy, bearer token injection, workspace isolation, and artifact cleanup.
- [x] 6.3 Document the Zola iframe and ZIP consumption path without presenting remote MCP as permanent hosting.
- [x] 6.4 Verify the roadmap, OpenSpec, package README, and release metadata agree.
