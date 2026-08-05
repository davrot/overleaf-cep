# Dropbox integration

The module implements Dropbox OAuth and the Dropbox Files API directly. Tokens,
the Dropbox account id, and the list-folder cursor are encrypted and stored in
the module-owned `dropboxUserCredentials` collection.

Set `DROPBOX_ENABLED=true`, `DROPBOX_APP_KEY`, and `DROPBOX_APP_SECRET` for the
Dropbox application. The
OAuth redirect URI is `/dropbox/completeRegistration` below `Settings.siteUrl`.
Projects are synchronized below the Dropbox app folder at `/<project-name>` and polling uses
Dropbox list-folder cursors. Set `DROPBOX_POLL_INTERVAL_MS` to enable background
polling; webhook requests can trigger polling independently. Set
`DROPBOX_ENABLED=false` (or omit it) to disable the module. When disabled, the
Dropbox settings widget and routes are unavailable.

Dropbox OAuth tokens are encrypted before they are stored. In production, set
`DROPBOX_TOKEN_CIPHER_PASSWORD` to a persistent secret, or mount a persistent
`DROPBOX_TOKEN_CIPHER_FILE` at `/var/lib/overleaf/data/.dropbox-token-cipher.json`.
The default cipher label is `OL_DROPBOX-v3`.

## Create a Dropbox app

1. Sign in to Dropbox and open the [Dropbox App Console](https://www.dropbox.com/developers/apps). Select **Create app**.
2. Select **Scoped access** as the API type.
3. Select **App folder** as the access type. Dropbox makes this folder available to the integration as its API root, so the app can access only its own folder under `/Apps/<app-name>`.
4. Enter a unique app name and create the app.
5. Open the app's **Settings** tab. In the **OAuth 2** section, add the complete redirect URI:
	`${Settings.siteUrl}/dropbox/completeRegistration`

	For example: `https://overleaf.example.com/dropbox/completeRegistration`.
6. In **App credentials**, copy **App key** to `DROPBOX_APP_KEY`. Select **Show** next to **App secret** and copy the value to `DROPBOX_APP_SECRET`.
7. Open the **Permissions** tab and enable these scopes:
	- `account_info.read`
	- `files.metadata.read`
	- `files.metadata.write`
	- `files.content.read`
	- `files.content.write`

	`account_info.read` is used to identify the connected Dropbox account. The file and metadata permissions are needed for background polling, file synchronization, and creating, moving, and deleting project folders. Apply the permission changes in the Dropbox console before connecting an account.

If the Dropbox app was previously configured with **Full Dropbox**, change the
access type in the app console and reconnect every linked account so that users
receive tokens with the new restricted permissions. Existing tokens do not gain
the App folder restriction automatically.

Project creation, modification, flush, entity moves, and deletion are connected
to the module hook system. Remote project folders can create empty Overleaf
projects, and remote file changes are merged through the existing update handler.
Remote revisions are persisted to prevent stale overwrites. Conflicts are
available through the status endpoint and can be resolved with
`keep-local`/`keep-remote` in the settings widget or project resolve route.