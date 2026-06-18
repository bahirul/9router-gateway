# Configuration

9Router Gateway reads bootstrap settings from environment variables and `config.yaml`, then stores dashboard-managed runtime settings in SQLite.

## Bootstrap Environment

Only these environment variables are read:

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

`npm start`, `npm run dev`, and the package binary use Node's `--env-file-if-exists=.env`, so a local `.env` is optional.

## Config File

Start with:

```bash
cp config.example.yaml config.yaml
```

Important defaults from `config.example.yaml`:

- Server: `0.0.0.0:20129`, `134217728` max body bytes.
- Upstream: `NINEROUTER_BASE_URL`, optional `NINEROUTER_API_KEY`, `600000` ms request timeout.
- Routing targets: `smart-small`, `smart-medium`, `smart-planning`, `smart-large`, `smart-vision`.
- Virtual profiles: `auto`, `auto-fast`, `auto-quality`.
- Classifier: `Xenova/nli-deberta-v3-xsmall`, cached in `./data/models`.
- Storage: `./data`, `30` day decision retention.
- Security: `8` hour dashboard session, API-key enforcement disabled by default.

## Configuration Precedence

Startup configuration is built from:

1. Built-in defaults from `src/config.js`.
2. `config.yaml`, selected by `SMART_ROUTER_CONFIG`.
3. The bootstrap environment variables listed above.
4. SQLite-backed dashboard overrides in `router.sqlite`.

Dashboard-managed settings are hot-applied without restart. They are stored in `SMART_ROUTER_DATA_DIR/router.sqlite` under the `meta.runtime_config` row.

## Dashboard-Managed Settings

The dashboard manages:

- Routing targets, thresholds, profiles, and shadow mode.
- Task classes and regex patterns.
- Semantic classifier enablement, timeout, confidence, and local-file mode.
- Affinity and decision-retention settings.
- Raw prompt logging.
- API-key enforcement, key quotas, and per-key model limits.

Task classes are initialized from built-in defaults and then stored in SQLite. Existing deployments with `routing.taskClasses` in `config.yaml` import those classes into SQLite once; new YAML task-class edits are ignored after SQLite has task classes.

## API Keys

API-key enforcement is controlled by `security.apiKeyAuthEnabled` from the dashboard. When enabled, `/v1/*` requests require a valid active key except operator routes under `/v1/router/`.

Each key can have:

- Expiration time or no expiration.
- Daily or monthly request quota.
- Active/inactive status.
- Optional forced model limit.

Forced model limits dispatch all routable requests for that key to the selected upstream model. Virtual model requests still record routing decisions as `key_shadow` telemetry.

## Admin Password

The default admin password is `smart9router`. It is created on first run and stored in SQLite. Change it from Dashboard → System or with:

```bash
npm run admin:set-password -- 'a-new-password'
```

## Validation Notes

- `routing.thresholds.medium` must be lower than `routing.thresholds.high`.
- Routing target names and `routing.shadowTarget` must be non-empty.
- Forced API-key models are validated against the 9Router model catalog when the catalog is ready.
- `classifier.minimumConfidence` must be between `0` and `1`.
- Timeouts, retention, body size, affinity TTL, and session TTL must be positive numbers.
