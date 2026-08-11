# Dropbox Integration Module

This module provides an opt-in Dropbox integration for Overleaf Community Edition.

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DROPBOX_ENABLED` | Enable/disable the Dropbox module | `true` or `false` (default: `false`) |
| `DROPBOXINTERFACE_API_URL` | URL of the dropboxinterface microservice | `http://localhost:4003` |
| `DROPBOX_APP_KEY` | Dropbox OAuth app key | `your-app-key` |
| `DROPBOX_APP_SECRET` | Dropbox OAuth app secret | `your-app-secret` |

The OAuth redirect URI configured in the Dropbox app must be:

```
https://your-overleaf-host/user/dropbox/oauth/callback
```

## Setup

### 1. Enable the Module

Add to your `.env` file:
```bash
DROPBOX_ENABLED=true
```

### 2. Start the Dropbox Interface Microservice

The module requires `services/dropboxinterface` to be running:

```bash
cd /root/junk_webdav/overleaf-cep/services/dropboxinterface
npm start
```

Or use the autostart script:
```bash
/root/junk_webdav/overleaf-cep/server-ce/runit/dropboxinterface-overleaf/run
```

### 3. Configure Dropbox OAuth

1. Create a Dropbox app at [https://www.dropbox.com/developers/apps](https://www.dropbox.com/developers/apps).
2. Set `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET` in the Overleaf environment.
3. Add `https://your-overleaf-host/user/dropbox/oauth/callback` to the Dropbox app's redirect URIs.
4. Users can connect their Dropbox accounts from the settings widget. The server performs the OAuth code exchange and stores the access token encrypted; users do not paste an access token.

## API Endpoints

### User Connection Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/user/dropbox/oauth2` | Start the Dropbox OAuth flow |
| `GET` | `/user/dropbox/oauth/callback` | Complete OAuth and store the encrypted token |
| `GET` | `/user/dropbox/status` | Get connection status for current user |
| `POST` | `/user/dropbox/connect` | Legacy direct-token connection endpoint |
| `POST` | `/user/dropbox/disconnect` | Disconnect from Dropbox |

### Project Synchronization

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/project/:project_id/dropbox/state` | Get sync state for a project |
| `POST` | `/project/:project_id/dropbox/link` | Link project to user's Dropbox |
| `DELETE` | `/project/:project_id/dropbox/state` | Unlink project from Dropbox |
| `POST` | `/project/:project_id/dropbox/pull` | Pull remote changes into Overleaf |
| `POST` | `/project/:project_id/dropbox/push` | Push local changes to Dropbox |
| `GET` | `/project/:project_id/dropbox/files` | List files in project's Dropbox folder |
| `POST` | `/project/:project_id/dropbox/conflict/resolve` | Resolve a sync conflict |

## Sync Behavior

### Manual Sync Operations

- Click "Pull" to check for and download changes from Dropbox
- Click "Push" to upload local Overleaf changes to Dropbox
- Conflict detection using Dropbox's `rev` property

**Note**: The module uses manual triggers instead of automatic polling. Files are only synchronized when you explicitly click Pull or Push.

## File Sync Strategy

1. **Revision-based comparison** using Dropbox's `rev` property (like ETags for WebDAV)
2. Change detection: Compares current project version with last synced version
3. Conflict resolution: User chooses to keep local or remote version

## Frontend Components

- `dropbox-widget.tsx` - User settings widget
- `dropbox-integration-card.tsx` - Project integrations panel card
- `dropbox-sync-modal.tsx` - Sync operations modal with pull/push buttons

## Encryption

OAuth access tokens are stored encrypted in the database using AES-256-GCM encryption.

**Important**: The module uses `DROPBOXINTERFACE_API_URL` environment variable to connect to the dropboxinterface microservice, not token encryption (that's handled by the microservice).

## Usage Example

### Connect a User to Dropbox

```javascript
// Start OAuth in a browser while authenticated
open https://your-overleaf-host/user/dropbox/oauth2
```

### Pull Remote Changes

```javascript
curl -X POST http://localhost:3000/project/12345/dropbox/pull \
  -H "Cookie: overleaf_session_id=..."
```

### Check Connection Status

```javascript
curl http://localhost:3000/user/dropbox/status
// Response: {"connected": true, "path": "...")
```

## Differences from WebDAV Module

| Aspect | WebDAV | Dropbox |
|--------|--------|---------|
| **Auth** | Basic Auth (username/password) | OAuth 2.0 access token |
| **Versioning** | ETags (`getetag`) | Revision strings (`rev`) |
| **SDK** | `webdav` npm package | `dropbox` npm package |
| **API Style** | HTTP methods + WebDAV verbs | Pure RESTful JSON API |

## References

- [Dropbox Interface Microservice](../../../dropboxinterface/)
- [Dropbox SDK Documentation](https://dropbox.github.io/dropbox-sdk-js/)
