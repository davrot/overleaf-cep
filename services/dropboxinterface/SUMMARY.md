# Dropbox Interface Microservice - Summary

## Overview

Design an Overleaf microservice to handle Dropbox API V2 communication, following the same architectural pattern as `services/webdavinterface`.

**Current Phase**: Design & Planning  
**Next Steps** (when approved): Implementation → Testing → Deployment

## Project Structure

```
services/dropboxinterface/
├── app/src/
│   ├── DropboxClient.mjs     # Core client with Dropbox SDK
│   ├── auth.mjs              # Token validation helpers
│   ├── server.mjs            # Express HTTP interface
│   └── index.mjs             # Entry point
├── test/unit/                # Unit tests (Vitest)
└── package.json              # dropbox@^10.44.0 dependency
```

## Key Differences from WebDAVInterface

| Aspect | WebDAVInterface | DropboxInterface |
|--------|----------------|------------------|
| **Authentication** | Basic Auth (username/password) | OAuth 2.0 access token (`sl.***`) |
| **Versioning** | ETags (via PROPFIND) | Revision strings (`rev` property) |
| **SDK** | `webdav` npm package | `dropbox` npm package |
| **API Style** | HTTP methods + WebDAV verbs | Pure RESTful JSON API |

## Core API Endpoints

```
GET  /health                          - Health check
POST /check                           - Verify access token validity
POST /list                            - List directory contents
GET  /file?path={p}                   - Download file (base64)
POST /file                            - Upload file with rev checking
DELETE /file?path={p}                 - Delete file
POST /mkdir                           - Create folder
POST /move?src={sp}&dst={dp}          - Move/rename
```

## Technology Stack

### Primary Dependencies
- **dropbox@^10.44.0** - Official Dropbox SDK for Node.js/Browser
  - Full TypeScript support
  - OAuth token management
  - Comprehensive error handling

### Optional/Dev Dependencies
- **vitest** - Unit testing
- **express** - HTTP server
- **supertest** - Integration testing

## Key Implementation Details

### Token Validation
Dropbox tokens start with `sl.` or `dp.` (e.g., `sl.ABC123...`)

### Revision Tracking
- Dropbox's `rev` property replaces ETags for conflict detection
- Format: `"3a00e6b57"` (hexadecimal hash)
- Upload with `mode: "update"` and `rev` for conditional updates

### Error Mapping
| Dropbox Error | HTTP Status |
|--------------|-------------|
| rate_limit_exceeded | 429 |
| invalid_access_token | 401 |
| path/not_found | 404 |
| conflict/file | 409 |

## Configuration

In `services/web/config/settings.defaults.js`:

```javascript
dropboxinterface: {
  api_url: process.env.DROPBOXINTERFACE_API_URL || 'http://localhost:4003',
}
```

Environment variables:
- `DROPBOXINTERFACE_PORT=4003`
- `DROPBOXINTERFACE_HOST=127.0.0.1`

## Security Considerations

- ✅ Access tokens must be stored encrypted in database
- ✅ Validate token format before each API call
- ✅ Sanitize tokens in logs (show first 10 + last 4 chars)
- ⚠️ Dropbox enforces aggressive rate limits (~10k calls/hour per user)

## OAuth 2.0 Flow

**Note**: This service receives ready-to-use tokens; the web service handles actual OAuth flow:
1. Web service handles user redirect to Dropbox consent screen
2. Exchanges authorization code for access token (server-side)
3. Stores encrypted token in database
4. Passes token to dropboxinterface for API calls

## Next Steps

1. Create directory structure
2. Implement core files (see `plan_dropboxinterface.md`)
3. Write unit tests
4. Lint check: `eslint --max-warnings 0`
5. Test with real Dropbox OAuth token
6. Deploy to staging
