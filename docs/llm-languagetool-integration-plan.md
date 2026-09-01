# LLM + LanguageTool grammar/spell checking — integration plan

> **Provenance (2026-09-01 grammar port):** this document is the original
> design/plan for the LanguageTool + LLM grammar feature, ported verbatim from
> the `llm` branch of the old tree (commits `1df1fc44`, `bc85bd280c`,
> `fbcc9f4398`). It is kept as the design rationale. Where the **current**
> implementation has evolved beyond this plan, the code is authoritative:
>
> - The current `llm` module is richer (BYO provider rows, per-user budget +
>   rate gate, compliance review, usage metering); the grammar lane flows
>   through `resolveLane`/`chatText` + `guardLLMCall`.
> - **Picky level**: ON by default per project (`project.grammarPicky`); the
>   extension sends an explicit `picky` on every `/languagetool/check`;
>   `LANGUAGE_TOOL_LEVEL` sets the fallback (see
>   `modules/languagetool/app/src/LanguageToolController.mjs#checkLevel`).
> - **Blocked rules**: per-user free-text list (`user.grammar.blockedRules`),
>   filtered client-side in the editor (this LT build has no `/v2/rules`
>   endpoint — verified 404 — so no rule catalog is kept).
> - `LANGUAGE_TOOL_ENABLED` (mentioned below) was dropped: the module is
>   always registered and degrades to 503 when unconfigured.
> - The admin page gained the **Services (availability)** section
>   (`llmDisabledByAdmin`, `languageToolUrl`, `languageToolDisabledByAdmin`).
>
> ---


Status: draft for review — no code changes in this document.

## 1. Context and inventory (verified)

### Repos/branches involved
- **overleaf-cep, branch `llm` (current, f908a969)**:
  - Active LLM module `services/web/modules/llm` (backend controllers + routers,
    user settings page, admin settings page, chat pane, inline completion).
  - LLM is wired through module-import slots in
    `services/web/config/settings.defaults.js`
    (`sourceEditorExtensions` L1002, `sourceEditorComponents` L1008,
    `pdfLogEntryHeaderActionComponents` L1017, `settingsRailPanes` L1114,
    activeModules L1133).
  - Default spellcheck = Hunspell (client-only):
    `services/web/frontend/js/features/source-editor/extensions/spelling/` +
    `hunspell/`. Language chosen per project via `spellCheckLanguage` settings
    (`.../settings-modal-context.tsx` L132–137, SpellCheckSetting).
  - User model `User.mjs` already has LLM fields L235–238
    (`useOwnLLMSettings`, `llmApiKey`, `llmModelName`, `llmApiUrl`) —
    LLM settings are **per-user, stored server-side** (not project settings).
  - Exposed settings (`ExpressLocals.mjs` L421, `types/exposed-settings.ts` L54):
    `llmEnabled`, `llmAllowUserSettings`, `llmAvailableForUser` (to be added).
- **overleaf-cep, branch `origin/languagetool` (8337e00e)**: single commit on top
  of older upstream `cf70bc751` — a **full implementation of an independent
  LanguageTool feature** we can port:
  - `LanguageToolController.mjs` (proxies `GET /v2/languages` and
    `POST /v2/check` to the LT server, 100 KB cap, LaTeX false-positive rules
    disabled).
  - `LanguageToolRouter.mjs` (`/languagetool/languages`, `/languagetool/check`).
  - `languagetool-extension.ts` (CM6 extension: own StateField + decorations +
    hover tooltip — deliberately avoids global `lintConfig` conflicts; LaTeX
    span extraction; 2 s debounce; aborts stale requests).
  - `latex-to-annotations.ts` (LaTeX → LT annotation array preserving offsets,
    so LT offsets map 1:1 to CodeMirror positions).
  - `languagetool-language-setting.tsx` / `-section.tsx` +
    `settings.defaults.js` hooks (`sourceEditorComponents`,
    `settingsModalSpellcheckSections`).
  - Docker: `languagetool` compose service (image `erikvl87/languagetool:latest`,
    port 8010, healthcheck) in `develop/docker-compose.yml`;
    module enabled via `LANGUAGE_TOOL_ENABLED` env and
    `LANGUAGE_TOOL_URL/HOST/PORT`.
