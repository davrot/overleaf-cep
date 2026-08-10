# Workflow examples

## Lint fix cycle (single file)

```javascript
// lint-fix-cycle.js
const filePath = 'server-ce/lib/WebDAV/Handler.js';

// 1. Get current diagnostics
const diag = await runs.run('diag', {
  agent: 'scanner',
  cwd: '/root/junk_webdav/overleaf-cep/server-ce',
  task: `Run ESLint on ${filePath} and return the list of violations with line numbers.`,
  toolBudget: { hard: 8 }
});

// 2. Fix if any exist
if (diag && diag.length > 0) {
  const fixed = await runs.run('fix', {
    agent: 'fixer',
    cwd: '/root/junk_webdav/overleaf-cep/server-ce',
    task: `Apply ESLint auto-fix to ${filePath}. Use lsp_fix with kind source.fixAll.`,
    async: false,
    toolBudget: { hard: 8 }
  });
  
  // 3. Re-scan to confirm
  const verified = await runs.run('verify', {
    agent: 'scanner',
    cwd: '/root/junk_webdav/overleaf-cep/server-ce',
    task: `Re-run ESLint on ${filePath} and confirm zero warnings.`,
    toolBudget: { hard: 8 }
  });
  
  return { fixed, verified };
}

return { status: 'clean', filePath };
```

## Pre-rebuild verification pipeline

```javascript
// pre-build-check.js
const check = await runs.run('pipeline', {
  agent: 'worker',
  task: `Execute this sequence:
1. Scanning phase (agent=scanner): Run eslint on server-ce with --max-warnings 0 and report any files failing.
2. Fixing phase (agent=fixer): For each file in step 1, apply ESLint auto-fix via lsp_fix with kind source.fixAll.
3. Review phase (agent=reviewer): Check git diff for unintended changes. Return summary.`,
  async: false // foreground to ensure ordered phases
});

return check;
```

## Log verification fanout

```javascript
// log-verify.js
const [status, tail] = await runs.all([
  {
    key: 'docker-status',
    agent: 'scanner',
    cwd: '/data_1/docker/compose_cep',
    task: 'Run docker-compose ps and return container status for overleaf-server.',
    toolBudget: { hard: 5 }
  },
  {
    key: 'log-tail',
    agent: 'scanner',
    cwd: '/data_1/docker/compose_cep',
    task: 'Return the last 20 lines of logs/web.log, filtered to ERROR or WARN lines only.',
    toolBudget: { hard: 5 }
  }
]);

return {
  dockerStatus: status,
  logAlerts: tail
};
```

## Change context gathering

```javascript
// gather-change-context.js
const context = await runs.run('gatherer', {
  agent: 'advisor',
  context: 'fork',
  task: `Gather and summarize:
1. Current git status (modified, new, deleted files)
2. If server-ce or services/web affected, list the changed files
3. For each changed file, return: path and a one-line summary of main modifications
\nReturn as structured JSON with keys: status, changes[]`, 
  toolBudget: { hard: 15 }
});

return context;
```
