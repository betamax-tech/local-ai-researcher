---
id: "12.03"
title: "Add SearXNG bootstrap launch flow"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 5
depends_on: ["12.01"]
blocks: ["12.02"]
parent: "12"
branch: "feat/task-12-packaging-release-readiness"
assignee: dev
enriched: true
rmcp_id: "RMCP-06-C"
---

# Task 12.03: Add SearXNG Bootstrap Launch Flow

## Business Requirements

### Problem
Operators can currently package and launch the MCP server, but they still have to separately bring up the required local SearXNG dependency. That extra manual step breaks the goal of a self-contained local research tool and increases startup failure risk.

### User Story
As an operator, I want the approved launch command to automatically bring up the required local search dependency before the MCP starts so that the tool works as a single self-contained startup flow.

### Acceptance Criteria
- [ ] Starting the approved packaged launch path automatically brings up the required local SearXNG dependency and does not require a separate manual startup step before the MCP begins serving requests.
- [ ] Starting the approved packaged launch path while the local SearXNG dependency is already running succeeds without requiring extra operator action or creating a duplicate startup workflow.
- [ ] If the local SearXNG dependency does not become ready within 30 seconds, startup stops, returns a non-zero exit, and reports a clear operator-visible failure message instead of hanging or starting the MCP in a partial state.
- [ ] When the launched MCP process receives a termination signal, it shuts down cleanly through the primary process path so operators do not have to manually stop an extra wrapper process.
- [ ] Operators have a documented local stop path for shutting down the bundled SearXNG runtime when they are done using the packaged launch flow.

### Business Rules
- The self-contained launch path requires Docker as an operator runtime dependency and must state that requirement clearly.
- The bundled SearXNG runtime must stay aligned with the approved provider contract for machine-readable search responses.
- The bundled SearXNG runtime should stay lightweight by excluding unnecessary default search scope.
- Updating operator-local launcher configuration is not automated by this task.

### Out of Scope
- Automatic changes to user-local OpenCode configuration.
- Alternate non-Docker bootstrap paths.
- Broader release documentation beyond the bootstrap behavior this task introduces.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Primary axis: process lifecycle orchestration** — coordinating a Docker dependency with a Node.js process via a thin bootstrap wrapper.

**Pattern selection:**
- **Exec pattern for signal handling** — `exec node dist/index.js` replaces the bash process with node, so the OS delivers SIGTERM/SIGINT directly to the node process without requiring manual signal forwarding. This is the correct pattern for single-process orchestration.
- **Health polling with simple linear retry** — `curl -sf http://localhost:8080/` at 1s intervals, max 30s. Linear polling is sufficient for a local dependency; exponential backoff adds complexity without value here.
- **Docker Compose V2 (no version field)** — modern Compose V2 does not require a `version:` field. Omit it.
- **Bash strict mode** — `set -euo pipefail` ensures the script fails fast on errors, undefined variables, and pipeline failures.

**Constraints created by these choices:**
- The bootstrap script is a thin orchestration layer only — it must NOT contain business logic or configuration validation.
- All configuration lives in `searxng/settings.yml` and environment variables; the script only coordinates startup.
- The `exec` pattern means the bash process is replaced entirely — there is no parent process to orphan on termination.

## Affected Areas

**New files to create:**
- `docker-compose.yml` — SearXNG service definition
- `searxng/settings.yml` — SearXNG configuration with `search.formats: [json]` enabled
- `scripts/start.sh` — bootstrap + exec wrapper
- `scripts/stop.sh` — convenience shutdown script

**Files to modify:**
- `package.json` — add `scripts.start:docker` entry pointing to `scripts/start.sh`
- `README.md` (or `docs/operator-guide.md`) — add `## OpenCode Configuration` section documenting:
  - Updated `opencode.json` command: `["bash", "/path/to/scripts/start.sh"]`
  - Required env var: `SEARXNG_ALLOW_PRIVATE_NETWORKS=true` for localhost SearXNG
  - Docker runtime dependency requirement

**Files to reference (no changes):**
- `src/config.ts` — `SEARXNG_ENDPOINT` defaults to `http://localhost:8080` (already correct)
- `src/providers/searxng.ts` — provider contract expects `format=json` query param to return JSON

## Quality Gates

1. **Health poll timeout behavior:**
   - If SearXNG does not respond within 30 seconds, `scripts/start.sh` must exit with code 1 and print a clear error message to stderr (e.g., "SearXNG failed to become ready within 30s").
   - Verify: run `scripts/start.sh` without Docker running; confirm exit code 1 and visible error message.

2. **SearXNG JSON format support:**
   - `searxng/settings.yml` must include `search.formats: [json]` — without this, the provider's `format=json` query param returns HTML instead of JSON, breaking all searches.
   - Verify: `curl http://localhost:8080/search?q=test&format=json` returns valid JSON, not HTML.

3. **Signal propagation:**
   - Sending SIGTERM to the launched process (via `scripts/start.sh`) must terminate the node process cleanly without leaving orphan processes.
   - Verify: run `scripts/start.sh`, send SIGTERM, confirm no zombie processes with `ps aux | grep node`.

4. **Idempotent startup:**
   - Running `scripts/start.sh` when SearXNG is already running must succeed without error.
   - Verify: run `scripts/start.sh` twice in succession; second run should succeed.

5. **Docker Compose compatibility:**
   - `docker compose up -d` must work with Compose V2 (no `version:` field in `docker-compose.yml`).

## Gotchas

1. **CRITICAL: `search.formats: [json]` in settings.yml** — SearXNG defaults to HTML responses. Without this setting, the provider's `format=json` query param is ignored and searches return HTML, breaking the MCP server. This is the most common failure mode.

2. **SEARXNG_ALLOW_PRIVATE_NETWORKS=true required for localhost** — The provider's SSRF protection blocks private network addresses by default. When using `http://localhost:8080`, this env var must be set to `true`. Document this prominently in the operator guide.

3. **curl -sf flag is essential** — The `-f` flag makes curl fail on HTTP errors (exit non-zero). Without it, a 500 response would be treated as success. The `-s` flag suppresses progress output but still respects `-f`.

4. **Docker socket permission on Linux** — Operators on Linux may need to add themselves to the `docker` group or run scripts with sudo. Document this in the operator guide.

5. **settings.yml volume mount path** — The volume `./searxng:/etc/searxng` assumes `scripts/start.sh` is run from the project root. If run from another directory, the mount path will be wrong. Consider using `$(dirname "$0")/../searxng:/etc/searxng` for robustness, or document that scripts must be run from project root.

---

## Changes
- `docker-compose.yml` — new
- `searxng/settings.yml` — new (search.formats includes json)
- `scripts/start.sh` — new (bootstrap + health poll + exec)
- `scripts/stop.sh` — new (docker compose down)
- `package.json` — modified (start:docker script)
- `README.md` — modified (Self-Contained Launch section)
