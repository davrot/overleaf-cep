# Context-efficient development loop

## Principles

1. **Never hold full file content** if you only need derived answers (line counts, error patterns, summary).
   - Use `ctx_execute_file` or `subagent scanner` to process files in sandbox.

2. **Use fresh-context reviewers** for validation passes when possible; don't pass session history unnecessarily.

3. **Parallel fanout over sequential steps** when tasks are independent.
   - Instead of: fix lint → run linter again → check diff
   - Use: `runs.all(lint-fixers)` + `runs.run(check-lint)` in parallel with `diff-reviewer`.

4. **Track final state in parent only**; let children report findings, not make final decisions.

## Example: LSP fix delegation

```javascript
// Parent workflow for single-file LSP fixes
const file = 'server-ce/lib/WebDAV/Handler.js';

return await runs.run('fix', {
  agent: 'fixer',
  cwd: '/root/junk_webdav/overleaf-cep/server-ce',
  task: `Apply ESLint source.fixAll to ${file} via lsp_fix. Do NOT run lint again.`,
  toolBudget: { hard: 8 },
  async: false // foreground for immediate feedback
});
```

## Example: Log pattern scanning

```javascript
// Scan logs without reading full content into prompt context
const result = await ctx_execute_file({
  path: '/data_1/docker/compose_cep/logs/web.log',
  language: 'shell',
  code: `tail -200 "$FILE_CONTENT" | grep -E '(ERROR|WARN|Enabling WebDAV)'`,
  timeout: 5000
});
console.log(result); // returns only matching lines, not full log
```

## When to escalate

- **Architecture decisions** → parent session only (not subagents)
- **Safety-critical builds** → parent orchestrates fanout, final decision only in parent
- **Product/feature changes** → parent defines objectives; children implement specific parts
