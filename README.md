<p align="center">
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/overview.png" alt="9Router Gateway overview dashboard screenshot" />
</p>

<h1 align="center">9Router Gateway</h1>

9Router Gateway sits between AI clients and [9Router](https://github.com/decolua/9router). It accepts OpenAI-compatible and Anthropic Messages requests, routes virtual models such as `auto`, and forwards requests to 9Router.

```text
AI client -> 9Router Gateway :20129 -> 9Router :20128 -> provider
```

9Router still owns provider credentials, account rotation, quota handling, format translation, and provider fallback. The gateway adds prompt-aware routing, conversation affinity, request history, API-key controls, and an operator dashboard.

## Features

- OpenAI-compatible proxy for Chat Completions, Responses, Anthropic Messages, and model-list routes.
- Virtual smart models: `auto`, `auto-fast`, and `auto-quality`.
- Prompt-aware routing with deterministic task classes, optional semantic classification, and image detection.
- SQLite-backed dashboard controls for routing, classifier settings, API keys, decision history, and system operations.
- API-key enforcement with named keys, expirations, daily/monthly quotas, and per-key forced model limits.
- Operations-friendly health checks, readiness checks, Prometheus metrics, Docker support, and local SQLite storage.

<p align="center">
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/routing.png" alt="9Router Gateway routing dashboard screenshot" width="30%" />
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/decisions.png" alt="9Router Gateway decisions dashboard screenshot" width="30%" />
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/system.png" alt="9Router Gateway system dashboard screenshot" width="30%" />
</p>

## Quick Start

Requirements:

- Node.js `>=22`
- A running 9Router instance
- 9Router models or combos matching the default targets: `smart-small`, `smart-medium`, `smart-planning`, `smart-large`, and `smart-vision`

Install and run:

```bash
npm install -g @bahirul/9router-gateway
9router-gateway
```

Optional `.env` for local defaults:

```env
NINEROUTER_BASE_URL=http://127.0.0.1:20128
NINEROUTER_API_KEY=
SMART_ROUTER_CONFIG=./config.yaml
SMART_ROUTER_HOST=0.0.0.0
SMART_ROUTER_PORT=20129
SMART_ROUTER_MAX_BODY_BYTES=134217728
SMART_ROUTER_DATA_DIR=./data
SMART_ROUTER_MODEL_CACHE=./data/models
```

Set `NINEROUTER_API_KEY` in the gateway process when the upstream 9Router URL requires authentication. Client keys created in the dashboard are separate and are not forwarded upstream.

Open the dashboard:

```text
http://127.0.0.1:20129/dashboard
```

Default admin password: `smart9router`. Change it from the System page after first login.

## Client URLs

Use these endpoints from clients:

```text
OpenAI-compatible base URL: http://127.0.0.1:20129/v1
Anthropic Messages endpoint: http://127.0.0.1:20129/v1/messages
```

Use `auto`, `auto-fast`, or `auto-quality` as the model for smart routing. Explicit upstream model names pass through unless the API key has a forced model limit.

## Configuration

Start from `config.example.yaml` when you need file-based defaults. Most operator settings are editable from the dashboard and stored in `data/router.sqlite`, including routing targets, task classes, classifier settings, API-key enforcement, quotas, per-key model limits, and runtime overrides.

Only the environment variables shown in `.env.example` are read by the app.

## More Documentation

- [Configuration](docs/configuration.md): `.env`, `config.yaml`, dashboard overrides, API keys, and task classes.
- [Clients](docs/clients.md): OpenAI-compatible, Codex CLI, Claude/Anthropic, and API-key examples.
- [Routing](docs/routing.md): virtual models, task classification, semantic classifier, affinity, shadow mode, and forced models.
- [Operations](docs/operations.md): dashboard, storage, health checks, metrics, Docker, reset actions, and troubleshooting.
- [Development](docs/development.md): local commands, tests, build, package scripts, and source layout.

## License

MIT