- **grammared-language** (reference only): shows how to extend the *open source
  LT* with AI/ML grammar models **server-side** using LT's gRPC
  remote-rules protocol:
  - `example_language_tool_configs/remote-rule-config.json`
    (`langtool_remoteRulesFile` env on the LT server, rule `ML_GRAMMAR_CHECKER`,
    `type: grpc`, url/port, timeouts, batchSize).
  - `grammared_language/language_tool/ml_server.proto` (LT `ml_server` gRPC
    protocol: `MatchRequest`/`MatchResponse`, `Analyze*`, `Process*`, `Match`
    message with offset/length/suggestions).
  - `api/src/grpc_server.py` — gRPC server implementing that protocol, fed by
    open-source GECToR / CoEdIT models served via Triton; LLM output is
    normalized into LT `Match` objects (offset/length/replacements) so LT
    clients see them as ordinary grammar warnings.
  - Important implication: **in this design, "LLM" from the LT point of view is
    just another remote rule; LT still orchestrates language selection,
    sentence splitting, and match merging.**

### Porting reality check
The LLM branch and the languagetool branch diverged at `c9c129af` (older
upstream). The `llm` branch has since absorbed upstream changes (including
`services/web/frontend/...` reorganizations). The languagetool commit touches
files that exist on `llm` with compatible content, plus one upstream rename
(`ExpressLocals` path, `settings.defaults.js` slots). The diff is 1114 LOC
across 10 files — small enough to port **manually** (no merge needed),
file-by-file, while adapting the extension to the new option model
(see §2).

## 2. Design principles (from requirements + cost analysis)

### Cost model (confirmed: lowest → highest)
1. **Hunspell** (default Overleaf spellcheck) — client-side WASM, zero
   infrastructure cost, very fast.
2. **LanguageTool** — dedicated server, one HTTP call per check, cheap.
3. **LLM** — per-call API cost + latency, most expensive.

Consequences:
- The default mode must never be more expensive than Hunspell.
- A mode that includes LLM should only call the LLM when the user is
  actually typing in that mode, with aggressive debouncing (2 s, like the LT
  extension) and only on **changed regions** where possible.
- LLM mode must be **opt-in per user** and clearly labelled as "AI, costs"
  to avoid surprise API usage from an unknown user or a collaborator with a
  personal key.

### Settings placement (multi-user / cost isolation)
The grammar-checking mode is a **per-user setting**, stored **server-side on
the User document** (not project settings, not localStorage), so:
- Each collaborator in the same project gets their own mode.
- Users with only a personal LLM key see only LLM modes they can use.
- A user on "default" mode costs nothing beyond Hunspell, regardless of the
  project.

Why not project settings (as the current `languagetool` branch uses
`localStorage` + per-project `lt-enabled`)? Because cost + LLM availability
are user-level facts. Server-side User storage is already the established
pattern (LLM fields at `User.mjs` L235–238).

