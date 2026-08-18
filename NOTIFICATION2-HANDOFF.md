# Notification2 — Session Handoff

> Context for the next session (docker-capable machine). Everything is written; nothing
> is lost in this sandbox except the docker/ssh e2e run itself.

## Why this file exists

The current sandbox cannot run Docker (`permission denied on /var/run/docker.sock`) and has
no SSH keys / credential helper to push. Branch `notification2` was developed here fully and
committed locally; **it has not been pushed**.

## Git state

- Repo: `/home/davrot/test_llm/new`, remote `git@github.com:davrot/overleaf-cep.git`
- Branch `notification2` at commit **f8c645c378** + this handoff commit (the second one).
- **Push**: `cd /home/davrot/test_llm/new && git push -u origin notification2`
- Old reference: `/home/davrot/test_llm/notification` (fork, commit `034f09ba6f`) is safe to
  `rm -rf` once pushed; it is preserved in `origin/notification`.

## What landed

Module `services/web/modules/notifications/` (the only new area for prefs + email dispatch):

| File | Purpose |
|---|---|
| `app/src/NotificationsPreferencesHandler.mjs` | Read/save global + per-project prefs (`notificationsPreferences` collection, `project_id: null` = global) |
| `app/src/PreferenceNormalizer.mjs` | Normalizes 12 booleans, default-true |
| `app/src/NotificationsPreferencesRouter.mjs` / `...Controller.mjs` | `GET/POST /notifications/preferences/project/:id` |
| `app/src/ScheduleProjectChangeNotifications.mjs` | `projectModified` hook: redis `scheduledAt` debounce (6h), per-member fan-out, idempotent upsert |
| `app/src/ProcessNotifications.mjs` | Email queue processor (drain, claim-mark, dead-letter, `dryRunProcessed` support) |
| `app/src/types.d.ts` / `types.js` | Types (see "Verified findings" re: `muteAllNotifications` contract) |
| `app/views/user/notification-preferences.pug` | Settings view |
| `index.mjs` | Module registration |
| `test/unit/src/*.test.mjs` (×3) | 15 unit tests, **all pass** (`yarn vitest run test/unit/src modules/notifications`… see below) |

Upstream touch points (7): `settings.defaults.js`, `EmailBuilder.mjs` (two templates),
`chat/mongodb.js` (3 collections), `chat/MessageHttpController.js` (fire-and-forget call),
`locales/en.json` + `locales/extracted-translations.json`, `server-ce/Dockerfile` (2 ADD lines).

New plumbing:
- `services/web/scripts/run_project_notifications.mjs` — esbuild-based runner for the upstream
  `.mts` (upstream ships no JS runner).
- `server-ce/cron/project-notification-enqueue.sh` + `notification-email-dispatch.sh`
- `server-ce/config/crontab-notifications` + Dockerfile registration
- `services/web/scripts/process_notifications.mjs` (queue processor invocation)
- `docker-compose.yml` (MailHog + commented SMTP env)
- `server-ce/e2e/notifications-smoke.sh` — manual e2e smoke (1 manual step: session cookie)
- Chat: `services/chat/app/js/Features/Notifications/NotificationsManager.js`

**Migration added in the verify pass** (see below):
- `tools/migrations/20260620080000_create_emailNotifications_indexes_serverce.mjs`
  — `server-ce`-tagged, creates the `project_id_1` 24h-TTL index on `emailNotifications`
  (parity with upstream `server-pro`/`saas` chain: 20251016112728 → 20251023094210 →
  20251222142959, whose *net* state is only that index). Needed because CE docker init runs
  `migrations migrate -t server-ce`, so the pro/saas-tagged upstream migrations never apply
  to CE and dead-lettered `emailNotifications` docs would accumulate without TTL.

### Verified findings (verify pass)

1. **Bug found & fixed**: the frontend hook
   `services/web/frontend/js/features/settings/hooks/use-project-notification-preferences.ts`
   reads `preferences.muteAllNotifications` from the **project** GET response and types it as
   `GlobalNotificationPreferencesSchema`. The original implementation returned only the 12
   project keys (flag missing) → "globally muted" UI state would never render, and the type
   didn't have the flag. **Fix**: `getProjectPreferences` now merges the `project_id: null`
   global doc's `muteAllNotifications` into the response; `types.d.ts`'s
   `GlobalNotificationPreferencesSchema` is now that combined shape. Tests updated + one new
   test (15 total, all pass).
2. `emailNotifications` migrations are `server-pro`/`saas`-tagged upstream → CE gets them now
   via the new `server-ce` migration.
3. **No** unique index on `(recipient_id, project_id, emailType)` *anywhere* upstream — dedup
   is application-level upsert everywhere; left as-is (schema decision, out of scope).
4. Upstream dispatch (`services/web/scripts/process_notifications.mjs`) destructures exactly
   the keys my `processNotifications()` returns (incl. `dryRunProcessed`).
5. Queue env parity (`QUEUES_REDIS_*`) between enqueue script and web `QueueWorkers` — OK.
6. Chat manager writes `notifications`/`emailNotifications` docs shape-compatible with the
   standalone bell service and the module processor — OK.

## Unit test command (no services needed)

```bash
cd services/web
yarn vitest run modules/notifications
# 15/15 pass
```

## What's unverified (needs Docker)

- Docker build with the new crontab + launcher
- Cron firing: enqueue (redis timestamp → Bull `project-notification` with `jobId=projectId`)
  → `projectModified` hook → per-member docs → dispatch → MailHog
- esbuild launcher correctness end-to-end in-container (only locally transpile-checked)
- MailHog SMTP path (uncomment `docker-compose.yml` SMTP env + `settings.defaults.js` overrides
  in `server-ce/config/settings.js`)
- E2E smoke: `docker exec ... bash /overleaf/server-ce/e2e/notifications-smoke.sh <proj_id>`

## Quick checklist for next machine

1. `cd /home/davrot/test_llm/new && git push -u origin notification2`
2. `docker build -t overleaf-notification .` (or CI build)
3. `docker compose up mailhog` + uncomment SMTP env, run one container
4. Wait for `web_migrations_done` (new migration `20260620080000` runs in `-t server-ce`)
5. `mongo` check: `db.emailNotifications.getIndexes()` should show `project_id_1`
   with `expireAfterSeconds: 86400`
6. Run the smoke script; fix what it surfaces (expected first-run friction: esbuild path in
   container, crontab line syntax)
7. Optional: chat mocha unit test for `createThreadMessageNotifications` (chat has no jest/
   mocha infra exercised here)

## Known limitations (accepted)

- Chat: one extra mongodb connection in dev (no live chat unit test)
- No rate-limiting on email send (rate limiting is upstream `EmailHandler`'s job)
- Mute-all only via the merged `muteAllNotifications` flag (no server-side fan-out)
- `dry_run` field is informational only (documented)
