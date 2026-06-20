<p align="center">
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/overview.png" alt="9Router Gateway overview dashboard screenshot" />
</p>

<h1 align="center">9Router Gateway</h1>

9Router Gateway sits between AI clients and [9Router](https://github.com/decolua/9router). It accepts OpenAI-compatible and Anthropic Messages requests, routes virtual models such as `auto`, and forwards requests to 9Router.

```text
AI client -> 9Router Gateway :20129 -> 9Router :20128 -> provider
```

9Router still owns provider credentials, account rotation, quota handling, format translation, and provider fallback. The gateway adds prompt-aware routing, conversation affinity, request history, API-key controls, decision review, privacy reset tools, and an operator dashboard.

## Features

- OpenAI-compatible proxy for Chat Completions, Responses, Anthropic Messages, and model-list routes.
- Virtual smart models: `auto`, `auto-fast`, and `auto-quality`.
- Prompt-aware routing with deterministic task classes, optional semantic classification, and image detection.
- Decision history with per-request route explanations, operator feedback, upstream model review, and learned local routing examples.
- Batch review tooling for stored decisions so operators can inspect and correct routing behavior faster.
- Routing config proposal workflow that asks an upstream model for safe, previewable dashboard changes before operators apply them.
- Privacy controls to reset reviewed prompt context and disable learned routing examples without deleting all history.
- API-key enforcement with named keys, expirations, quotas, active/revoked state, and per-key forced model limits.
- SQLite-backed dashboard controls for routing, task classifier settings, API keys, decision history, review workflows, and system operations.
- Operations-friendly health checks, readiness checks, Prometheus metrics, Docker support, and local SQLite storage.

<p align="center">
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/routing.png" alt="9Router Gateway routing dashboard screenshot" width="30%" />
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/task-classifier.png" alt="9Router Gateway task classifier dashboard screenshot" width="30%" />
  <img src="https://raw.githubusercontent.com/bahirul/9router-gateway/main/screenshots/decission-review.png" alt="9Router Gateway decision review dashboard screenshot" width="30%" />
</p>

<p align="center">
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

Dashboard pages:

- Overview: request volume, target distribution, latency, total task duration, tokens, task classes, complexity, and service status.
- Routing: target models, thresholds, virtual-model profiles, shadow mode, affinity, raw prompt logging, and retention.
- Task Classifier: deterministic task classes, regexes, semantic labels, score deltas, hard floors, priority, and reset-to-defaults.
- Decisions: stored routing decisions, request signals, operator feedback, single-decision review, batch review, and model-assisted routing config proposals.
- Playground: quick route explanations for OpenAI Chat, OpenAI Responses, and Anthropic Messages payloads.
- API Keys: gateway client keys, expirations, quotas, active/revoked state, and forced model limits.
- System: endpoint examples, admin password changes, catalog refresh, prompt privacy cleanup, history purge, override reset, and database reset.

## Client URLs

Use these endpoints from clients:

```text
OpenAI-compatible base URL: http://127.0.0.1:20129/v1
Anthropic Messages endpoint: http://127.0.0.1:20129/v1/messages
```

Use `auto`, `auto-fast`, or `auto-quality` as the model for smart routing. Explicit upstream model names pass through unless the API key has a forced model limit.

When dashboard API-key enforcement is enabled, clients must send either `Authorization: Bearer <key>` or `x-api-key: <key>`. These gateway client keys are separate from `NINEROUTER_API_KEY`, which is only used by the gateway when calling upstream 9Router.

## Decision Review

Dashboard → Decisions stores smart-routing decisions with the extracted signals used by the router. Operators can open a decision, add feedback, ask an upstream 9Router model to review the route, preview the suggestion, and apply it when appropriate.

Applied reviews always store operator feedback. They train a local learned-routing classifier only when the operator enables **Create learned routing when eligible** before applying the model suggestion. Future similar prompts can route with mode `learned_classified`; the system does not mutate task-class regexes, thresholds, or routing targets automatically.

Use batch review from the Decisions page when you want to review multiple stored decisions in one workflow. Review features require stored prompt/request context, so enable Dashboard → Routing → Raw prompt logging before collecting decisions you plan to audit. Stored request context is sanitized for sensitive fields before persistence.

## Routing Config Proposals

Dashboard → Decisions → Review all sends matching unreviewed decisions to the selected judge model one by one. Confident correct or incorrect reviews train learned routing only when the batch option is enabled, while uncertain reviews are still marked reviewed as feedback.

Every proposal is normalized and validated before it can be previewed or applied. The preview compares current routing with the candidate configuration for the supplied samples, showing task, target, complexity, and whether each route would change.

Applying a proposal is an explicit operator action. Accepted changes are saved as dashboard/runtime routing overrides, while rejected or invalid paths are ignored instead of silently mutating task classes, thresholds, or targets.

## Prompt Context Privacy Reset

Use Dashboard → System → Reset learned routing data to clear stored raw prompts and request context for reviewed decisions, and disable learned routing examples. Use Clear all prompt data to remove stored raw prompts and request context from every decision while keeping history and feedback.

For stronger cleanup, Dashboard → System can also purge decision history, reset runtime overrides, or reset the SQLite database while preserving the admin password.

When deployed behind Cloudflare or another reverse proxy, recorded decision IPs prefer `CF-Connecting-IP`, `True-Client-IP`, forwarded headers, and then the socket address.

## Configuration

Start from `config.example.yaml` when you need file-based defaults. Most operator settings are editable from the dashboard and stored in `data/router.sqlite`, including routing targets, task classes, classifier settings, raw prompt logging, API-key enforcement, quotas, per-key model limits, decision review corrections, and runtime overrides.

Only the environment variables shown in `.env.example` are read by the app.

## More Documentation

- [Configuration](docs/configuration.md): `.env`, `config.yaml`, dashboard overrides, API keys, and task classes.
- [Clients](docs/clients.md): OpenAI-compatible, Codex CLI, Claude/Anthropic, and API-key examples.
- [Routing](docs/routing.md): virtual models, task classification, semantic classifier, affinity, shadow mode, and forced models.
- [Operations](docs/operations.md): dashboard, storage, health checks, metrics, Docker, reset actions, and troubleshooting.
- [Development](docs/development.md): local commands, tests, build, package scripts, and source layout.
- [Release Notes](RELEASE_NOTES.md): version history, notable changes, and upgrade notes.

## License

MIT
