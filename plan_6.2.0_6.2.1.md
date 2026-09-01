# Plan: transfer docker image diff 6.2.0 → 6.2.1 into overleaf-cep

Input: `../6.2.0-6.2.1/6.2.0-6.2.1.txt` — output of
`container-diff diff daemon://docker.io/sharelatex/sharelatex:6.2.0 daemon://docker.io/sharelatex/sharelatex:6.2.1 --type=file --type=apt --type=pip --type=history`

Goal: split the diff into three buckets and transfer bucket B (source changes) into this
project on a new branch `6.2.1`; filter out bucket C (docker build artifacts).

## 1. Bucket A — apt / pip / history: NONE

The apt, pip and history sections are all empty ("None" / no lines).
No apt packages were added, removed or version-changed between the two images.
⇒ **No change needed in `server-ce/Dockerfile` / `server-ce/Dockerfile-base` for apt.**
(Only re-check that a rebuild from `server-ce/` reproduces the same base packages.)

## 2. Bucket B — changed source files (MUST transfer)

Exactly **two** changed files are git-tracked sources of this repo:

| Image path | Repo path | Size change |
|---|---|---|
| `/overleaf/services/real-time/app/js/Router.js` | `services/real-time/app/js/Router.js` | 18K → 18.9K |
| `/overleaf/services/web/frontend/js/vendor/libs/sharejs.js` | `services/web/frontend/js/vendor/libs/sharejs.js` | 47.8K → 50.1K |

No other changed file is a tracked source. Both must be carried over to branch `6.2.1`.

## 3. Bucket C — docker build artifacts (FILTER OUT, do not transfer)

### Changed but generated (no source equivalent)
| Path | Why generated |
|---|---|
| `/overleaf/.yarn/install-state.gz` | yarn install cache (no `package.json`/`yarn.lock` in the changed list ⇒ no dependency change) |
| `/overleaf/services/web/public/manifest.json` | **not tracked in this repo** — webpack manifest regenerated at build time |

### Added files (all generated, 4984 entries total)
| Path prefix | Count | Why generated |
|---|---|---|
| `/root/.cache/node-gyp/**` | 3327 | node-gyp native build cache |
| `/overleaf/services/web/.cache/**` (mostly babel-loader) | 1648 | babel-loader transpile cache |
| `/overleaf/services/web/public/js/873-4a1ccb907f031db9fc42.js(.map)` | 2 | webpack chunk — build output, not source |
| `/tmp/node-compile-cache/**`, `/tmp/node-jiti`, `/tmp/core-js-banners`, `/root/.cache/rosetta` | ~5 | node runtime temp/cache |

**Verification that bucket C is closed:** no added path resolves to a git-tracked file
(checked with `git ls-files`), and no added path lies outside the known-generated
directories listed above.

Note on `sharejs.js`: it lives under `services/web/frontend/js/vendor/libs/` and is
referenced from frontend TS sources (`share-js-doc.ts`, `realtime.ts`) — it is part of
the shipped source tree, not a build artifact, which is why it is bucket B.

## 4. Execution steps

### Step 0 — create the transfer branch
```bash
git switch -c 6.2.1
```

### Step 1 — extract the target files from the 6.2.1 image (sanity-check the 6.2.0 ones first)
```bash
cd /home/davrot/image_mining
mkdir -p extract/620 extract/621
docker run -d --name tmp620 sharelatex/sharelatex:6.2.0 sleep 1
docker run -d --name tmp621 sharelatex/sharelatex:6.2.1 sleep 1

# 6.2.0 baseline — must match the current repo (proves the repo is in sync with the image)
docker cp tmp620://overleaf/services/real-time/app/js/Router.js extract/620/Router.js
docker cp tmp620://overleaf/services/web/frontend/js/vendor/libs/sharejs.js extract/620/sharejs.js
docker stop tmp620 && docker rm tmp620

# 6.2.1 target
docker cp tmp621://overleaf/services/real-time/app/js/Router.js extract/621/Router.js
docker cp tmp621://overleaf/services/web/frontend/js/vendor/libs/sharejs.js extract/621/sharejs.js
docker stop tmp621 && docker rm tmp621

diff extract/620/Router.js services/real-time/app/js/Router.js     # expect: empty
diff extract/620/sharejs.js services/web/frontend/js/vendor/libs/sharejs.js  # expect: empty
```

### Step 2 — apply the source changes
```bash
# review first
diff extract/621/Router.js services/real-time/app/js/Router.js
diff extract/621/sharejs.js services/web/frontend/js/vendor/libs/sharejs.js
# then copy
cp extract/621/Router.js services/real-time/app/js/Router.js
cp extract/621/sharejs.js services/web/frontend/js/vendor/libs/sharejs.js
```

### Step 3 — commit
```bash
git add services/real-time/app/js/Router.js services/web/frontend/js/vendor/libs/sharejs.js
git commit -m "Transfer 6.2.1 source changes (sharelatex image diff 6.2.0 -> 6.2.1)"
```

### Step 4 — verify
- `git status` on branch `6.2.1` shows only the two files changed.
- (Optional, heavy) rebuild the image from `server-ce/` with the updated sources and
  re-run `container-diff` against `sharelatex:6.2.1`; only bucket C entries plus the
  rebuilt `manifest.json`/public chunks should remain.

## 5. Out of scope (explicitly)
- `.yarn/install-state.gz`, `public/manifest.json`, `services/web/public/**`,
  `.cache/**`, `/root/.cache/**`, `/tmp/**` — build artifacts, no repo action.
- apt/base image updates — none present in this diff window.
