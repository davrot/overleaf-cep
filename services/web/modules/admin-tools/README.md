# admin-tools

Upstream Overleaf CE module: the admin pages — user management
(`/admin/user`), project lookup (`/admin/project`, gated by
`Settings.features.admin_project_url_lookup`), and the site-admin entry
page (`/admin`). Rendering lives in the core
`Features/ServerAdmin/AdminController.mjs` + `app/views/admin/index.pug`;
the React front-ends under `frontend/js/*` provide the user/project list
UIs (ds-nav sidebars, tables, row actions).

Local fork notes (`bib-editor` branch) — the module code itself is
upstream; the CE+ integration points are:

- **Theming** — `AdminController.index` passes the logged-in user's
  `ace.overallTheme` to the view; `app/views/admin/index.pug` resolves it
  on `DOMContentLoaded` with a CSP-nonced inline script that reads the
  `ol-adminOverallTheme` meta by prefix selector (`name^="ol-admin"` —
  the Views duplicate-meta guard scans for literal `ol-` names, so inline
  scripts must never repeat a meta name verbatim). Admin pages therefore
  follow the user's Dark / Light setting.
- **Branding** — the user-list and project-list sidebars
  (`*ds-nav.tsx`) render the **CE+** mark in the shared lower section.
- **Account menu** — the admin block in the account dropdown (Manage
  Site / Manage Users / Manage Projects / Switch to Admin / Feature
  Flags / Surveys / Script Logs) comes from the shared
  `frontend/js/shared/components/navbar/account-menu-items.tsx`, gated on
  the `ol-navbar` meta flags (`canDisplayAdminMenu`, ...), so the same
  items appear on `/library`, `/templates`, `/project`.
- **Deep-audit finding (informational)** — the ds-nav stylesheets define
  namespaced `--ds-nav-*` custom properties on `body`; they are only
  consumed by the admin-tools page subtree, left as-is (low risk).
