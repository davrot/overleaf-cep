# Dropbox Integration Module - Detailed Implementation Plan

## Overview

This document outlines the implementation of `services/web/modules/dropbox`, a new integration module for Overleaf Community Edition that connects to Dropbox API V2 via the `dropboxinterface` microservice.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Browser                             │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────────┐ │
│  │   Frontend  │◄──│   DropboxModule  │◀──│ dropboxinterface │ │
│  └─────────────┘   └──────────────────┘   └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
                             ▲
                             │ HTTP (OAuth 2.0)
                             │
                    ┌────────────────┐
                    │    Dropbox     │
                    │     API v2     │
                    └────────────────┘
```

## Module Structure

### Backend (`app/`)

#### Core Files

1. **DropboxClient.mjs** (HTTP Layer)
   - Purpose: Communicate with dropboxinterface microservice
   - Key methods:
     - `checkConnection()` - Verify microservice connectivity
     - `list(path)` - List Dropbox directory contents
     - `download(path)` - Download file (returns base64)
     - `upload(path, content, rev)` - Upload file with versioning
     - `delete(path)` - Delete file from Dropbox
     - `createDirectory(path)` - Create folder

2. **DropboxCredentials.mjs** (Token Security)
   - Purpose: Encrypt/decrypt access tokens using AES-256-GCM
   - Key methods:
     - `encryptToken(token)` - Store encrypted token in DB
     - `decryptToken(encryptedData)` - Decrypt for API calls

3. **DropboxRouter.mjs** (HTTP Routes)
   - Purpose: Register Express routes with web service
   - Endpoint categories:
     - User connection management (connect/disconnect/status)
     - Project sync state management
     - Pull/push operations

#### Models (`app/models/`)

1. **dropboxUserCredentials.mjs**
   - Fields: `userId`, `accessToken` (encrypted)
   - Purpose: Store encrypted OAuth tokens per user

2. **dropboxSyncProjectStates.mjs**
   - Fields: `projectId`, `connected`, `path`, `lastSyncRev`, `mergeStatus`
   - Purpose: Track project sync state with Dropbox

### Frontend (`frontend/`)

#### Components

1. **dropbox-widget.tsx** (User Settings)
   - Show/disconnect from Dropbox
   - Display last sync status

2. **dropbox-integration-card.tsx** (Project Panel)
   - Integration panel entry point
   - Triggers sync modal

3. **dropbox-sync-modal.tsx** (Sync Operations)
   - Link/unlink project to Dropbox
   - Pull remote changes
   - Push local changes
   - Resolve conflicts

4. **dropbox-logo.tsx**
   - Simple SVG logo for UI integration

## API Endpoints

### User Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/user/dropbox/status` | Get Dropbox connection status |
| POST | `/user/dropbox/connect` | Connect with OAuth token |
| POST | `/user/dropbox/disconnect` | Disconnect account |

### Project Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/project/:id/dropbox/state` | Get sync state |
| POST | `/project/:id/dropbox/link` | Link project to Dropbox |
| DELETE | `/project/:id/dropbox/state` | Unlink project |
| POST | `/project/:id/dropbox/pull` | Pull remote changes |
| POST | `/project/:id/dropbox/push` | Push local changes |
| GET | `/project/:id/dropbox/files` | List Dropbox files |

## Differences from WebDAV Module

| Aspect | WebDAV | Dropbox |
|--------|--------|---------|
| Authentication | Basic Auth (username/password) | OAuth 2.0 access token |
| Token Storage | Encrypted with `WEBDAV_TOKEN_CIPHER_PASSWORD` | Same encryption scheme |
| Versioning | ETags (`getetag`) | Revision strings (`rev`) |
| API Style | HTTP + WebDAV verbs | Pure REST JSON |
| File Operations | PROPFIND, GET, PUT, DELETE | filesListFolder, filesDownload, filesUpload |

## Configuration

### Environment Variables

```bash
# Enable the module
DROPBOX_ENABLED=true

# Dropbox interface microservice URL
DROPBOXINTERFACE_API_URL=http://localhost:4003
```

## Setup Steps

1. **Enable Module**: Set `DROPBOX_ENABLED=true` in environment
2. **Start Microservice**: Run dropboxinterface on port 4003
3. **User Connects**: User authenticates via OAuth flow, token stored encrypted
4. **Project Linking**: Project managers link their projects to user's Dropbox

## Sync Strategy

1. **Pull (Dropbox → Overleaf)**:
   - List files in project folder with `rev` values
   - Compare with local file checksums
   - Download changed/missing files

2. **Push (Overleaf → Dropbox)**:
   - Walk local project directory
   - Compute checksums for all files
   - Upload changed files using `rev` for conflict detection

3. **Conflict Detection**:
   - Based on `rev` mismatch between Dropbox and Overleaf
   - User chooses: keep local or keep remote

## Security Considerations

- ✅ Access tokens encrypted before database storage
- ✅ Token sanitization in logs (show only first 10 + last 4 chars)
- ✅ No plain text tokens in API responses
- ⚠️ Requires HTTPS in production for OAuth flow
- ⚠️ Microservice endpoint should be internal only

## Testing Checklist

- [ ] Module loads when `DROPBOX_ENABLED=true`
- [ ] Tokens encrypt/decrypt correctly
- [ ] Microservice calls succeed/fail appropriately
- [ ] User can connect/disconnect Dropbox account
- [ ] Project can be linked/unlinked
- [ ] Pull operation fetches changes
- [ ] Push operation uploads changes
- [ ] Conflict detection works with `rev` property

## Future Enhancements

- Auto-sync triggers (timers)
- Batch operations for efficiency
- Webhook support for push notifications
- Team folder support
- Paper document synchronization

## References

- Dropbox SDK: https://github.com/dropbox/dropbox-sdk-js
- Dropbox API v2: https://www.dropbox.com/developers/documentation/http
- dropboxinterface Plan: `../dropboxinterface/plan_dropboxinterface.md`
