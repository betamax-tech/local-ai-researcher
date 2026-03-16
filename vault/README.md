# Vault

This repo uses `vault/` as the canonical, agent-managed planning memory.

## What goes where

- `vault/sprint/`:
  - Execution system (task-waves). Preserve history; avoid casual edits.
- `vault/ai/docs/`:
  - Canonical planning docs (PRDs, SRS, plans, task skeletons).
- `vault/ai/threads/`:
  - Ongoing work threads and incident records (in-progress notes, drift, follow-ups).
- `vault/ai/decisions/`:
  - Durable decisions (ADRs): what we decided and why.
- `vault/ai/journal/`:
  - Chronological notes (short running log when useful).

## Conventions

- Planning artifacts belong in `vault/ai/docs/` (not `docs/`).
- If a workflow failure happens, record it as a thread in `vault/ai/threads/`.
- When something becomes stable enough to be policy, capture it in `vault/ai/decisions/`.
