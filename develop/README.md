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

## Feature configuration (env)

The AI Assistant and grammar-checking features are enabled via environment
variables (see `dev.env`) rather than on first setup. All of these are optional;
with none set, no LLM/AI features are visible.

| Variable | Purpose |
| -------- | ------- |
| `LLM_ENABLED=true` | Load the LLM module (AI chat, completion, LLM grammar checks). |
| `LLM_API_URL` | OpenAI-compatible API base URL, e.g. `http://llm-host/v1`. Default for the model id comes from `LLM_MODEL_NAME` (first entry); fallback `qwen3-32b`. |
| `LLM_API_KEY` | API key for `LLM_API_URL`. |
| `LLM_MODEL_NAME` | Comma-separated list of enabled model ids (offered in the model picker). |
| `LLM_ALLOW_USER_SETTINGS=true` | Let users configure their own LLM key/model in *Settings → LLM* (enabled by default; the env var is OR-ed with `llm.allowUserSettings`). |
| `LANGUAGE_TOOL_URL` | Full LanguageTool server URL (takes precedence over `HOST`+`PORT`). |
| `LANGUAGE_TOOL_HOST` | LanguageTool host fallback (compose pre-sets `languagetool`, the service name in `docker-compose.yml`). |
| `LANGUAGE_TOOL_PORT` | LanguageTool port fallback (compose pre-sets `8010`). |

Uncomment `LLM_ENABLED`/`LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL_NAME` in `dev.env` to
enable the LLM feature; the compose `languagetool` service and
`LANGUAGE_TOOL_HOST=languagetool` / `LANGUAGE_TOOL_PORT=8010` (pre-set in
`docker-compose.yml`) make the LanguageTool side available out of the box, so no
extra env is required for it. When the feature is enabled, the
**LLM Settings** page under the admin navbar holds connection details and
force-off switches (`llmDisabledByAdmin`, `languageToolDisabledByAdmin`) that apply
without a server restart; user grammar preferences live under *Settings → LLM.*
Full behavior (mode matrix, effective-mode computation, per-user vs. admin
settings) is documented in [`../docs/llm-languagetool-integration-plan.md`](../docs/llm-languagetool-integration-plan.md).

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
| `contacts`         | 9232 |
| `docstore`         | 9233 |
| `document-updater` | 9234 |
| `filestore`        | 9235 |
| `notifications`    | 9236 |
| `real-time`        | 9237 |
| `references`       | 9238 |
| `history-v1`       | 9239 |
| `project-history`  | 9240 |
| `linked-url-proxy` | 9241 |

To attach to a service using Chrome's _remote debugging_, go to
<chrome://inspect/> and make sure _Discover network targets_ is checked. Next
click _Configure..._ and add an entry `localhost:[service port]` for each of the
services you want to attach a debugger to.

After adding an entry, the service will show up as a _Remote Target_ that you
can inspect and debug.
