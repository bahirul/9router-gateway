# Configuration

9Router Gateway reads bootstrap settings from environment variables and `config.yaml`, then stores dashboard-managed runtime settings in SQLite.

## Bootstrap Environment

Only these environment variables are read:

```env
NINEROUTER_BASE_URL=http://127.0.0.1:20128
NINEROUTER_API_KEY=
SMART_ROUTER_CONFIG=./config.yaml
SMART_ROUTER_HOST=127.0.0.1
SMART_ROUTER_PORT=20129
SMART_ROUTER_MAX_BODY_BYTES=134217728
SMART_ROUTER_DATA_DIR=./data
SMART_ROUTER_MODEL_CACHE=./data/models
```

`npm start`, `npm run dev`, and the package binary use Node's `--env-file-if-exists=.env`, so a local `.env` is optional.

`NINEROUTER_API_KEY` is the gateway-to-upstream credential. Dashboard API keys and client-provided `Authorization` or `x-api-key` headers authenticate callers to the gateway and are never forwarded to upstream 9Router.

## Config File

Start with:

```bash
cp config.example.yaml config.yaml
```

Important defaults from `src/config.js`; `config.example.yaml` mirrors these except that it binds `server.host` to `0.0.0.0` for container-friendly installs:

- Server: `127.0.0.1:20129`, `134217728` max body bytes.
- Upstream: `http://127.0.0.1:20128`, optional `NINEROUTER_API_KEY`, `600000` ms request timeout, `30000` ms catalog refresh, strict model validation enabled.
- Routing targets: `smart-small`, `smart-medium`, `smart-planning`, `smart-large`, `smart-vision`.
- Virtual profiles: `auto`, `auto-fast`, `auto-quality`.
- Classifier: `Xenova/nli-deberta-v3-xsmall`, revision `2a4f614a701367a02d51389039afc998faeda637`, cached in `./data/models`.
- Storage: `./data`, `30` day decision retention.
- Security: `8` hour dashboard session, API-key enforcement disabled by default.

## Configuration Precedence

Startup configuration is built from:

1. Built-in defaults from `src/config.js`.
2. `config.yaml`, selected by `SMART_ROUTER_CONFIG`.
3. The bootstrap environment variables listed above.
4. SQLite-backed dashboard overrides in `router.sqlite`.

Dashboard-managed settings are hot-applied without restart. They are stored in `SMART_ROUTER_DATA_DIR/router.sqlite` under the `meta.runtime_config` row. Older `runtime-config.json` overrides are migrated into SQLite on startup and renamed with a `.migrated` suffix.

## Dashboard-Managed Settings

The dashboard manages:

- Upstream request timeout and strict model validation.
- Routing targets, thresholds, profiles, and shadow mode.
- Task classes and regex patterns.
- Semantic classifier enablement, timeout, confidence, and local-file mode.
- Affinity TTL, affinity entry limit, decision-retention settings, and raw prompt logging.
- API-key enforcement, key quotas, and per-key model limits.

Task classes are initialized from built-in English defaults and then stored in SQLite. Existing deployments with `routing.taskClasses` in `config.yaml` import those classes into SQLite once; new YAML task-class edits are ignored after SQLite has task classes. Use Dashboard → Task Classifier → Reset to defaults to restore the current built-in task classes without changing semantic classifier runtime options.

Dashboard reset returns runtime overrides to file and environment values, but keeps the SQLite task-class seed so task classes remain dashboard-managed. Database reset deletes decisions, feedback, API keys, quotas, and dashboard settings while preserving the current admin password.

## Runtime Config Proposals

Runtime routing configuration is edited through the dashboard config forms or `PATCH /api/admin/config`. Decision reviews no longer mutate runtime config; they train local learned routing examples instead.

The built-in proposal module only accepts routing runtime paths by default:

- `routing.thresholds.medium` and `routing.thresholds.high`.
- `routing.ambiguityMargin`.
- `routing.profiles.auto.scoreBias`, `routing.profiles.auto-fast.scoreBias`, and `routing.profiles.auto-quality.scoreBias`.
- `routing.targets.small`, `routing.targets.medium`, `routing.targets.planning`, `routing.targets.large`, and `routing.targets.vision`.
- `routing.taskClasses` as one atomic editable value.
- `classifier.enabled` and `classifier.minimumConfidence`.

The built-in proposer module calls the configured upstream `/v1/chat/completions` endpoint with a strict JSON prompt. The response is normalized to `{ summary, rationale, changes }`, converted into a patch, validated against the allowed paths, merged with the current config, and checked with normal config validation. When the catalog is ready and strict model validation is enabled, proposed routing targets must exist in the upstream 9Router catalog.

Apply semantics are intentionally conservative:

- Proposal and preview requests never persist changes.
- Apply implementations should use the same runtime config update path as the dashboard, including the current runtime config revision; stale revisions fail with a conflict so operators reload before saving.
- Only UI-editable runtime paths can be saved, even if a proposal service returns extra fields.
- Candidate configs are fully validated before persistence, including threshold ordering, classifier ranges, positive timeouts, and routing target checks.
- Successful applies persist to SQLite `meta.runtime_config` when the store is available, then notify runtime listeners so routing, catalog, classifier, affinity, and logging components use the new config without restart.
- Failed applies leave the existing runtime config unchanged.

## Raw Prompt Logging

`logging.rawPrompts` is disabled by default. When enabled, decision records include the latest user prompt and a request snapshot in SQLite and `decisions.jsonl`. Leave it disabled unless operators need richer feedback review because this data can contain private request content.

Dashboard → System → Reset learned routing data clears stored prompt/request context only for reviewed decisions tied to learned routing, then deactivates learned routing examples. Clear all prompt data removes stored prompt/request context from every decision. Decision history and feedback records remain available in both cases.

## Client IPs Behind Proxies

Decision records and admin login rate limits use proxy-aware client IP extraction. The gateway prefers `CF-Connecting-IP`, `True-Client-IP`, the first valid `X-Forwarded-For` value, `X-Real-IP`, `Forwarded`, and finally the socket remote address. This makes Cloudflare deployments record the user IP instead of the Cloudflare edge IP.

## API Keys

API-key enforcement is controlled by `security.apiKeyAuthEnabled` from the dashboard. When enabled, routed `/v1/*` requests require a valid active gateway key except operator routes under `/v1/router/`.

Each key can have:

- Expiration time or no expiration.
- Daily or monthly request quota.
- Active/inactive status.
- Optional forced model limit from the current 9Router catalog.

Forced model limits dispatch routable chat/completion requests for that key to the selected upstream model. `/v1/models` responses are filtered to `auto`, `auto-fast`, `auto-quality`, and the forced model. Virtual model requests still record routing decisions as `key_shadow` telemetry.

## Admin Password

The default admin password is `smart9router`. It is created on first run and stored in SQLite. Change it from Dashboard → System or with:

```bash
npm run admin:set-password -- 'a-new-password'
```

## Validation Notes

- Dashboard config updates are limited to the UI-editable runtime paths listed above and require the current config revision.
- `upstream.baseUrl` must be a valid `http` or `https` URL; the stored value is normalized without a trailing slash.
- When `upstream.strictModelValidation` is enabled and the catalog is ready, routing targets and `routing.shadowTarget` must exist in the 9Router catalog.
- `routing.thresholds.medium` must be lower than `routing.thresholds.high`.
- Routing target names and `routing.shadowTarget` must be non-empty.
- Forced API-key models are validated against the 9Router model catalog when the catalog is ready.
- API-key expiration values must be valid ISO timestamps or `null`; quotas must use `daily`, `monthly`, or no quota, with positive numeric limits.
- `classifier.minimumConfidence` must be between `0` and `1`.
- Timeouts, retention, body size, affinity TTL, affinity entry limit, and session TTL must be positive numbers.
- `security.apiKeyAuthEnabled` must be a boolean.