### Effective mode = (user setting) ∩ (admin toggles) ∩ (availability)
- `llmAvailableForUser = llmAdminOn && (serverLLMConfigured || userHasOwnLLM)`
- `ltAvailable = ltAdminOn && ltServerURLConfigured`
- If the user's chosen mode is not feasible, it **degrades gracefully** to the
  closest feasible mode and the editor shows an info line ("LLM not available,
  using LanguageTool + Overleaf spellcheck").

## 3. Target state

### Admin settings (admin page)
Extend the existing LLM admin settings page (or add a "Services" tab on the
admin tools page) with the toggles + connection check:

| Admin setting | Meaning |
|---|---|
| `LLM enabled` (global) | Force-off LLM for everyone even when a key is present (already partially exists as `enabled`) |
| `LanguageTool enabled` (global) | Force-off LT for everyone (new) |
| `LanguageTool server URL` | Connection to the LT server (new) |
| `Check (LT)` button | Calls `GET {url}/v2/languages` server-side; shows ok/error + latency (mirrors LLM's existing connection-check pattern) |
| (optional) `LLM allowed for grammar` | Allow LLM to be used as grammar engine (separate from "allow LLM chat") — reuse `llm.enabled` instead if scope should stay small |

### User settings (per user, server-side)
New "Grammar & Spelling" section in the existing user settings page (where
`llm-settings` component already lives,
`services/web/modules/llm/frontend/js/components/llm-settings-page.tsx`),
rendered inside the settings modal's "Editor" tab next to SpellCheck:

- **Mode radio group** (options shown dynamically based on availability):
  - **Default Overleaf spell check** (Hunspell only) — always available
  - **LanguageTool + Overleaf spell check** — when LT on
  - **LLM + Overleaf spell check** — when LLM on
  - **LanguageTool + LLM + Overleaf spell check** — when both on
- **Model** selector — shown for LLM modes; reuses existing LLM model list
  logic (`LLMChatController.getModels` / `LlmSelect`), per-user, includes
  personal key model.
- **Language for grammar check** (LT language dropdown) — keep existing
  `languagetool-language-setting.tsx` dropdown ("Auto-detect" + LT language
  list); store per-user (moved from project localStorage); Hunspell
  dictionary stays as a separate project-level concern (no change).
- **Hunspell is "combined"** with everything: in modes 2a/3a/4c the LT/LLM
  matches are merged on top of Hunspell underlines (no duplication: drop
  `TYPOS` from LT when Hunspell is active, and the LLM prompt excludes words
  Hunspell already flagged — see §5).

### Mode matrix (as required)
1. LLM off, LT off → single option: **default** (Hunspell).
2. LLM on, LT off → **default** | **LLM + spell**.
3. LLM off, LT on → **default** | **LT + spell**.
4. LLM on, LT on → **default** | **LT + spell** | **LLM + spell** |
   **LT + LLM + spell**.

(4b in your spec duplicates 4a; both are handled by "LT + spell", so we show
one option — 4c is the extra "combined" option, 4d is "default".)

### Availability edge cases (explicit requirement)
- "LLM not available ⇒ LLM option is always off": enforced by
  `llmAvailableForUser` in both the admin gate and the per-user key check; the
  radio option is **not rendered** (not just disabled) when unavailable, and a
  saved LLM mode degrades with a toast/info line.
- "Admin can disable it even when available": the admin global toggle applies
  on top — even a fully configured user with a personal key sees LLM off when
  the admin toggle is off (same for LT).

## 4. Backend changes

### 4.1 Port LanguageTool module (adapted)
New module `services/web/modules/languagetool` (name kept), ported from
`origin/languagetool` commit 8337e00e:
- `index.mjs` — keep the env-gated activation pattern
  (`LANGUAGE_TOOL_ENABLED`) but move "enabled" into admin settings so admins
  can toggle without env: module stays exported, availability flag is computed
  at request time (see ExpressLocals).
- `LanguageToolController.mjs` — keep the proxy, **add**:
  - admin-only `POST /admin/languagetool/check` endpoint that does the
    connectivity probe with the admin-entered URL (before saving).
  - admin `GET/PUT /admin/languagetool` (server URL + enabled flag) stored via
    a small JSON admin-settings file (same pattern as LLM admin settings
    `ADMIN_SETTINGS_PATH`), or env + a "configured" flag if a file is too
    heavy for this iteration.
- `LanguageToolRouter.mjs` — keep `/languagetool/languages`,
  `/languagetool/check`; add admin routes.
- Settings exposure in `ExpressLocals.mjs`:
  `languageToolAvailable: !!Settings.languageToolURL` (from the port) plus
  `languageToolAdminEnabled` and the computed
  `llmAvailableForUser` / `ltAvailable` (single source of truth for the
  frontend).
- Settings defaults: `settingsModalSpellcheckSections` gets
  `languagetool-section` (port); add `settingsModalGrammarSections` only if we
  want a distinct "Grammar" tab — see §6.

### 4.2 User preferences (new, server-side)
Extend `User` (alongside L235–238):
- `grammarMode: 'default' | 'lt' | 'llm' | 'lt+llm'` (default `'default'`)
- `grammarLanguage: string` (LT language, `'auto'` default)
- `grammarLLMModel: string` (model id when `grammarMode` includes LLM)
Extend the existing `/user/llm-settings` GET/POST (or add a sibling endpoint
`/user/grammar-settings`) to read/write these; validation on the server side
against availability (save + degrade). The LLM admin gate continues to come
from `Settings.llm.enabled` + `llmAdminEnabled` (new `llmAdminEnabled` flag in
the LLM admin settings file so the admin can force-off chat **and** grammar
with one toggle, or split it into two checkboxes — **open question**, see
§9).

### 4.3 LLM grammar-check endpoint (new API in LLM module)
`POST /project/:Project_id/llm/grammar` (project-scoped for audit/project
rate limits, consistent with the chat endpoint):
- Input: `{ textSpans: [{spanId, text}], language, model }` — *only* the LT
  annotation `text` spans (prose), never markup, so we never pay for LaTeX
  commands/math.
- Output (LLM-agnostic, normalized):
  ```js
  { spans: [{ spanId, message, suggestion, start, end }] }
  ```
  where `start`/`end` are offsets **within the given span**.
- Implementation: single OpenAI-compatible `chat/completions` call (reusing
  `LLMChatController`'s request plumbing/admin system prompt; new system
  prompt: "Fix grammar only; return JSON array of {original, corrected,
  spanId, message}; never change meaning/format/commands.").
- Guardrails:
  - Hard cap on input chars (e.g. 15 KB) and span count (e.g. 50 spans) per
    request, truncation + warn in logs.
  - **Only check edited regions** when feasible: the frontend sends spans
    touched by the latest user edit (2 s debounce).
  - Temperature 0.1, `max_tokens` bounded (e.g. 1024), 30 s timeout,
    AbortController (mirror the `completion` controller).
  - Strict JSON parse (fallback: treat parse failure as "no suggestions",
    log).
  - Respect `Settings.llm.enabled` and the admin force-off; personal-key LLM
    works the same way (reuses `personal-` prefix handling from `chat`).
- The "combined" mode (4c) is **not** a backend merge: frontend runs LT and LLM
  in parallel, merges locally (cheaper, two independent engines, no new
  coordination service).

## 5. Frontend changes

### 5.1 New module import + combined extension (CM6)
Keep the `languagetool-extension` structure (own StateField + decorations +
hover tooltip, 2 s debounce, AbortController, LaTeX-annotation builder) and
extend it into a single "grammar" extension — or, to keep the port clean,
add a **second** extension `llm-grammar-extension` (LLM module) that
coexists with the LT extension:
- Reads the per-user `grammarMode` (new `getMeta('ol-ExposedSettings')` field
  or from `/user/grammar-settings` on mount) + availability flags.
- LT branch: unchanged (calls `/languagetool/check` with annotation data).
- LLM branch (new, `llm-grammar-extension.ts`):
  - Collects the same `text` spans from `buildAnnotationsFromTree`
    (re-export/`latex-to-annotations.ts` from the LT module).
  - POSTs `{ textSpans }` to `/project/:Project_id/llm/grammar`.
  - Maps `{spanId, start, end}` back to doc positions
    (offset = span.start + offsetInSpan; spans are disjoint, so this is
    trivial and robust to LT's offset-mapping invariant).
  - Emits its own `StateField` of LLMDiagnostics (same severity mapping:
    'error' for corrections with a suggestion, 'warning' for style-only
    messages) and its own hover tooltip + replace button (reuses the LT
    tooltip component pattern).

**Merge/dedup rules (in 4c):**
- Hunspell: always on; no change.
- LT: filter `TYPOS` category when Hunspell language is set (existing rule in
  the ported extension — keep it).
- LLM: drop any LLM suggestion whose [start,end] overlaps an existing LT
  match by ≥ 60% (LT wins; LLM suggestions can be *more* contextual, but the
  deterministic tool wins to keep the cheap layer authoritative).
- Both engines' underlines are visually distinguished (LT = orange wavy,
  LLM = blue wavy, matching their "cost tier"), so users always know what they
  are paying for; each tooltip shows source: "LanguageTool" vs "LLM (model)".

### 5.2 Settings UI (per-user)
- `languagetool-language-setting.tsx` (ported): language dropdown + "LT
  combined with Hunspell" checkbox → **replaced** by the new Mode radio, and
  its per-project `localStorage` persistence is **removed** (replaced by
  User doc, see §4.2).
- New `grammar-settings-section.tsx` (inside the `llm` module for model
  choice, or a new `grammar` shell that imports both modules):
  - Mode radio (dynamic options per §3).
  - Model selection for LLM modes (`LlmSelect` from existing components).
  - Language dropdown for LT modes.
  - Live availability: if `llmAvailableForUser` flips to false (e.g. session
    key revoked), the radio collapses to feasible options with a notice.
- Settings modal wiring: `settings.defaults.js`
  `settingsModalSpellcheckSections` (or a dedicated `settingsModalGrammarSections`
  slot — **decision**, see §9).

### 5.3 Admin UI
- Extend `llm-admin-settings-page.tsx` (or a new admin page
  `service-admin-settings.tsx` in a `services` shell module) with:
  - LLM: global enabled toggle (force-off even if configured) — existing
    `enabled` flag; add explicit "Force off for all users" checkbox.
  - LanguageTool: enabled toggle + server URL input + **"Check" button**
    (calls the admin probe endpoint; shows spinner, green "LanguageTool
    reachable (X languages, 121 ms)" or red error with status/latency).
  - Both persisted via the existing admin-settings JSON file pattern.

## 6. Exposed settings (single source of truth, frontend)
In `ExpressLocals.mjs` under `ol-ExposedSettings` (already has
`llmEnabled`, `llmAllowUserSettings`, and (post-port)
`languageToolAvailable`):
```js
llmAvailableForUser: bool,   // adminOn && (server || personal key)
ltAvailable: bool,           // adminOn && url configured
userGrammarMode: string,     // current user's effective (degraded) mode
userGrammarModel: string,    // model for LLM modes
userGrammarLanguage: string, // for LT modes
```
Type definitions in `types/exposed-settings.ts`; frontend never recomputes
availability from raw flags (avoids drift between admin toggles and key
presence).

## 7. Deployment (dev environment)
- Port the `languagetool` service block from `origin/languagetool` into
  `develop/docker-compose.yml` (image, ngrams volume, healthcheck).
- Env: `LANGUAGE_TOOL_HOST=languagetool`, `LANGUAGE_TOOL_PORT=8010`
  (per the port notes: env rename from `LANGUAGETOOL_*`).
- Optional Phase 2: add an
  `erikvl87/languagetool` config with `langtool_remoteRulesFile` pointing at a
  grammared-language-style gRPC service (separate compose service) if we want
  the open-source AI rule — this is the grammared-language part of the story
  (§10).
- No changes to `docker-compose.yml` (production image) are required for the
  user/feature side; the LT server is a **separate** compose service (or an
  external URL filled in by the admin).

## 8. Testing (existing patterns, see `llm` branch `llm-chat.test.ts`)
- Backend:
  - LanguageTool proxy admin probe (200 ok / 502 unreachable / timeout).
  - User grammar-settings save: degrades mode when admin forces LLM off.
  - `POST /project/:id/llm/grammar`: mock OpenAI response → span id mapping,
    JSON parse fallback, size cap, admin force-off → 503.
- Frontend (vitest/jest):
  - Mode radio: option visibility per availability flags, degrade toast.
  - LLM extension: span extraction, offset mapping (spans disjoint),
    dedup rule (≥60% overlap → LLM dropped), AbortController on mode switch.
  - Settings component: model list loads for LLM modes only.
- Manual E2E (docker-compose dev): all 4 availability combinations × mode
  matrix; verify Hunspell underlines persist in every mode.

## 9. Open questions / decisions
1. **One admin toggle "LLM" or two (chat vs grammar)?** — v1: single
   `llm.enabled` toggle + a separate "LLM grammar check" toggle that implies
   "chat enabled"? (Recommended: single LLM toggle reused + separate "allow
   grammar checking via LLM" checkbox to avoid double configuration.)
2. **Settings modal slot**: reuse `settingsModalSpellcheckSections` (port
   `languagetool`'s slot) vs. new `settingsModalGrammarSections`. Recommendation:
   new slot, so Grammar UI sits above Spellcheck without forcing the
   "spelling" naming.
3. **Where the per-user mode lives**: User doc fields (recommended, matches
   LLM fields) vs. per-project localStorage (what the ported branch did).
   Recommend: User doc; drop the localStorage keys during port.
4. **Combined mode (4c) merge strategy**: parallel frontend calls + local
   merge (recommended, no backend coordination) vs. LT server-side gRPC
   bridge (grammared-language style; better single source but requires
   running the ML gRPC service and is the "OSS LT is limited" path the user
   explicitly wants to *supplement*, not replace).
5. **Rate limiting** on `/project/:id/llm/grammar` (personal-key users): rely
   on existing per-project auth? (yes, keep project-scoped like chat).
6. **Model choice UI**: reuse the chat-pane model selector vs. a dedicated
   dropdown in the grammar settings section (recommended: dedicated, since
   the chat pane is not present in every project layout).

## 10. Phase 2 (optional, grammared-language integration)
If we want the *open source* grammar engine (no LLM cost) to be smarter:
- Stand up a grammared-language gRPC service (Triton + CoEdIT/GECToR
  models, or a single-model Python gRPC server) as an external compose
  service alongside `languagetool`.
- Point its `server.properties` `langtool_remoteRulesFile` at a
  `remote-rule-config.json` (as in
  `grammared-language/example_language_tool_configs/remote-rule-config.json`).
- Result: LT mode alone (3a/4a) gains ML strength; the "LLM" mode in this
  project remains the *our-branch* LLM (custom models, personal keys,
  admin-gated).
- No frontend changes needed for Phase 2 (LT protocol is unchanged; matches
  arrive as ordinary grammar warnings from `/languagetool/check`).

## 11. Rollout (suggested commit order)
1. **Port** the languagetool module + compose service (feature-complete as a
   port, with the env-gated `LANGUAGE_TOOL_ENABLED` still working) + basic
   "LT + Hunspell" mode + admin toggle + check-button for later commits.
2. Admin "Force off" toggles (LLM, LT) + `llmAvailableForUser`/`ltAvailable`
   exposed settings + degradation UX.
3. User grammar mode (default/lt/llm/lt+llm) persisted in User + settings UI
   (mode radio) + model choice.
4. LLM grammar endpoint + `llm-grammar-extension` + 4c combined mode +
   dedup rules.
5. (Optional) Phase 2 gRPC remote-rule bridge.

## 12. Risks / mitigations
- **Port drift**: `languagetool` extension uses Lezer node names and the
  `noSpellCheckProp` definitions from core. Mitigate: unit test the
  annotation builder against a small LaTe suite (fixtures already exist in
  the repo for the lezer grammar).
- **Cost shock**: LLM mode with a personal key + auto-compile loop = spam
  prevention: 2 s debounce, edited-region only, hard caps, user confirmation
  toast on first activation of LLM mode in a session.
- **False positives on LaTeX**: keep the LT `disabledRules` list (port) + the
  LaTeX annotation builder (existing); verify against `bibtex`-heavy docs.
- **Offset mapping errors in LLM suggestions**: LLM response only references
  spans we sent (not raw text), and we map span-relative offsets, so
  hallucinated global offsets can't shift unrelated text.
- **Duplicate underlines**: fixed merge rules in §5.1; visually separate
  colors make any residual duplication diagnosable.

## 13. Files that actually landed

> The plan above names tentative files (e.g. `llm-grammar-extension.ts`,
> `settingsModalGrammarSections`, User fields `grammarMode`/`grammarLanguage`/
> `grammarLLMModel`). The final implementation differs: a **single** combined
> extension lives in the `languagetool` module, settings live on the LLM
> settings page (no modal slot), and the User model holds one nested `grammar`
> sub-object. See the actual file list below.

Backend:
- `services/web/modules/languagetool/` (new module): `index.mjs` (Settings +
  module registration), `app/src/{LanguageToolController,LanguageToolRouter,
  adminConfig}.mjs`.
- `services/web/modules/llm/app/src/{LLMAdminController,LLMChatController,
  LLMRouter,LLMSettingsController}.mjs` (admin grammar fields, grammar
  endpoint, user grammar GET/POST, admin force-off flags).
- `services/web/app/src/infrastructure/ExpressLocals.mjs` (per-request
  `grammarSettings` locals + exposed settings block).
- `services/web/app/src/models/User.mjs` (nested `User.grammar =
  { mode, llmModel, language }`).
- `services/web/app/views/project/editor/_meta.pug` (`ol-grammarSettings`
  meta tag).
- `services/web/config/settings.defaults.js` (`grammar-extension` in
  `sourceEditorExtensions`, `languagetool` in `moduleImportSequence`).
- `develop/docker-compose.yml` (LT service + env fallbacks).
Frontend:
- `services/web/modules/languagetool/frontend/js/grammar-extension.ts`
  (combined LT+LLM CM6 extension; orange=LT, blue=LLM, ≥60% overlap dedup).
- `services/web/modules/languagetool/frontend/js/grammar-settings-section.tsx`
  (per-user settings, embedded in the LLM settings page).
- `services/web/modules/languagetool/frontend/js/utils/{grammar-helpers,
  latex-to-annotations}.ts`.
- `services/web/modules/llm/frontend/js/components/{
  llm-admin-settings-page,llm-settings-page}.tsx` (admin grammar controls +
  grammar section mounting).
- `services/web/types/exposed-settings.ts` (`llmAdminEnabled`,
  `llmServerConfigured`, `languageToolAvailable`).
- `services/web/frontend/js/utils/meta.ts` (registered meta keys).
Tests:
- `services/web/modules/languagetool/test/unit/grammar-helpers.test.mjs`.
- `services/web/modules/llm/test/unit/src/LLMSettingsController.test.mjs`.
