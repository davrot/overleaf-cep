# WebDAV integration

This module provides an opt-in WebDAV integration for Nextcloud and other WebDAV servers.

Enable it with:

```text
WEBDAV_ENABLED=true
WEBDAV_ROOT_PATH=/Overleaf
WEBDAV_POLL_INTERVAL_MS=300000
```

`WEBDAV_ROOT_PATH` is relative to the configured WebDAV endpoint. For Nextcloud, `baseUrl` is typically a user endpoint such as:

```text
https://cloud.example/remote.php/dav/files/alice
```

The account credentials are encrypted before being stored in the module-owned `webdavUserCredentials` collection. Set `WEBDAV_TOKEN_CIPHER_PASSWORD` explicitly in production, or provide a persistent `WEBDAV_TOKEN_CIPHER_FILE`.

Routes:

- `POST /user/webdav/connect` with `baseUrl`, `username`, `password`, and optional `rootPath`
- `GET /user/webdav/status`
- `POST /user/webdav/disconnect`
- `POST /user/webdav/poll`
- `POST /project/:project_id/webdav/sync`

When connected, the status response also includes `lastSyncAt` and
`lastSyncError` for the most recent synchronization attempt, plus
`lastConflict` when an ETag-protected update detects a concurrent remote edit.

Transient WebDAV failures are retried with exponential backoff. The retry
count and initial delay can be configured with `WEBDAV_RETRY_COUNT` and
`WEBDAV_RETRY_DELAY_MS`.

Outbound updates include `If-Match` for files with a known remote ETag, so a
concurrent remote edit fails instead of being silently overwritten. Renaming
a project also moves its persisted WebDAV sync state to the new name.

Remote file state records the last known ETag, modification metadata, relative
path, and reconciled local entity ID/type where available. This provides a
stable basis for future external rename and conflict-resolution workflows.

The settings widget is available only when `WEBDAV_ENABLED=true`. Empty
remote folders are ignored; a remote project is created or updated when it
contains supported files. Conflicts are reported in the status widget and can
be retried after resolving the remote change.

Inbound polling creates and updates projects through the existing TPDS update handler and reconciles deleted remote files. Polling stores WebDAV ETag metadata, falling back to modification time and size, so unchanged files are not downloaded again. Connecting performs an initial poll, and project modifications and full project flushes trigger automatic outbound synchronization for linked users with write access. Project renames move the corresponding WebDAV folder. Recently imported remote changes are temporarily suppressed per user and project from outbound re-sync to avoid poll/push loops. The module tracks successfully synchronized project names so deleted remote project folders can be reflected as externally deleted Overleaf projects without affecting unrelated local projects. The project sync route remains available for manual retries.
