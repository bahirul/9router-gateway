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
- Apply the suggestion to store feedback and, for confident correct or incorrect verdicts with prompt context, train learned routing for similar future requests.

Manual feedback:

- Save a 1–5 star rating, optional expected target, and optional note from the decision drawer.
- Choose an expected target when manual feedback should train learned routing for similar future requests.
- Reset feedback from the drawer to remove that decision's feedback and deactivate the learned routing example created from it.

Batch review:

- Click Review all from Dashboard → Decisions to review every unreviewed decision matching the current filters.
- The batch runs one decision at a time with the selected judge model and confidence threshold.
- Confident correct and incorrect verdicts are applied automatically; they train learned routing examples only when the batch option is enabled.
- Uncertain verdicts are saved as feedback so those decisions become reviewed, but they do not train learned routing.
- Decisions without stored prompt/request context are skipped; failed reviews are counted and the batch continues.

## Routing Improvement Workflow

Use this workflow when unreviewed decisions should be judged by a model and optionally turned into learned routing examples:

1. Filter Dashboard → Decisions to the request slice you want to tune, such as a task, target, status, or mode.
2. Review decisions in that slice and apply feedback until the expected target is recorded on the misses.
3. Click Review all to review each matching decision; enable learned-routing training only when confident results should affect future similar prompts.
4. Read the proposal cards. Each card shows the task class, number of reviewed corrections, current `scoreDelta` and `hardFloor`, and proposed values.
5. Check the impact preview counts: Reviewed, Corrections, Would change, and Would improve.
6. Click Approve and apply only after the proposal and preview match operator intent.

Operational guardrails:

- Nothing changes during proposal generation or preview; runtime config changes only after explicit approval.
- The proposal only considers reviewed decisions that match the active Decisions filters.
- At least two corrections for the same existing task class are required before a task-class tuning change is proposed.
- Apply validates against the current editable runtime config and uses the config revision captured with the proposal.
- If review apply fails because config changed, rerun the review before applying again.

Use learned routing for reviewed prompt patterns. Use manual config edits only when you intentionally want to change global routing policy.

## Storage

Runtime data is stored under `SMART_ROUTER_DATA_DIR`, defaulting to `./data`.

Important files:

- `router.sqlite`: admin password, dashboard overrides, task classes, decisions, stored prompt/request context, feedback, correction runs, learned routing examples, API keys, quotas, and usage.
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
- Reset learned routing data: clears stored raw prompts and request context for reviewed decisions and disables learned routing examples. Decision history and feedback remain available.
- Clear all prompt data: removes stored raw prompts and request context from every decision while keeping history and feedback.
- Purge decision history: deletes stored decisions and feedback.
- Reset runtime overrides: removes dashboard-managed config overrides and returns to `config.yaml` and environment values immediately.
- Reset database: deletes SQLite decisions, feedback, API keys, quotas, and dashboard settings after confirming the admin password; the admin password is preserved.

Use Reset learned routing data after finishing review cycles when you want to keep review outcomes but remove the raw prompt/request context used by the judge model. Use Clear all prompt data for broader privacy cleanup across reviewed and unreviewed decisions. Use Purge decision history only when you no longer need decision, feedback, correction-run, or prompt-correction history.

When deployed behind Cloudflare or another reverse proxy, confirm the proxy sends `CF-Connecting-IP`, `True-Client-IP`, or standard forwarded headers. The gateway records the first trusted real-client header it receives before falling back to the socket IP.

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

Open the source decision and reset its feedback if it was a manual correction, or use Dashboard → System → Reset learned routing data to disable all learned routing examples while preserving decision history and feedback.

### Storage shows degraded

Check that `SMART_ROUTER_DATA_DIR` is writable by the process and that the SQLite file is not locked by another process. Buffered events should drain after storage becomes ready.

### Metrics returns 401

Pass the admin password as `Authorization: Bearer <password>` or `x-admin-key: <password>`. Dashboard session cookies do not authorize direct `/metrics` scrapes.
