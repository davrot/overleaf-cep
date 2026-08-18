# Git Provider Sync Module

Synchronizes Overleaf projects with repositories on **GitHub, GitLab, Gitea,
or Forgejo** using the user's personal access token (PAT). The git wire
protocols (clone/push/commit) and provider REST calls are proxied through the
`githubinterface` microservice, which keeps the PAT out of the main web
process.

## Supported providers

| Capability | GitHub | GitLab | Gitea | Forgejo |
| --- | --- | --- | --- | --- |
| Link / unlink PAT (settings widget) | ✅ | ✅ | ✅ | ✅ |
| Export project → new repo (push) | ✅ | ✅ | ✅ | ✅ |
| Import repo → new project (pull) | ✅ | ✅ | ✅ | ✅ |
| Merge overview (remote commits since last sync) | ✅ | ✅ | ✅ | ✅ |
| Auto-merge remote commits into project | ✅ | ❌ 501 | ❌ 501 | ❌ 501 |

The merge engine uses the GitHub v3 **git-data REST API** (`git/ref`,
`git/blobs`, `git/trees`, `git/commits`, `POST /merges`). GitLab does not
expose that API. Gitea/Forgejo ship a GitHub-compatible `/api/v3`, but it
**lacks the git-data endpoints** (verified 2026-08: `git/ref`, `git/blobs`,
`git/trees`, `merges` all 404 on gitea.com and v15.next.forgejo.org), so for
every non-GitHub provider the merge endpoint returns a 501 with a clear
message while import (pull) and export (push) continue to work.

## Configuration

### Optional: GitHub OAuth2 convenience flow

```js
githubSync: {
  clientID: '...',        // GitHub OAuth App client id
  clientSecret: '...',    // GitHub OAuth App client secret
  callbackURL: 'https://overleaf.example.com/user/github-sync/oauth2/callback',
}
```

Only used for the GitHub OAuth redirect flow (`/user/github-sync/oauth2`);
PAT linking works without it. The exposed flag
`ol-ExposedSettings.githubSyncEnabled` (true when both clientID and clientSecret
are set) also gates the git-provider card in the IDE integrations rail.

### Required: microservice endpoint

| Variable | Default |
| --- | --- |
| `GITHUBINTERFACE_API_URL` | `http://localhost:4013` |

### Encryption

PATs are encrypted with the shared access-token cipher
(`WEBDAV_TOKEN_CIPHER_PASSWORD` + `WEBDAV_TOKEN_CIPHER_FILE`, default
`/var/lib/overleaf/data/.token-cipher.json`) — the same key material the
WebDAV module uses. If the cipher file exists it is loaded, so no environment
variable is needed at runtime.

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/user/git-pat/link` | Link a PAT (`provider`, `url`, `username`, `pat`) |
| `GET` | `/user/git-servers` | List linked git servers (no secrets) |
| `DELETE` | `/user/git-servers/:id` | Unlink a server |
| `POST` | `/user/git-servers/test` | Test that a PAT is accepted (REST `/user`, git-protocol fallback) |
| `GET` | `/user/github-sync/status` | Connection status + linked providers |
| `GET` | `/user/github-sync/orgs` | User + orgs for the linked server |
| `GET` | `/user/github-sync/repos` | List repos (`provider`, `serverUrl`) |
| `POST` | `/project/new/github-sync` | Create a project from an existing repo |
| `POST` | `/project/:project_id/github-sync/export` | Export the project to a new repo |
| `GET` | `/project/:project_id/github-sync/state` | Sync state (`mergeStatus`, `repoFullName`, …) |
| `GET` | `/project/:project_id/github-sync/merge/overview` | Commits on the remote branch since `lastSyncCommit` + divergence flag |
| `POST` | `/project/:project_id/github-sync/merge` | Merge remote commits in (GitHub only) |
| `DELETE` | `/project/:project_id/github-sync` | Unlink project (removes state; repo stays) |
| `GET` | `/user/github-sync/oauth2` | Start GitHub OAuth flow (only meaningful when configured) |
| `GET` | `/user/github-sync/oauth2/callback` | OAuth callback; token stored in the GitHub PAT slot |

## State model

`githubSyncProjectStates` (one doc per project):

| Field | Notes |
| --- | --- |
| `repoFullName`, `defaultBranchName` | linked repo |
| `lastSyncCommit`, `lastSyncVersion` | baseline for the divergence check |
| `mergeStatus` | `clean` \| `conflict` \| `diverged` (plus computed `need-export`/`need-permission` read-time states) |
| `syncProvider`, `syncServerUrl`, `syncUsername` | **required for multi-provider links**: without them `resolveCreds()` falls back to the GitHub defaults and every non-GitHub link breaks (state docs written before these fields existed only support GitHub) |
| `ownerId` | used for deleted-user credential cleanup |

## Frontend

- user/settings: `github-sync-widget.tsx` (provider table + add-provider)
- project page: `github-integration-card.tsx`, `github-sync-widget.tsx` (rail)
- modals: `git-provider-modal` (link PAT), `git-sync-export-modal`,
  `git-sync-merge-modal`, plus conflict/need-auth/cannot-export states

## Security notes

- PATs are stored encrypted; the microservice receives them per request in the
  JSON body / header and never persists them.
- `serverUrl` of linked servers is validated (http(s), non-empty) before use.
- Unlinking a project only removes Overleaf-side state — the remote repo is
  not deleted.
