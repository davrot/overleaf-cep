# Notifications module

Email notifications for project tracked-changes, plus the user-facing
"email notifications" settings UI.

## Features

1. **Project tracked-changes notification** — when a project is modified and
   the change is not acted on for a grace delay (default 2 minutes), every
   collaborating user who has not muted the notification gets one email
   ("New tracked changes in <project>").
2. **Email preferences** — a session-scoped settings UI (`/settings/emails`)
   to enable/disable email notifications globally or per project, plus an
   immediate "send test email" endpoint (`/user/send-test-email`).

Preferences are stored per user in `db.projectPreferences` as
`trackedChanges.emailNotifications` (global) and per-project in
`project_settings.emailNotifications`. The "owner notified about changes on
own projects" switch uses `emailType: projectNotification`; the "collaborator
notified when I add tracked changes on a project" switch uses
`emailType: trackedChangesNotification`. The two switches are independent.

## Pipeline

```
meta.tc edit
   → document-updater sets redis "ProjectNotificationTimestamp:{projectId}"
       (services/document-updater/src/handlers/ProjectModifiedHandler.mjs)
   → cron (server-ce/cron/project-notification-enqueue.sh, every minute):
       scans stale timestamp keys (older than the grace delay) with
       collaborators, enqueues a Bull job on queue "project-notification",
       deletes the key
   → Bull queue "project-notification" (redis)
   → web container: ProjectNotificationQueueConsumer.mjs (module-owned worker)
       fires the projectModified hook
   → hooks/projectModified.mjs → scheduleProjectChangeNotifications()
       (Preferences.mjs: resolves recipients from project members + prefs,
        upserts one doc per recipient into db.emailNotifications)
   → cron (server-ce/cron/notification-email-dispatch.sh, every minute):
       ProcessNotifications.mjs claims due docs in sorted order, resolves the
       recipient, renders the template, sends via SMTP (EmailHandler)
```

The two crons are registered in `server-ce/Dockerfile` into
`/etc/cron.d/crontab-notifications` (both run as root in the web container).

## Files

| Path | Role |
| --- | --- |
| `app/src/NotificationsPreferencesRouter.mjs` | Settings UI + test-email endpoints; starts the CE queue consumer in `apply()` |
| `app/src/Preferences.mjs` | `scheduleProjectChangeNotifications` — debounce, recipient + permission resolution, `db.emailNotifications` upsert |
| `app/src/ProcessNotifications.mjs` | Dispatch: atomic claim → send → delete / retry; dry-run mode |
| `app/src/ProjectNotificationQueueConsumer.mjs` | CE-only Bull worker for the `project-notification` queue (fires the `projectModified` hook) |
| `app/src/hooks/projectModified.mjs` | Hook handler (upserts scheduled notifications) |
| `app/src/Schemas.mjs` | Zod schemas (project + user settings, API body) |
| `test/unit/src/*.test.mjs` | Vitest unit tests (run from `services/web`) |
| `templates/` | Jinja email templates (`trackedChangesNotification.j2`, `projectNotification.j2`, `testEmail.j2`, `emailLayout.j2`) |

## CE-only consumer: why it lives in this module

In SaaS the Bull queues are consumed by `app/infrastructure/QueueWorkers.mjs`,
which requires `hasFeature('saas')` — and in CE
`Settings.overleaf` is `undefined`, so that worker never starts and the
`project-notification` queue would never be consumed. To keep the port
self-contained (no upstream/queue-module edits), this module starts its own
idempotent worker when saas is off (`startProjectNotificationConsumer`),
wired from the router's `apply()` at web startup. In SaaS the function is a
no-op and the upstream worker keeps exclusive ownership of the queue
(`concurrency` stays 1 — a single job can take ~100ms so a second concurrent
consumer would only re-run the debounce, but two consumers are never needed).

## Configuration (environment)

