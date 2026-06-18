<p align="center">
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/overview.png" alt="9Router Gateway overview dashboard screenshot" />
</p>

<h1 align="center">9Router Gateway</h1>

9Router Gateway sits between an AI client and [9Router](https://github.com/decolua/9router). It accepts OpenAI-compatible and Anthropic requests, chooses a 9Router model or combo for virtual models such as `auto`, then forwards the request upstream.

```text
AI client -> 9Router Gateway :20129 -> 9Router :20128 -> provider
```

<p align="center">
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/routing.png" alt="9Router Gateway routing dashboard screenshot" width="30%" />
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/decisions.png" alt="9Router Gateway decisions dashboard screenshot" width="30%" />
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/system.png" alt="9Router Gateway system dashboard screenshot" width="30%" />
</p>

9Router still owns provider credentials, account rotation, quota handling, format translation, and provider fallback. The gateway handles request classification, routing policy, conversation affinity, history, and operator controls.

## Features

- **OpenAI-compatible gateway** for Chat Completions, Responses, and Anthropic Messages-style requests
- **Virtual smart models** with `auto`, `auto-fast`, and `auto-quality` routing profiles
- **Prompt-aware routing** using deterministic signals, optional semantic classification, and image detection
- **Conversation affinity** to prevent later turns from being downgraded after stronger routing decisions
- **Operator dashboard** for analytics, routing controls, decision history, playground testing, and system settings
- **API-key enforcement** with named keys, expirations, enable/disable controls, and hashed verification
- **Runtime configuration** with SQLite-backed dashboard overrides and no restart for routing changes
- **Release-friendly operations** with health checks, Prometheus metrics, Docker support, and SQLite-backed history

## Quick start

Requirements:

- Node.js 22 or newer
- A running 9Router instance
- The five default 9Router models or combos: `smart-small`, `smart-medium`, `smart-planning`, `smart-large`, and `smart-vision`

Install globally and start the gateway:

```bash
npm install -g @bahirul/9router-gateway
9router-gateway
```

If you want to customize defaults, place a `config.yaml` and optional `.env` in the directory where you run the command.

Open `http://127.0.0.1:20129/dashboard`. The initial admin password is `smart9router`. Change it from the System page or from the command line:

```bash
npm run admin:set-password -- 'a-new-password'
```

The password is stored in `data/router.sqlite` and survives restarts.
The built-in dashboard is always enabled and is not configurable.

Point clients to:

```text
OpenAI-compatible base URL: http://127.0.0.1:20129/v1
Anthropic Messages endpoint: http://127.0.0.1:20129/v1/messages
```

Select `auto`, `auto-fast`, or `auto-quality` as the model. Requests using an explicit 9Router model or combo pass through unchanged.

## How routing works

The default mapping is:

| Work | Default target |
| --- | --- |
| Short transformations and simple requests | `smart-small` |
| Coding, debugging, review, and research | `smart-medium` |
| Architecture and planning | `smart-planning` |
| Security, risky migrations, and complex production work | `smart-large` |
| Requests containing images | `smart-vision` |

Routing starts with deterministic request signals, including English and Indonesian intent and risk terms. The task classes behind those signals are stored in SQLite and can be edited from the dashboard, which is more convenient for Docker and cloud deployments than changing YAML files. Ambiguous requests can use the pinned DeBERTa zero-shot classifier configured in `config.yaml`. A timeout, classifier error, or low-confidence result falls back to deterministic routing.

Conversation affinity prevents a session from being downgraded after it has used a stronger target. Send `x-smart-router-session-id` when the client has a stable conversation identifier. The gateway also recognizes common session fields in request bodies and can derive a privacy-safe fallback fingerprint.

Shadow mode records the target the router would have selected while sending virtual-model requests to `routing.shadowTarget`. Use it to evaluate routing policy before enabling active dispatch.

When strict model validation is enabled, automatic routing fails closed if the configured target does not exist in the current 9Router `/v1/models` catalog. Set `upstream.strictModelValidation: false` only when that behavior is not wanted, such as local development.

## Configuration

The main configuration file is `config.yaml`. Start from `config.example.yaml`.

Configuration is applied in this order:

```text
defaults < config.yaml < SQLite dashboard overrides < bootstrap environment variables
```

Dashboard changes are stored in `data/router.sqlite` and apply to new requests without a restart. Legacy `data/runtime-config.json` overrides are imported into SQLite once on startup.

Task classification classes are initialized from built-in defaults, stored in SQLite, and edited from the dashboard Routing page. Each class can define deterministic regex patterns, an optional semantic classifier label, routing score impact, priority, and hard floor. Use `task: false` for signal-only classes that should influence score or floors without becoming the reported `x-smart-router-task`. Existing deployments that still have `routing.taskClasses` in `config.yaml` import those classes into SQLite once; new YAML task-class edits are ignored after SQLite has task classes.

Common environment variables are listed in `.env.example`:

- `NINEROUTER_BASE_URL` points to the upstream 9Router server.
- `NINEROUTER_API_KEY` is used for background model-catalog requests when 9Router requires authentication.
- `SMART_ROUTER_CONFIG` selects the configuration file.
- `SMART_ROUTER_DATA_DIR` selects the persistent data directory.
- `SMART_ROUTER_MODEL_CACHE` selects the classifier model cache directory.
- `SMART_ROUTER_MAX_BODY_BYTES` controls the largest accepted request body.
- `SMART_ROUTER_HOST` and `SMART_ROUTER_PORT` control the listener.

Dashboard-editable settings such as classifier enablement, classifier confidence, request timeout, strict model validation, shadow mode, raw prompt logging, and API-key enforcement are stored in SQLite rather than environment variables. Only the variables listed in `.env.example` are read.

`npm start`, `npm run dev`, and utility scripts load `.env` when it exists. Values already exported by the shell take precedence.

## Client API keys

API-key enforcement is optional. Enable **Require API key** on the API Keys page.

The dashboard can create multiple named keys with an expiration of one day, seven days, 30 days, 90 days, or never. Each key can be enabled, disabled, shown, copied, quota-limited, or permanently deleted. Optional request quotas can be unlimited, daily, or monthly; exhausted keys are rejected until the next UTC calendar period.

Send a key with either header:

```http
Authorization: Bearer sk-...
```

```http
x-api-key: sk-...
```

When enforcement is enabled, requests under `/v1/` are rejected without a valid active key, except the operator routes under `/v1/router/`. Keys that exceed their daily or monthly request quota receive HTTP `429`. A key can also be limited to one dispatch model, useful for sharing constrained access while still logging virtual-model routing as shadow telemetry.

Keys are hashed for request verification. Newly created keys are also stored in SQLite so the authenticated dashboard can show and copy them after a restart. Keys created by older versions may remain valid but display as unavailable because their original value cannot be recovered from the hash.

## Dashboard

The dashboard includes:

- Request volume, target distribution, latency, token use, and subsystem health
- Routing targets, thresholds, profile bias, shadow mode, classifier, affinity, logging, and retention controls
- Searchable decision history with request context, outcomes, signals, and operator feedback
- A dry-run playground for OpenAI Chat, OpenAI Responses, and Anthropic Messages requests
- Named API-key management, quotas, per-key model limits, and global API-key enforcement
- Model-catalog refresh, effective configuration sources, password management, decision reset, and runtime override reset

Dashboard login creates an in-memory `HttpOnly`, `SameSite=Strict` session. Mutations require a CSRF token, and failed login attempts are rate-limited by client address.

## HTTP endpoints

The gateway proxies `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/models`, and other 9Router routes. The model list adds:

- `auto`
- `auto-fast`
- `auto-quality`

Routed responses include:

- `x-smart-router-request-id`
- `x-smart-router-target`
- `x-smart-router-dispatch-target`
- `x-smart-router-task`
- `x-smart-router-complexity`
- `x-smart-router-confidence`
- `x-smart-router-mode`

Operator endpoints:

- `POST /v1/router/explain` previews a decision without dispatching or changing affinity.
- `POST /v1/router/feedback` stores a rating from 1 to 5 with optional expected target and note.
- `GET /metrics` returns Prometheus metrics.
- `GET /healthz` reports process health.
- `GET /readyz` reports model-catalog readiness.

The router operator endpoints and metrics accept the admin password as a bearer token:

```bash
curl http://127.0.0.1:20129/v1/router/explain \
  -H "Authorization: Bearer smart9router" \
  -H "Content-Type: application/json" \
  -d '{"request":{"model":"auto","messages":[{"role":"user","content":"Plan an API migration"}]}}'
```

The `/api/admin/*` endpoints are intended for the dashboard and use its session cookie and CSRF token.

## Data and operations

Persistent state lives under `data/` by default:

- `router.sqlite` stores the admin password, API keys, decisions, outcomes, feedback, and dashboard configuration overrides.
- `decisions.jsonl` and `feedback.jsonl` remain available for evaluation tooling.
- `models/` stores the classifier cache.

SQLite uses WAL mode. History retention is configurable. Raw prompt storage is disabled by default.

Run the offline routing evaluation with:

```bash
npm run evaluate
```

Refresh and validate the upstream model catalog with:

```bash
npm run smoke:upstream
```

## Docker

Create `config.yaml`, then start both services:

```bash
cp config.example.yaml config.yaml
docker compose -f docker-compose.example.yml up --build
```

The example Compose file runs this service as `gateway` and 9Router as `9router`. Keep the `gateway-data` volume if passwords, API keys, history, and classifier files must survive container replacement.

Build the image directly with:

```bash
docker build -t 9router-gateway .
```

The image builds the dashboard in a separate stage and ships only the production server and compiled UI.
It uses a glibc-based Node runtime so the semantic classifier's `onnxruntime-node` native library can load in Docker. Disable semantic classification from the dashboard if you want Docker deployments to use deterministic routing only.

## Development

```bash
npm run dev
npm run dev:ui
npm test
npm run check
```

The test suite covers request normalization, routing policy, affinity, configuration revisions, sessions and CSRF, SQLite persistence, API-key authentication, static UI headers, and end-to-end proxy behavior with a fake 9Router server.

## License

9Router Gateway is released under the [MIT License](LICENSE).
