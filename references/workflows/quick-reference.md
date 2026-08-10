# Quick reference: Subagent patterns for Overleaf CEP

## Common parent workflows (workflowScript)

| Task | Script skeleton |
|------|-----------------|
| **Lint scan** | `const r = await runs.run('scan', { agent: 'scanner', task: 'Run eslint --max-warnings 0 on affected dirs' }); return r;` |
| **Fix single file** | `return await runs.run('fix', { agent: 'fixer', task: 'lsp_fix source.fixAll for FILE', async: false })` |
| **Parallel review** | `const [a,b] = await runs.all([{key:'diff',...},{key:'logs',...}]); return {a,b};` |
| **Gather context** | `return await runs.run('gatherer', { agent: 'advisor', task: 'Context and clarify for change X' })` |
| **Full pre-rebuild check** | See `references/workflows/pre-rebuild-review.md` |

## Agent roles (recommended)

| Agent | Scope | Context hint |
|-------|-------|--------------|
| `scanner` | Bounded scope (single file, log tail) | Use `toolBudget: {hard:10}` to cap reads |
| `fixer` | LSP-driven fixes only | `async:false` for foreground feedback |
| `reviewer` | Diff analysis, log audit | `context:'fresh'` unless session history truly needed |
| `advisor` | Context gathering, decision support | No mutation capability |

## Tool budget guidance

- **Read-only tasks** (scanning, review): `toolBudget: {hard: 15}`
- **Mutation tasks** (fixing): `toolBudget: {hard: 10}`
- **Never pass** `turnBudget` to mutation workers; it stops mid-tool and leaves state half-finished.

## Wait strategies

```javascript
// Wait for one child run to complete
await subagent_wait({ id: 'run-id-prefix' });

// Wait for all children launched this session
await subagent_wait({ all: true });
```

Avoid polling `subagent.status` just to wait; use `subagent_wait`.
