# Dropbox integration

The module implements Dropbox OAuth and the Dropbox Files API directly. Tokens,
the Dropbox account id, and the list-folder cursor are encrypted and stored in
the module-owned `dropboxUserCredentials` collection.

Set `DROPBOX_ENABLED=true`, `DROPBOX_APP_KEY`, and `DROPBOX_APP_SECRET` for the
Dropbox application. The
OAuth redirect URI is `/dropbox/completeRegistration` below `Settings.siteUrl`.
Projects are synchronized below `/Apps/Overleaf/<project-name>` and polling uses
Dropbox list-folder cursors. Set `DROPBOX_POLL_INTERVAL_MS` to enable background
polling; webhook requests can trigger polling independently. Set
`DROPBOX_ENABLED=false` (or omit it) to disable the module. When disabled, the
Dropbox settings widget and routes are unavailable.

Project creation, modification, flush, entity moves, and deletion are connected
to the module hook system. Remote project folders can create empty Overleaf
projects, and remote file changes are merged through the existing update handler.
Remote revisions are persisted to prevent stale overwrites. Conflicts are
available through the status endpoint and can be resolved with
`keep-local`/`keep-remote` in the settings widget or project resolve route.