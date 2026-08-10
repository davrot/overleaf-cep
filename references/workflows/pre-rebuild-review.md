# Pre-rebuild parallel review workflow

**When to use**: Before running `make all`, when the change touches Dockerfile or WebDAV logic.

## Parent orchestrator pattern

```javascript
// pre-rebuild-review.js
const [diffAnalysis, logAudit] = await runs.all([
  {
    key: 'diff-analysis',
    agent: 'reviewer',
    context: 'fork', // session history may help if this is a continuation
    task: `Review the current git diff. Focus on:
1. Dockerfile changes affecting build steps or layers
2. WebDAV-related code logic (finds in server-ce)
3. Any config changes that could affect startup
\nReturn findings in bullet format with file paths and line ranges if possible.`,
    toolBudget: { hard: 15 }
  },
  {
    key: 'log-audit',
    agent: 'reviewer',
    context: 'fresh', // fresh context for log-only review
    task: `Check the last 200 lines of /data_1/docker/compose_cep/logs/web.log:
1. Confirm "Enabling WebDAV module" appears exactly once
2. Look for any ERROR or WARN lines in the log
3. Flag any startup delays >10s reported in logs
\nReturn audit results in bullet format.`,
    toolBudget: { hard: 10 }
  }
]);

return {
  diffAnalysis,
  logAudit
};
```

## Decision gate

```javascript
// Use after lint-scan-and-fix.js
const review = await runs.run('review', { agent: 'reviewer', task: 'Review the combined fix results' });
if (review === 'safe') {
  // proceed to rebuild
} else {
  throw new Error(`Pre-rebuild review blocked: ${review}`);
}
```

## Notes

- Use `context:'fork'` when diff analysis benefits from session history (e.g., earlier context about the change intent).
- Use `context:'fresh'` for log audit to avoid any stale state.
