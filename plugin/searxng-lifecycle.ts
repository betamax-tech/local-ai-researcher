/**
 * searxng-lifecycle.ts — OpenCode Plugin
 *
 * WHAT IT DOES
 * ────────────
 * This plugin auto-manages the SearXNG Docker container lifecycle, tying it
 * to OpenCode session activity:
 *
 *   • session.created  → if this is the FIRST active session (0→1), bring
 *                        SearXNG up: `docker compose up -d searxng`
 *   • session.deleted  → if this is the LAST active session (1→0), tear
 *                        SearXNG down: `docker compose down`
 *
 * Without this plugin, SearXNG stays running after all OpenCode sessions
 * close. With this plugin, SearXNG runs only while OpenCode is actively
 * in use.
 *
 * INSTALLATION
 * ────────────
 * 1. Copy this file to your OpenCode plugin directory:
 *
 *      # Global (all projects):
 *      cp plugin/searxng-lifecycle.ts ~/.config/opencode/plugin/
 *
 *      # Project-local (this project only):
 *      cp plugin/searxng-lifecycle.ts .opencode/plugin/
 *
 * 2. Set the required environment variable in your shell profile
 *    (~/.bashrc, ~/.zshrc, ~/.profile, etc.):
 *
 *      export LOCAL_RESEARCHER_COMPOSE_FILE="/absolute/path/to/local-ai-researcher/docker-compose.yml"
 *
 *    Replace the path with the actual absolute path on your machine.
 *    Reload your shell or run: source ~/.zshrc  (or equivalent).
 *
 * 3. Restart OpenCode. The plugin is auto-discovered and loaded.
 *
 * REQUIRED ENVIRONMENT VARIABLE
 * ──────────────────────────────
 * LOCAL_RESEARCHER_COMPOSE_FILE
 *   Absolute path to the docker-compose.yml for the local-ai-researcher
 *   project. Example:
 *     /home/alice/projects/local-ai-researcher/docker-compose.yml
 *
 *   If this variable is not set, the plugin logs a one-time warning to
 *   stderr and silently no-ops all lifecycle events. It will NOT crash
 *   OpenCode.
 *
 * RUNTIME DEPENDENCY
 * ──────────────────
 * Requires @opencode-ai/plugin — OpenCode installs this automatically
 * when the plugin file is placed in a plugin directory. Do not add it to
 * your project's package.json.
 *
 * IMPORTANT NOTES
 * ───────────────
 * • Session counter is in-memory. If OpenCode crashes or is force-killed,
 *   the counter is lost and SearXNG may remain running. Clean up manually:
 *     bash /path/to/local-ai-researcher/scripts/stop.sh
 *
 * • The plugin uses `docker compose` (Compose V2). If your system only
 *   has the legacy `docker-compose` command, the lifecycle commands will
 *   fail silently (errors go to stderr for visibility).
 *
 * • On `session.created` when SearXNG is already running (e.g., started
 *   manually), `docker compose up -d` is idempotent — it will not restart
 *   or disrupt the running container.
 */

import type { Plugin } from "@opencode-ai/plugin";

// Module-level counter — survives across multiple event() invocations within
// the same OpenCode process lifetime. A closure variable inside the Plugin
// factory would be re-created on each event dispatch; module scope ensures
// one counter for the entire session.
let activeSessions = 0;

// Track whether the "not configured" warning has been emitted. We only log
// it once to avoid spamming stderr on every event.
let warnedNotConfigured = false;

export const SearXNGLifecyclePlugin: Plugin = async ({ $ }) => {
  return {
    event: async ({ event }) => {
      const composePath = process.env["LOCAL_RESEARCHER_COMPOSE_FILE"];

      // Guard: env var not set → warn once, then no-op.
      if (!composePath) {
        if (!warnedNotConfigured) {
          process.stderr.write(
            "[searxng-lifecycle] WARNING: LOCAL_RESEARCHER_COMPOSE_FILE is not set. " +
              "SearXNG lifecycle management is disabled. " +
              "Set this env var to the absolute path of docker-compose.yml to enable.\n"
          );
          warnedNotConfigured = true;
        }
        return;
      }

      if (event.type === "session.created") {
        activeSessions += 1;

        // Only start SearXNG on the 0→1 transition.
        if (activeSessions === 1) {
          process.stderr.write(
            "[searxng-lifecycle] First session opened — starting SearXNG...\n"
          );
          try {
            await $`docker compose -f ${composePath} up -d searxng`;
            process.stderr.write(
              "[searxng-lifecycle] SearXNG started (or was already running).\n"
            );
          } catch (err) {
            process.stderr.write(
              `[searxng-lifecycle] ERROR: Failed to start SearXNG: ${err}\n`
            );
          }
        }
      } else if (event.type === "session.deleted") {
        if (activeSessions > 0) {
          activeSessions -= 1;
        }

        // Only stop SearXNG on the N→0 transition.
        if (activeSessions === 0) {
          process.stderr.write(
            "[searxng-lifecycle] Last session closed — stopping SearXNG...\n"
          );
          try {
            await $`docker compose -f ${composePath} down`;
            process.stderr.write(
              "[searxng-lifecycle] SearXNG stopped.\n"
            );
          } catch (err) {
            process.stderr.write(
              `[searxng-lifecycle] ERROR: Failed to stop SearXNG: ${err}\n`
            );
          }
        }
      }
    },
  };
};
