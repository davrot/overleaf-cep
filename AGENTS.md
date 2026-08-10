# Overleaf CEP Project

This document describes the **parent session workflow**. For subagent delegation patterns, see `references/workflows/`.

## Product
Custom build of Overleaf Community Edition (server-ce) with a WebDAV module.
Full rebuilds are expensive (~30 min, often silent for long stretches) — never rebuild speculatively.

## Commands
- Lint (authoritative, must pass with zero warnings):
  `eslint --cache --cache-location ./.cache/eslint/ --max-warnings 0 --format unix .`
  (or `yarn lint` if that's wired to the same command)
- Rebuild image: `cd /root/junk_webdav/overleaf-cep/server-ce && make all`
- Restart container: `cd /data_1/docker/compose_cep && sh cycle_overleafserver.sh`
- Check logs: `cd /data_1/docker/compose_cep && sh log_overleafserver_web.log.sh`

## Context-efficient agent delegation

This project uses pi-subagents to split context-heavy tasks across specialized workers:

| Task | Agent | Context scope |
|------|-------|---------------|
| **Review** (diff, docs, logs) | `reviewer` | Fresh context only |
| **Implementation** | `worker` | Full workspace |
| **LSP diagnostics fix** | `fixer` | Single file(s) |
| **Audit/scan** | `scanner` | Bounded scope |

Use patterns:
- `async:false` for foreground orchestration (small tasks)
- `async:true` (default) for background work, then wait via `subagent_wait`
- `runs.all([...])` for parallel fanout with aggregation
- Forked context (`context:'fork'`) to share session history when needed

## Core workflow (parent orchestrator)
1. Unfamiliar area or non-trivial change → subagent `gatherer` first (`task:'Gather context and clarify'`).
2. Delegate implementation to `worker` agent with focused task.
3. Fix diagnostics via subagent `fixer` by file or path pattern.
4. Before rebuilding, run lint checks scoped to affected service/dir — must exit 0.
5. Use parallel fanout: one `reviewer` for diff analysis + another `reviewer` for log scan.
6. Only after static verification: rebuild → restart → log verification.
7. Non-trivial changes (Dockerfile, WebDAV config/logic) → `/parallel-review` before rebuild.

See `references/workflows/` for executable workflow patterns using `workflowScript`.

## Definition of done (parent must verify)
1. `eslint --max-warnings 0` clean on affected scope.
2. Parallel reviewer agents agree: no stray changes, correct pattern application.
3. Rebuild + restart completed with logs confirming "Enabling WebDAV module".
4. Report includes: what changed, why, commands run, exact log lines around WebDAV init.

## Rules
- Never run `make all` speculatively — verify statically first (lint, diff review, config syntax).
- If a rebuild fails or logs show an error after WebDAV init, stop and report the exact error.
- When context is limited:
  - Use subagents with focused scopes rather than full-file context.
  - Pass `context:'fork'` only when session history truly matters to the child.
  - Prefer parallel review agents over single monolithic tasking.
- For complex multi-step tasks, define a durable chain using `subagent_create(chainName,{...})`.
