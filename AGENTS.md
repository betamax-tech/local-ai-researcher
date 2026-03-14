# AGENTS.md

## Workflow Configuration

- Git: `gitflow[orchestrator]`
- Tasks: `task-waves[orchestrator,pm]`
- Worker: `worker-scope[variants]`

## Commit Discipline — Non-Negotiable

- **The commit IS the deliverable.** Uncommitted work does not exist.
- **One logical unit = one commit**, the moment it works. `wip:` commits are legitimate.
- **Verify every commit:** `git log --oneline -1` after every commit. Empty = commit failed = stop.
- **Before any destructive action:** ensure previous state is committed first.

## Core Values

Load `core-values[all]` skill. It is the shared DNA — every agent applies it when resolving ambiguity.
