# Operations

This guide covers dashboard operations, decision review, storage, health checks, metrics, Docker, and common recovery tasks.

## Dashboard

Open:

```text
http://127.0.0.1:20129/dashboard
```

Default password: `smart9router`.

Dashboard pages:

- Overview: request volume, target distribution, latency, tokens, task classes, complexity, and status.
- Routing: targets, thresholds, profiles, shadow mode, affinity, and retention.
- Task Classifier: task-class regexes, semantic labels, score deltas, hard floors, and classifier runtime settings.
- Decisions: stored request decisions, filters, signals, outcomes, single-decision review, batch review, and feedback.
- Playground: dry-run route explanation without dispatching or mutating affinity.
- API Keys: key creation, quotas, enable/disable, secret copy, and per-key model limits.
- System: status, storage health, client endpoints, password management, catalog refresh, resets, and config source display.

## Decision Review

Dashboard → Decisions lists stored routing decisions with filters for target, task, complexity, upstream status, and routing mode. Open a row to inspect the request summary, routing signals, token usage, classifier usage, affinity behavior, and operator feedback.

Single-decision review:

- Select a judge model, or leave it blank to use the default `smart-small` judge.
- Set the minimum confidence threshold, defaulting to `0.7`.
- Click Review with model to send the stored prompt or request context for that decision to the judge model.
- Apply the suggestion when the verdict is an incorrect decision above the confidence threshold. This stores low-rating feedback and, when prompt context is available, creates a prompt-hash routing correction for matching future requests.

Manual feedback:

- Save a 1–5 star rating, optional expected target, and optional note from the decision drawer.
- Enable Create routing correction from this feedback when an expected target should be reused for future requests with the same prompt hash.
- Reset feedback from the drawer to remove that decision's feedback and deactivate the manual prompt correction created from it.

Batch review:

- Click Review all from Dashboard → Decisions to review every unreviewed decision matching the current filters.
- The batch runs one decision at a time with the selected judge model and confidence threshold.
- Incorrect high-confidence verdicts are applied automatically and can create learned prompt corrections.
- Correct and uncertain verdicts are saved as feedback so those decisions become reviewed, but they do not create prompt corrections.
- Decisions without stored prompt/request context are skipped; failed reviews are counted and the batch continues.

## Storage

Runtime data is stored under `SMART_ROUTER_DATA_DIR`, defaulting to `./data`.

Important files:

- `router.sqlite`: admin password, dashboard overrides, task classes, decisions, stored prompt/request context, feedback, correction runs, prompt corrections, API keys, quotas, and usage.
- `models/`: semantic classifier cache when `SMART_ROUTER_MODEL_CACHE=./data/models`.
- `decisions.jsonl` and `feedback.jsonl`: legacy append logs imported once into SQLite when present.

Dashboard → System shows SQLite readiness, storage errors, buffered events waiting for storage, and decision-retention days.

## Admin Password

Change the password from Dashboard → System or run:

```bash
npm run admin:set-password -- 'a-new-password'
```

The password is stored in SQLite and survives restarts.

## Reset Actions

Dashboard → System includes:

- Refresh model catalog: reloads upstream `/v1/models`.
- Reset reviewed prompt data: clears stored raw prompts and request context for reviewed decisions and disables learned prompt corrections. Decision history and feedback remain available.
- Purge decision history: deletes stored decisions and feedback.
- Reset runtime overrides: removes dashboard-managed config overrides and returns to `config.yaml` and environment values immediately.
- Reset database: deletes SQLite decisions, feedback, API keys, quotas, and dashboard settings after confirming the admin password; the admin password is preserved.

Use Reset reviewed prompt data after finishing review cycles when you want to keep review outcomes but remove the raw prompt/request context used by the judge model. Use Purge decision history only when you no longer need decision, feedback, correction-run, or prompt-correction history.

## Health and Readiness

```bash
curl http://127.0.0.1:20129/healthz
curl http://127.0.0.1:20129/readyz
```

- `/healthz` reports process health.
- `/readyz` reports readiness, including catalog readiness when strict model validation is enabled.

Dashboard → System also reports catalog readiness, classifier state, SQLite storage state, buffered storage events, affinity entries, and the current proxy base URLs.

## Metrics

Prometheus metrics are available at `/metrics` and require admin authorization with the admin password as bearer token or `x-admin-key`.

```bash
curl http://127.0.0.1:20129/metrics \
  -H 'Authorization: Bearer smart9router'
```

Core metrics include uptime, active affinity entries, catalog readiness, classifier counts and latency, proxy/upstream errors, configuration changes, API-key usage, feedback, decision-correction runs, prompt-correction creation, and prompt-correction resets.

## Docker

Build and run:

```bash
docker build -t 9router-gateway .
docker run --rm -p 20129:20129 \
  -e NINEROUTER_BASE_URL=http://host.docker.internal:20128 \
  -v "$PWD/config.yaml:/app/config.yaml:ro" \
  -v "$PWD/data:/app/data" \
  9router-gateway
```

Compose example:

```bash
cp config.example.yaml config.yaml
docker compose -f docker-compose.example.yml up --build
```

The Docker image uses `node:22-bookworm-slim`, which includes the glibc loader required by `onnxruntime-node` classifier dependencies.

## Troubleshooting

### Classifier degraded in Docker

Use the provided Dockerfile or another glibc-based image. Alpine-style images can miss `ld-linux-x86-64.so.2`, which `onnxruntime-node` needs.

### Model catalog not ready

Check `NINEROUTER_BASE_URL`, `NINEROUTER_API_KEY`, and 9Router availability. Refresh from Dashboard → System after fixing upstream access.

### Automatic routing returns 503

With strict model validation enabled, missing routing targets fail closed. Ensure 9Router returns the configured targets from `/v1/models`, or disable strict validation for local development.

### API key gets 429

The key exceeded its daily or monthly quota. Increase the quota from Dashboard → API Keys or wait for the next period.

### Decision review is skipped

The decision may not have stored prompt or request context. New decisions keep review context in SQLite; older imported or reset-reviewed decisions may only have summary metadata.

### Review all processes too many decisions

Batch review uses the active Decisions filters and only skips already-reviewed rows. Narrow the target, task, complexity, status, or mode filters before clicking Review all.

### Learned correction keeps routing a prompt

Open the source decision and reset its feedback if it was a manual correction, or use Dashboard → System → Reset reviewed prompt data to disable all learned prompt corrections while preserving decision history and feedback.

### Storage shows degraded

Check that `SMART_ROUTER_DATA_DIR` is writable by the process and that the SQLite file is not locked by another process. Buffered events should drain after storage becomes ready.

### Metrics returns 401

Pass the admin password as `Authorization: Bearer <password>` or `x-admin-key: <password>`. Dashboard session cookies do not authorize direct `/metrics` scrapes.
