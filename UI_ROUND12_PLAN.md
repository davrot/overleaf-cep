# UI Round 12 — Plan (2026-08-31, night run)

Context: UI Round 11 (batches A–F) is code-complete and deployed (build 42,
image `569d3be4…bae102`). During the overnight verification the user found
that **all admin site settings under `/admin/site` had vanished** (P0), plus
14 live-UI feedback items. This plan covers recovery + fixes + verification.
Executed autonomously (user asleep); status below is updated as it progresses.

---

## Phase 0 — P0: restore the stored site settings  ✅ DONE

- All 12 sections PUT via the admin API + round-trip verified (matrix below);
  `templates` section was re-saved by the admin at 01:18 and kept intact.
- **Snapshot-backup hardening** shipped: every `setSection` now writes a
  timestamped full-document copy to `site_settings_snapshots` (last 10 kept)
  so the previous state is one command away; + 2 regression tests (save A,
  save B, both remain + snapshot exists) — 27/27 pass.
- **Recovery tooling** committed: `tools/restore-site-settings.mjs` (host
  tool, idempotent, `RESTORE_ALL=1` to force; values reconstructed from:
  `/data_1/docker/compose_cep/.env`,
  `/data_1/docker/compose_cep/overleafserver/compose.yaml.bak-sp`,
   `SSO_TEST_ENV_README.md`, and live test-IdP endpoints (SAML X509 cert from
   IdP metadata; OIDC client secret re-registered on the running IdP).

**Recovery matrix** (all values verified round-trip via `GET /admin/site-settings`):

| Section           | Restored from                                        | Verified |
|---|---|---|
| email        | `.env` (smtp.uni-bremen.de:465, overleaf@uni-bremen.de, secure, skipConfirmation) | ⏳ |
| sso-saml     | README + live `saml:8081` metadata (X509 cert)       | ⏳ |
| sso-oidc     | README + `oidc:8080` (client secret re-registered)   | ⏳ |
| sso-ldap     | README + `ldap:389` (bind creds tested with ldapsearch) | ⏳ |
| sandboxed-compiles | `compose.yaml.bak-sp` (3 TeXLive images, hostdir, socket `/var/run/docker.sock`, www-data) | ⏳ |
| zotero       | `compose.yaml.bak-sp`                               | ⏳ |
| git-integration | `compose.yaml.bak-sp` (git-bridge:8000)            | ⏳ |
| github-sync  | `compose.yaml.bak-sp`                               | ⏳ |
| pandoc       | `compose.yaml.bak-sp` (pandoc:6.2.0)                | ⏳ |
| linked-file-types | `compose.yaml.bak-sp` (project_file, project_output_file, url, zotero) | ⏳ |
| externalUrl  | permissive defaults (bundle import-from-URL E2E)    | ⏳ |
| signup       | enabled, domain `*`                                | ⏳ |
| templates    | already saved (01:18 save kept)                     | ⏳ |

---

## Phase 1 — user feedback items (from the night message)

| #  | Item | Root cause → fix |
|----|------|------------------|
| R12-1 | Sandboxed compiles: TeXLive image table empty; save → 422 "images must be a non-empty array" | Empty because the stored section was wiped (Phase 0 restores the 3 images). Harden: `SandboxedCompilesTab` seeds the table from the env defaults (`ALL_TEX_LIVE_DOCKER_IMAGES`) when the stored value is empty, so the tab is always usable. |
| R12-2 | `/admin/site` sidebar shows a second Theme fieldset "outside the menu" — remove it | R11-11 placed the selector in `ManageSidebar` above the account. User wants it only inside the Account menu (which already has the theme toggle). → remove the sidebar fieldset. |
| R12-3 | Navbar links: `Library`/`Templates` render `subdued` (wrong) instead of the round-button style of `Projects` — on every listed user page | `.subdued` class from the DS nav styling; `.nav-item-projects` is the correct pill. → CSS: drop `.subdued` de-emphasis; all three links get the same pill treatment (active via `nav-item-<key>`). |
| R12-4 | "Header not reactive to dark/light mode" on user pages | R11 batch A forced the navbar `#fff` in both themes. User now wants theme-following headers (dark header in dark mode) on user pages; admin pages keep the red gradient signal. → remove the white pin for user routes; apply `navbar-dark`/light per theme; keep admin gradient. |
| R12-5 | `/user/mysettings` left nav hangs out of the displayable region, incomplete | Layout overflow: nav column not height-constrained → flex min-height fix + full list visible. |
| R12-6 | `/user/mysettings` style should mirror `/admin/site` | Apply the same `ce-admin-card` white-card shell + section cards around the upstream user-settings panes. |
| R12-7 | `/templates/manage` → Edit fails: `GET /template/:id/edit` 404 | The 404 route does not exist; upstream edit UI is `GET /template/:id` (manage view with in-place edit for gallery admins). → point the bundle-table Edit link at `/template/:id` (same as EditTemplateButton). |
| R12-8 | `/admin/panel` left nav overflows the displayable region | Same flex overflow fix as R12-5. |
| R12-9 | `/admin/panel`: Open Sockets, Privileges Matrix, TPDS/Dropbox Management, Debug Projects are "empty husks" — remove | Remove those four from `admin-panel.pug` (nav column + tab panes), keeping System Messages / Active Projects / Open/Close Editor. |
| R12-10 | `/library` list scrollbar always visible — hide until needed | `.bibtex-entry-list-body` → `overflow-y:auto` + styled thin/hidden scrollbar (show on hover/overflow). |
| R12-11 | Project-page bibliography resizer updates laggy vs library | R11-8 left the *project* sidebar resizer on the slow path; port the library's instant pointer-based width updates (direct DOM width writes during drag, single commit on release). |
| R12-12 | Template-gallery admins: testjoe (site admin **and** flagged) shows "Revoke" while other site admins show "managed via site-admin role" — inconsistent | `revertible = hasTemplateFlag && !isAdmin`. |
| R12-13 | `/templates/manage` content unstyled vs `/admin/site` | Wrap in `ce-admin-card` cards; table + buttons styled to match (reuse admin tab patterns). |
| R12-14 | Sandboxed compiles "+ Add image" button invisible (btn-outline-secondary on white) | Use a visibly contrasted variant (btn-primary family / explicit border + text color). |

## Phase 2 — verification (after build & deploy)

1. All 13 admin tabs: values present, **Save → 200** (no 422), round-trip stable.
2. SSO E2E: SAML ✅ / OIDC ✅ live logins verified (land on `/project`).
   **OPEN (P1, not in the user's 14 items): LDAP live-login regression.**
   Stored config verified correct in `sharelatex.site_settings` (url,
   searchBase, bindDN, encrypted bindCredentials, searchFilter, searchScope).
   Library path works: in-container `LdapAuth.authenticate` returns carol's
   dn+mail; raw ldapjs admin-bind→mail-search→user-bind all succeed from the
   web container (openldap ACL allows cn=admin read, user bind err=0).
   But the live strategy path finds carol (server log `nentries=1`), then drops
   the connection before the user-bind → falls back to local auth → "invalid
   credentials". SAML/OIDC unaffected. Next step: diff the exact `server`
   option object the live `refreshSsoStrategy` builds vs the working
   in-container one (suspects: timeout/connectTimeout left undefined, or a
   doubled strategy registration shadowing the good one per worker), with the
   ldap server log as the oracle.
3. R12-1…R12-14 each verified on the listed URLs, dark **and** light theme
   (navbar pill style + theme reactivity on all listed user pages; admin
   gradient retained; both shells no-overflow; resizer timing; library
   scrollbar; gallery admins table; /templates/manage styling; Edit 200).
4. R11 regression re-check: navbars (user pages theme-reactive, admin
   gradient), Account item placement, card text contrast, bundle
   edit/delete/download, split 9/9, theme toggle from account menu persists.
5. Console-error sweep on all admin/user pages (both themes).
6. Unit tests: site-settings (incl. new snapshot-merge regression test),
   bundle import return, module-boot-contract, page-shells, email-test.
7. Lint all touched files (`--max-warnings 0`).

## Phase 3 — ship

`make all` (0 webpack errors) → deploy → IMAGE_MATCH → verification above →
`BUGHUNT_ROUND2_REPORT.md` (incl. P0 recovery + all R12 items) → commit +
push to `bib-editor`.

**Definition of done:** settings restored and durable (snapshot backups
active), all 14 items fixed & verified, R11 regressions green, report
pushed, site up.
