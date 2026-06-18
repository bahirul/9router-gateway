# Routing

9Router Gateway routes only virtual model requests. Explicit upstream model or combo names normally pass through unchanged.

## Virtual Models

Supported virtual models:

- `auto`: balanced default.
- `auto-fast`: score bias toward cheaper/smaller targets.
- `auto-quality`: score bias toward stronger targets.

Default target mapping:

| Request type | Default target |
| --- | --- |
| Simple transformations | `smart-small` |
| Coding, debugging, review, and research | `smart-medium` |
| Architecture and planning | `smart-planning` |
| Security, risky migrations, and complex production work | `smart-large` |
| Image input | `smart-vision` |

Targets are editable from Dashboard → Routing.

## Feature Extraction

The router normalizes OpenAI Chat, OpenAI Responses, and Anthropic Messages request shapes. It extracts:

- latest user text;
- system text;
- message counts and user-turn counts;
- tool count and tool names;
- image presence;
- structured-output hints;
- reasoning effort;
- stable prompt hash.

These features drive deterministic scoring before any semantic classifier is used.

## Task Classes

Task classes are deterministic labels with optional regex patterns, priority, score delta, semantic label, semantic score, and hard floor.

They are edited from Dashboard → Task Classifier and stored in SQLite. Use one JavaScript regex per line in the dashboard regex box.

Signal-only task classes use `task: false`; they affect score or hard floor without becoming the reported task label.

## Semantic Classifier

The semantic classifier is optional and only used near a decision boundary or when deterministic confidence is low. Defaults:

- Model: `Xenova/nli-deberta-v3-xsmall`
- Revision: `2a4f614a701367a02d51389039afc998faeda637`
- Timeout: `400` ms
- Minimum confidence: `0.32`
- Cache directory: `SMART_ROUTER_MODEL_CACHE` or `./data/models`

If loading fails, classification times out, or confidence is too low, the router falls back to deterministic routing.

## Conversation Affinity

Affinity prevents later turns in the same conversation from being downgraded after a stronger target was selected.

Send this header when your client has a stable conversation ID:

```http
x-smart-router-session-id: conversation-123
```

The gateway also checks common body fields such as `session_id`, `conversation_id`, `thread_id`, and matching `metadata` fields. If none exist, it derives a privacy-safe fingerprint from the early conversation context and user agent.

## Shadow Mode

Global shadow mode records the target the router would select while dispatching virtual-model requests to `routing.shadowTarget`.

Use Dashboard → Routing to enable shadow mode and choose the dispatch target. Decisions recorded in history use mode `shadow`.

## Per-Key Forced Models

API keys can force all routable requests to one upstream model. This is useful when sharing a key with a friend or client while limiting cost or model access.

Behavior:

- Explicit model requests are rewritten to the forced model and are not logged as smart-routing decisions.
- Virtual model requests still run routing, then dispatch to the forced model.
- Virtual requests with a forced key are logged with mode `key_shadow`.
- `GET /v1/models` is filtered to `auto`, `auto-fast`, `auto-quality`, and the forced model.

Forced models are selected from the upstream catalog in Dashboard → API Keys. Custom values are allowed in the UI, but API validation rejects unknown models when the catalog is ready.

## Batch Decision Correction

Dashboard → Decisions can ask an upstream 9Router model to review recent decision records in batches. The review is preview-only until an operator applies selected corrections.

Only records with stored prompt/request context are eligible. Enable Dashboard → Routing → Raw prompt logging before collecting decisions you want to review; stored request context is sanitized for sensitive fields before persistence.

Applying a correction writes operator feedback and stores an exact prompt-hash correction for future matching prompts. Corrections do not rewrite task-class regexes, thresholds, or model targets automatically.

## Strict Model Validation

When `upstream.strictModelValidation` is enabled, automatic routing fails closed if the chosen target is missing from the 9Router `/v1/models` catalog.

For local development, set `upstream.strictModelValidation: false` when the catalog is incomplete or unavailable.
