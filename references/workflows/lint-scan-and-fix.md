# Lint scan and fix workflow

**When to use**: Before rebuilding, when a large change set may have introduced lint violations.

## Parent orchestrator pattern

```javascript
// lint-scan-and-fix.js
const [scanResult] = await runs.all([
  {
    key: 'lint-scan',
    agent: 'scanner',
    cwd: '/root/junk_webdav/overleaf-cep/server-ce',
    task: 'Run eslint on server-ce with --cache and collect just the filenames of files with warnings or errors.',
    toolBudget: { hard: 10 }
  },
  {
    key: 'lint-scan-web',
    agent: 'scanner',
    cwd: '/root/junk_webdav/overleaf-cep/services/web',
    task: 'Run eslint on services/web with --cache and collect just the filenames of files with warnings or errors.',
    toolBudget: { hard: 10 }
  }
]);

const allFiles = [...(scanResult || []), ...(scanResultWeb || [])];

// If any files had lint issues, spawn fixer agents in parallel
if (allFiles.length > 0) {
  const fixes = await runs.all(allFiles.map(f => ({
    key: `fix-${btoa(f).slice(0,12)}`,
    agent: 'fixer',
    cwd: f.includes('server-ce') ? '/root/junk_webdav/overleaf-cep/server-ce' : '/root/junk_webdav/overleaf-cep/services/web',
    task: `Apply ESLint fixes to ${f} using lsp_fix with source.fixAll. Do NOT run lint again`,
    toolBudget: { hard: 8 }
  })));

  // Aggregate results
  return fixes.map(f => f.output || 'fixed');
}

return [];
```

## Notes

- Each child uses `toolBudget` to prevent runaway read/search calls.
- Use separate cwds for server-ce vs services/web to keep lint config scoping correct.
- Fixers run in parallel; parent aggregates results before re-scanning if needed.
