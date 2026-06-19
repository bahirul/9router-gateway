# Development

## Requirements

- Node.js `>=22`
- npm
- A running 9Router instance for upstream smoke tests or manual proxy testing

## Install

```bash
npm install
```

## Run Locally

```bash
cp config.example.yaml config.yaml
npm run dev
```

The server reads `.env` automatically when it exists. The dashboard is served by the backend at `/dashboard`.

For Vite UI development:

```bash
npm run dev:ui
```

## Build

```bash
npm run build:ui
```

Package publishing runs the same UI build via `prepack`, and published package contents are limited by `package.json` `files` to `bin/`, `src/`, `ui/dist/`, `README.md`, `LICENSE`, and `config.example.yaml`.

## Test

```bash
npm test
```

Full check:

```bash
npm run check
```

`npm run check` runs a syntax check on `src/server.js`, the Node test suite, and the UI production build.

## Useful Scripts

```bash
npm run admin:set-password -- 'a-new-password'
npm run evaluate
npm run smoke:upstream
```

- `admin:set-password`: updates the dashboard password in SQLite.
- `evaluate`: runs routing evaluation scripts.
- `smoke:upstream`: validates upstream 9Router access and catalog behavior.

## Source Layout

- `bin/9router-gateway.js`: executable entrypoint.
- `src/server.js`: HTTP server, proxy flow, health checks, metrics, model list behavior, static UI serving.
- `src/admin-api.js`: dashboard/admin API routes for sessions, config, catalog, API keys, analytics, decisions, feedback, and decision review.
- `src/config.js`: defaults, config loading, env overrides, validation, SQLite runtime config.
- `src/catalog.js`: upstream model catalog refresh and dispatch target validation.
- `src/router-engine.js`: request normalization, feature extraction, classifier use, affinity, forced-model handling, prompt corrections, catalog fallback, and decision logging.
- `src/policy.js`: score-to-target policy and routing profile behavior.
- `src/features.js`: deterministic signal extraction.
- `src/task-classes.js`: built-in task class defaults and validation.
- `src/classifier.js`: optional semantic classifier backed by `@huggingface/transformers`.
- `src/affinity.js`: session affinity for stable multi-turn dispatch.
- `src/request-normalizer.js`: OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages normalization.
- `src/decision-store.js`: SQLite storage for decisions, outcomes, feedback, prompt corrections, API keys, admin password, quotas, and runtime config.
- `src/decision-corrector.js`: judge-model review of stored decisions and application of prompt corrections.
- `src/log-store.js`: JSONL logging plus persistence handoff to `DecisionStore`.
- `src/metrics.js`: in-process Prometheus-style counters and gauges.
- `src/session-manager.js`: dashboard sessions and CSRF checks.
- `src/static-ui.js`: static dashboard asset serving.
- `src/package-info.js`: package version lookup.
- `ui/src/`: React dashboard.
- `tests/`: Node test suite for routing, config, admin API, storage, UI API, and correction flows.
- `scripts/`: evaluation, upstream smoke, and admin password utilities.

## Decision Review Modules

Decision review starts from stored routing decisions and can create reusable prompt corrections:

- `src/admin-api.js`: exposes `POST /api/admin/decisions/:requestId/review` and `POST /api/admin/decisions/:requestId/review/apply`.
- `src/decision-corrector.js`: calls an upstream judge model through `/v1/chat/completions`, asks for strict JSON, validates confidence, and returns a suggestion.
- `src/decision-store.js`: stores review feedback, prompt corrections, ratings, and correction metadata.
- `src/router-engine.js`: applies active prompt corrections for matching prompt hashes when not in shadow mode and not forced by an API key.
- `tests/decision-corrector.test.js` and `tests/decision-store.test.js`: cover review application, correction persistence, and corrected routing decisions.

## Documentation Sources of Truth

When updating docs, verify behavior against:

- `config.example.yaml` and `src/config.js` for defaults and validation.
- `src/server.js` for proxy endpoints, health checks, model filtering, auth headers, and metrics.
- `src/admin-api.js` for dashboard API behavior.
- `src/request-normalizer.js` for supported client request formats.
- `src/router-engine.js` and `src/decision-corrector.js` for routing and decision review behavior.
- `src/decision-store.js` for SQLite schema and persistence behavior.
- `package.json` for commands, package contents, prepack, and Node version.
