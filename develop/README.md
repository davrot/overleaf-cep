# Overleaf Community Edition, development environment

## Building and running

In this `develop` directory, build the services:

```shell
bin/build
```

> [!NOTE]
> If Docker is running out of RAM while building the services in parallel, create a `.env` file in this directory containing `COMPOSE_PARALLEL_LIMIT=1`.

Then start the services:

```shell
bin/up
```

Once the services are running, open <http://localhost/launchpad> to create the first admin account.

## Development

To avoid running `bin/build && bin/up` after every code change, you can run Overleaf
Community Edition in _development mode_, where services will automatically update on code changes.

To do this, use the included `bin/dev` script:

```shell
bin/dev
```

This will start all services using `node --watch`, which will automatically monitor the code and restart the services as necessary.

To improve performance, you can start only a subset of the services in development mode by providing a space-separated list to the `bin/dev` script:

```shell
bin/dev [service1] [service2] ... [serviceN]
```

> [!NOTE]
> Starting the `web` service in _development mode_ will only update the `web`
> service when backend code changes. In order to automatically update frontend
> code as well, make sure to start the `webpack` service in _development mode_
> as well.

If no services are named, all services will start in development mode.

## Feature configuration (LLM / grammar checking)

The AI Assistant and grammar-checking features are enabled via environment
variables (see `dev.env`) rather than on first setup. With none set, no
LLM/AI features are visible.

| Variable | Purpose |
| -------- | ------- |
| `LLM_ENABLED=true` | Load the LLM module (AI chat, completion, LLM grammar checks, compliance review). |
| `LLM_API_URL` | OpenAI-compatible API base URL, e.g. `http://llm-host/v1`. |
| `LLM_API_KEY` | API key for `LLM_API_URL` (encrypted at rest via `LLM_KEY_SECRET`). |
| `LLM_MODEL_NAME` / `LLM_AVAILABLE_MODELS` | Model ids offered in the model picker. |
| `LLM_ALLOW_USER_SETTINGS=true` | Per-user BYO provider rows (bring-your-own API key). |
| `LLM_ADMIN_SETTINGS_PATH` | Where the admin settings JSON lives (default `/var/lib/overleaf/data/llm-admin-settings.json`). |
| `LANGUAGE_TOOL_URL` | LanguageTool server URL (wins over HOST/PORT). |
| `LANGUAGE_TOOL_HOST` / `LANGUAGE_TOOL_PORT` | Compose pre-sets `languagetool` / `8010`. |
| `LANGUAGE_TOOL_LEVEL` | Default check level: `picky` (default) or `default`. |

The compose `languagetool` service makes the LanguageTool side available out of
the box (`develop/ngrams` holds the language models). All runtime configuration
happens on the admin page (**Admin > LLM Settings**): connection, model allow-
list, per-feature enablement, the **Services (availability)** force-off section
(`llmDisabledByAdmin`, `languageToolDisabledByAdmin`, `languageToolUrl`, plus a
connection Check button) — changes apply without a server restart.

User-facing behavior:

- *Settings > LLM > Grammar Checking*: per-user mode (default / LanguageTool /
  LLM / combined), model, language, and a **blocked rules** list — type the
  rule ID shown in the editor's underline tooltip (e.g. `PASSIVE_VOICE_SIMPLE`).
- *Grammar Checking > Picky grammar rules* (per project): ON (default) requests
  LanguageTool at `level=picky` (style, wordiness, passive voice, ...); OFF
  falls back to the default grammar level.
- The editor extension filters user-blocked rules client-side before rendering.

Full design notes (mode matrix, availability computation, request flow) are in
[`../docs/llm-languagetool-integration-plan.md`](../docs/llm-languagetool-integration-plan.md).

## Debugging


When run in _development mode_ most services expose a debugging port to which
you can attach a debugger such as
[the inspector in Chrome's Dev Tools](chrome://inspect/) or one integrated into
an IDE. The following table shows the port exposed on the **host machine** for
each service:

| Service            | Port |
| ------------------ | ---- |
| `web`              | 9229 |
| `clsi`             | 9230 |
| `chat`             | 9231 |
| `docstore`         | 9233 |
| `document-updater` | 9234 |
| `filestore`        | 9235 |
| `notifications`    | 9236 |
| `real-time`        | 9237 |
| `history-v1`       | 9239 |
| `project-history`  | 9240 |
| `linked-url-proxy` | 9241 |

To attach to a service using Chrome's _remote debugging_, go to
<chrome://inspect/> and make sure _Discover network targets_ is checked. Next
click _Configure..._ and add an entry `localhost:[service port]` for each of the
services you want to attach a debugger to.

After adding an entry, the service will show up as a _Remote Target_ that you
can inspect and debug.
