# Operations

This guide covers dashboard operations, storage, health checks, metrics, Docker, and common recovery tasks.

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
- Decisions: stored request decisions, signals, outcomes, and feedback.
- Playground: dry-run route explanation without dispatching or mutating affinity.
- API Keys: key creation, quotas, enable/disable, secret copy, and per-key model limits.
- System: status, client endpoints, password management, catalog refresh, resets, and config source display.

## Storage

Runtime data is stored under `SMART_ROUTER_DATA_DIR`, defaulting to `./data`.

Important files:

- `router.sqlite`: admin password, dashboard overrides, task classes, decisions, feedback, API keys, quotas, and usage.
- `models/`: semantic classifier cache when `SMART_ROUTER_MODEL_CACHE=./data/models`.
- `decisions.jsonl` and `feedback.jsonl`: legacy append logs imported once into SQLite when present.

## Admin Password

Change the password from Dashboard → System or run:

```bash
npm run admin:set-password -- 'a-new-password'
```

The password is stored in SQLite and survives restarts.

## Reset Actions

Dashboard → System includes:

- Refresh model catalog: reloads upstream `/v1/models`.
- Purge decision history: deletes stored decisions and feedback.
- Reset runtime overrides: returns dashboard-managed config to defaults and seeded task classes.
- Reset database: deletes SQLite decisions, feedback, API keys, quotas, and dashboard settings after confirming the admin password; the admin password is preserved.

## Health and Readiness

```bash
curl http://127.0.0.1:20129/healthz
curl http://127.0.0.1:20129/readyz
```

- `/healthz` reports process health.
- `/readyz` reports readiness, including catalog readiness when strict model validation is enabled.

## Metrics

Prometheus metrics are available at `/metrics` and require admin authorization with the admin password as bearer token or `x-admin-key`.

```bash
curl http://127.0.0.1:20129/metrics \
  -H 'Authorization: Bearer smart9router'
```

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
