# Subagent workflows for Overleaf CEP

This directory contains pre-defined workflow patterns that help you work within limited context windows by delegating tasks to specialized subagents.

## Files

| File | Purpose |
|------|---------|
| `quick-reference.md` | One-page lookup table: agent roles + workflowScript stubs |
| `lint-scan-and-fix.md` | Scan multiple ESLint scopes in parallel and fix violations |
| `pre-rebuild-review.md` | Parallel diff analysis + log audit before `make all` |
| `context-efficient.md` | Principles for minimizing context consumption |
| `examples.md` | Complete workflowScript examples you can copy-paste |

## Usage pattern

1. Read the relevant workflow file.
2. Copy the `workflowScript` snippet into your parent session or save to a `.js` file.
3. The parent orchestrator remains in control:
   - Subagents gather findings, fix files, verify logs.
   - Parent aggregates and makes final decisions.

## Agent roles

| Role | Scope | When to use |
|------|-------|-------------|
| `advisor` | Context gathering, planning | Unfamiliar area, non-trivial change |
| `scanner` | Bounded scan (single file, log tail) | Lint, grep, pattern detection |
| `fixer` | LSP-driven fixes only | ESLint source.fixAll, import sort |
| `reviewer` | Diff analysis, log audit | Pre-build verification |

## WorkflowScript tips

- `runs.all([...])` for parallel fanout with aggregation
- `runs.run(key, {...})` for sequential phases
- Use `async:false` only for small foreground tasks; default is async/background
- Prefer `context:'fork'` when session history truly benefits the child; use `context:'fresh'` otherwise