| Variable | Default | Effect |
| --- | --- | --- |
| `PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS` | `120000` | Grace delay before a change is notified |
| `PROJECT_NOTIFICATION_RETRY_COUNT` | `0` | Bull job attempts on hook failure (`< 0` = infinite) |
| `OVERLEAF_NOTIFICATIONS_MAX_ATTEMPTS` | `5` | Dispatch send retries (then dead-lettered) |
| `OVERLEAF_NOTIFICATION_SILENCE_PERIOD_MS` | `3600000` | Retry backoff window (linear: `n × silence`) |
| `PROCESS_NOTIFICATIONS_BATCH_SIZE` | `100` | Docs processed per dispatch run |
| `OVERLEAF_NOTIFICATIONS_DRY_RUN` | unset | Dispatch resolves+counts but sends nothing; docs stay pending |
| `QUEUES_REDIS_HOST/PORT/PASSWORD` | fall back to `REDIS_*` | Redis for the queue (the enqueue cron sets these from the stack's `REDIS_*`) |

## Redis & Mongo footprint

- `ProjectNotificationTimestamp:{projectId}` — set by document-updater on
  every `meta.tc` change; consumed (deleted) by the enqueue cron.
- `ProjectHasCollaborators:{projectId}` — 5-minute cached collaborator check.
- Bull keys for queue `project-notification` (jobs, locks, counters).
- `db.emailNotifications` (created by the module's `apply()`) — one doc per
  recipient per debounce window; fields: `recipient_id`, `project_id`,
  `emailType` (`projectNotification` owner / `trackedChangesNotification`
  collaborator), `opts`, `scheduledAt`, plus claim state
  (`processing` / `attempts` / `nextRetryAt` / `processingStartedAt`).

## Dispatch claim protocol (ProcessNotifications.mjs)

- Claim = atomic `findOneAndUpdate` of the first claimable doc in
  `scheduledAt` order (`processing` unset/false or stale > 1h), setting
  `processing: true` — safe under concurrent dispatchers.
- On success: delete. On failure: `attempts += 1`, linear backoff
  `attempts × OVERLEAF_NOTIFICATION_SILENCE_PERIOD_MS`; after
  `OVERLEAF_NOTIFICATIONS_MAX_ATTEMPTS` the doc is dead-lettered (`processing`
  stays `true`, `nextRetryAt` unset — it is never reclaimed; the claim stays
  for audit).
- Claim results come back as a *raw document* (legacy mongodb driver shape)
  in production; the code normalizes both shapes at the single point of
  claim (covered by `ProcessNotifications.test.mjs` — regression F7).
- Dry-run (`OVERLEAF_NOTIFICATIONS_DRY_RUN=true`): claims stay in place for
  the whole run (the loop must not re-claim — regression F8) and are released
  in one batch afterwards; the queue is left un-consumed for inspection.

## Cron environment requirements

Both cron scripts `source /etc/container_environment.sh` **and**
`/etc/overleaf/env.sh` before starting their node processes (the container
environment file provides `REDIS_HOST`, `OVERLEAF_MONGO_URL`,
`CRYPTO_RANDOM`). The enqueue cron must run with
`cwd=/overleaf/services/document-updater` because `@overleaf/settings`
resolves `redis.documentupdater.key_schema` from the CWD's config.

## Testing

```sh
cd services/web
yarn vitest run modules/notifications          # all unit tests (5 files, 21 tests)
npx eslint --cache --cache-location ./.cache/eslint/ --max-warnings 0 --format unix modules/notifications
```

`ProcessNotifications.dry.test.mjs` runs in its own module instance because
`DRY_RUN` is captured at import time.

## Verification on a live stack (dry run, no mail sent)

```sh
# 1. schedule a change (past the grace delay)
docker exec overleafredis redis-cli SET "ProjectNotificationTimestamp:{<projectId>}" \
  "$(date -u -d '-60 seconds' +%s%3N)"
# 2. enqueue
docker exec overleafserver bash /overleaf/cron/project-notification-enqueue.sh
# 3. consumer hook must have upserted pending docs
docker exec overleafmongo mongosh sharelatex --quiet \
  --eval 'print((c=>c===0?"NONE — check consumer logs":c)(db.emailNotifications.countDocuments({})))'
# 4. dry-run dispatch (no send; docs stay pending)
docker exec -e OVERLEAF_NOTIFICATIONS_DRY_RUN=true overleafserver \
  bash /overleaf/cron/notification-email-dispatch.sh
# 5. clean up
docker exec overleafmongo mongosh sharelatex --quiet --eval 'db.emailNotifications.deleteMany({})'
```

## Operational notes & known quirks

- Debounce is per *change batch*: the redis key marks "change not yet acted
  on"; accepting/rejecting the changes updates `meta.tc` and resets the
  window. This means: multiple changes within the delay notify once, one
  email per project per change batch.
- A Bull job left `active` by a killed container generation remains until
  its lock/expiry is cleared (stalled-check); if a ghost job shows up in
  `q.getJobCounts().active`, remove it via its redis keys
  (`bull:project-notification:<id>[:lock]`, LREM from `:active`).
- `settings.email` must be configured (SMTP) for real sends; the dev stack
  uses `smtp.uni-bremen.de:465` (secure) as the uni mail gateway.
- SaaS deployments: do nothing — the upstream QueueWorkers owns the queue
  there; the module consumer is a no-op when saas is on.
