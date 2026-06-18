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

Package publishing runs the same UI build via `prepack`.

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

- `src/server.js`: HTTP server, proxy flow, health checks, metrics, static UI serving.
- `src/admin-api.js`: dashboard/admin API routes.
- `src/config.js`: defaults, config loading, env overrides, validation, SQLite runtime config.
- `src/router-engine.js`: routing decision orchestration.
- `src/policy.js`: score-to-target policy.
- `src/features.js`: deterministic signal extraction.
- `src/task-classes.js`: built-in task class defaults and validation.
- `src/decision-store.js`: SQLite storage for decisions, feedback, API keys, admin password, quotas, and runtime config.
- `src/request-normalizer.js`: OpenAI, Responses, and Anthropic message normalization.
- `ui/src/`: React dashboard.
- `tests/`: Node test suite.

## Documentation Sources of Truth

When updating docs, verify behavior against:

- `.env.example` for supported env vars.
- `config.example.yaml` and `src/config.js` for defaults and validation.
- `src/server.js` for proxy endpoints, health checks, model filtering, and metrics.
- `src/admin-api.js` for dashboard API behavior.
- `src/decision-store.js` for SQLite schema and persistence behavior.
- `package.json` for commands and Node version.
