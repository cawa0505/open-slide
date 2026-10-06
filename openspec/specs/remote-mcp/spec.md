# remote-mcp Specification

## Purpose
Provides a controlled remote interface for previewing OpenSlide workspaces and downloading generated slide artifacts without exposing the host filesystem.

## Requirements

### Requirement: Remote MCP transport

The system SHALL provide an HTTP-based MCP entrypoint that exposes the same core slide tools as the stdio server, subject to remote authentication and workspace policy.

#### Scenario: Authenticated remote tool call
- **WHEN** an authenticated client invokes a supported MCP tool over HTTP
- **THEN** the server executes it within the configured workspace policy and returns the tool result using the documented MCP response format

#### Scenario: Unauthenticated remote tool call
- **WHEN** a client invokes a remote MCP tool without valid credentials
- **THEN** the server rejects the request without executing the tool

### Requirement: Preview sessions

The system SHALL allow an authenticated client to start a dev or production preview session and SHALL return a client-accessible URL, a session identifier, and an expiration time.

#### Scenario: Start preview
- **WHEN** the client requests a preview for a valid workspace
- **THEN** the server starts or reuses an isolated preview session and returns its URL, session identifier, and expiration time

#### Scenario: Stop preview
- **WHEN** the client stops an active preview session it owns
- **THEN** the server terminates the session and invalidates its preview URL

#### Scenario: Expired preview
- **WHEN** a preview session reaches its configured TTL
- **THEN** the server stops the session and no longer serves its URL

### Requirement: Remote artifacts

The system SHALL make build and export results available as short-lived artifact URLs in remote mode, including filename, media type, size, checksum when available, and expiration time.

#### Scenario: Export HTML artifact
- **WHEN** an authenticated client exports a valid workspace as HTML
- **THEN** the server stores the generated file within the artifact store and returns a downloadable URL with artifact metadata

#### Scenario: Export Zola package
- **WHEN** an authenticated client requests a Zola package
- **THEN** the server returns a downloadable ZIP containing the documented Zola wrapper and self-contained slide output

#### Scenario: Artifact expiration
- **WHEN** an artifact reaches its configured TTL or exceeds the configured storage limit
- **THEN** the artifact is unavailable for download and its stored bytes are removed during cleanup

### Requirement: Isolation and limits

The system SHALL restrict every remote operation to an explicitly configured workspace root and SHALL enforce limits for request size, concurrent sessions, artifact size, and session lifetime.

#### Scenario: Path traversal attempt
- **WHEN** a request supplies a path outside the configured workspace root
- **THEN** the server rejects the request without reading or writing the target path

#### Scenario: Resource limit exceeded
- **WHEN** a request would exceed a configured concurrency, size, or lifetime limit
- **THEN** the server rejects the request with a structured limit error and preserves existing sessions and artifacts

### Requirement: Backward compatibility

The system SHALL preserve the existing stdio MCP response behavior and SHALL preserve the existing `open-slide dev`, `open-slide preview`, and `--open` CLI behavior.

#### Scenario: Existing stdio export
- **WHEN** a stdio client invokes HTML export
- **THEN** the server returns the local output path as it does today

#### Scenario: Existing CLI preview
- **WHEN** a user runs `open-slide preview --open`
- **THEN** the CLI starts the Vite preview server and retains its current browser-opening and URL-printing behavior
