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
- `src/router-engine.js`: request normalization, feature extraction, classifier use, affinity, forced-model handling, learned routing examples, catalog fallback, and decision logging.
- `src/policy.js`: score-to-target policy and routing profile behavior.
- `src/features.js`: deterministic signal extraction.
- `src/task-classes.js`: built-in task class defaults and validation.
- `src/classifier.js`: optional semantic classifier backed by `@huggingface/transformers`.
- `src/affinity.js`: session affinity for stable multi-turn dispatch.
- `src/request-normalizer.js`: OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages normalization.
- `src/decision-store.js`: SQLite storage for decisions, outcomes, feedback, learned routing examples, API keys, admin password, quotas, and runtime config.
- `src/decision-corrector.js`: judge-model review of stored decisions and application of learned routing examples.
- `src/log-store.js`: JSONL logging plus persistence handoff to `DecisionStore`.
- `src/metrics.js`: in-process Prometheus-style counters and gauges.
- `src/session-manager.js`: dashboard sessions and CSRF checks.
- `src/static-ui.js`: static dashboard asset serving.
- `src/package-info.js`: package version lookup.
- `ui/src/`: React dashboard.
- `tests/`: Node test suite for routing, config, admin API, storage, UI API, and correction flows.
- `scripts/`: evaluation, upstream smoke, and admin password utilities.

## Runtime Config Proposal Modules

Runtime config proposals are the safe-change workflow for dashboard-assisted routing tuning:

- `src/admin-api.js`: exposes decision review, feedback, learned-routing reset, runtime config, and admin operations endpoints.
- `src/learned-routing.js`: owns tokenization and similarity matching for local learned routing examples.
- `src/config.js`: owns the authoritative `RuntimeConfigManager.update()` apply path, revision checks, UI-editable path enforcement, validation, persistence, and listener notification.
- `src/server.js`: wires the decision corrector into the admin API and updates live components when runtime config changes.
- `tests/decision-corrector.test.js`, `tests/admin-api.test.js`, and `tests/config-manager.test.js`: cover model review, endpoint dispatch, stale revision handling, and runtime persistence.

The built-in proposer exposes `generate()`, `propose()`, `buildPatch()`, `validate()`, and `preview()` helpers and defaults to routing-only allowed paths: thresholds, ambiguity margin, virtual profile score biases, routing targets, and `routing.taskClasses`. Keep this list narrow unless the apply path and dashboard UX are also updated; generated patches should never be able to modify secrets, server binding, storage paths, or unrelated security settings.

Safe apply semantics depend on `RuntimeConfigManager.update()` rather than direct writes:

- Callers pass `{ patch, expectedRevision }`; mismatched revisions fail before validation or persistence.
- `leafPaths(patch)` must be in the UI-editable path set from `src/config.js`.
- The candidate config is merged over file/env/runtime values, validated, and optionally checked against the current model catalog.
- Persistence happens only after validation succeeds, using SQLite `meta.runtime_config` when attached or the legacy runtime JSON file otherwise.
- Change listeners are notified after persistence so in-memory services switch together; failed validation leaves the previous config and revision intact.

## Decision Review Modules

Decision review starts from stored routing decisions and can create reusable learned routing examples:

- `src/admin-api.js`: exposes `POST /api/admin/decisions/:requestId/review` and `POST /api/admin/decisions/:requestId/review/apply`.
- `src/decision-corrector.js`: calls an upstream judge model through `/v1/chat/completions`, asks for strict JSON, validates confidence, and returns a suggestion.
- `src/decision-store.js`: stores review feedback, learned routing examples, ratings, and correction metadata.
- `src/router-engine.js`: applies active learned routing examples for similar prompts when not in shadow mode and not forced by an API key.
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
