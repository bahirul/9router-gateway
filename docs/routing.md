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
- Virtual model requests still run routing, but learned routing and global shadow dispatch are skipped.
- Virtual requests with a forced key dispatch to the forced model and are logged with mode `key_shadow`.
- `GET /v1/models` is filtered to `auto`, `auto-fast`, `auto-quality`, and the forced model.
- If strict model validation is enabled, the forced model must resolve in the 9Router catalog or the request fails closed.

Forced models are selected from the upstream catalog in Dashboard → API Keys. Custom values are allowed in the UI, but API validation rejects unknown models when the catalog is ready.

## Decision Correction

Dashboard → Decisions can ask an upstream 9Router model to review one decision record from the decision detail drawer. The review is preview-only until an operator applies the suggested correction.

The review model receives the configured routing targets, the recorded prediction, and stored request context. It is prompted to return strict JSON with verdict `correct`, `incorrect`, or `uncertain`, an optional `expectedTargetKey`, confidence, and a short rationale. If the upstream rejects JSON response format, the gateway retries once without `response_format` and still parses a JSON object from the response text.

Only records with stored prompt/request context are eligible for model review. Enable Dashboard → Routing → Raw prompt logging before collecting decisions you want to review; stored request context is sanitized for sensitive fields before persistence. If full request context is present, the review sees that request body; otherwise it can use the stored latest prompt text. Records without either are marked ineligible with `missing_context` and no upstream call is made.

Applied reviews always write operator feedback. `correct` becomes positive feedback, `uncertain` marks the decision reviewed without training, and `incorrect` can train learned routing only when it includes a configured target key and meets the confidence threshold, which defaults to `0.7`.

Model review training is opt-in from the single-review drawer and batch-review dialog. When enabled, confident `correct` reviews train the selected target as a positive example, and confident `incorrect` reviews train the suggested target. Future similar virtual-model requests use mode `learned_classified`, keep the original configured target for audit fields, and dispatch to the learned target. Learned routing does not run during global shadow mode or per-key forced-model routing, and it does not rewrite task-class regexes, thresholds, or model targets automatically.

Operators can also train learned routing from manual feedback when they choose a configured expected target and the decision has stored prompt context. Manual and model-reviewed examples use the same similarity matching behavior.

Dashboard → System → Reset learned routing data disables learned routing examples and clears stored raw prompt/request context only for reviewed decisions. Clear all prompt data removes stored raw prompt/request context from every decision. Decision history and feedback remain available in both flows.

Batch review is a dashboard workflow, not a separate routing path or server-side batch endpoint. Dashboard → Decisions → Review all calls the same single-decision review, apply, and feedback endpoints sequentially for each unreviewed record that matches the active filters.

## Routing Config Proposals

Reviewed decisions can be used to propose safer routing config changes from observed routing misses. This workflow is intentionally staged:

1. Review decisions from Dashboard → Decisions and apply feedback when the expected target differs from the selected target.
2. Click Review all with Decisions filters set to the unreviewed slice you want the judge model to review; enable learned-routing training only when those model judgments should affect future similar prompts.
3. Inspect the model-generated config proposal, including each changed path, rationale, and proposed value.
4. Inspect the backend impact preview before approving. The preview compares current routing with the candidate config for the reviewed matching samples.
5. Approve and apply only when the preview matches operator intent.

The dashboard proposal path uses the same single-decision review history but does not apply learned changes automatically. The built-in proposer accepts only a conservative set of config paths and rejects invalid regexes, unknown paths, and target changes that fail catalog validation.

Approval writes the proposed patch through the same runtime configuration update path as Dashboard → Routing. The patch includes the expected config revision, so applying fails if another operator changed routing settings after the proposal was generated. Reopen the proposal after a stale-revision failure.

Proposal APIs validate candidate config before use. Allowed proposal paths are limited to routing thresholds, ambiguity margin, virtual-model score biases, routing targets, `routing.taskClasses`, and selected classifier settings; candidate targets must resolve in the 9Router catalog when strict model validation is enabled.

## Strict Model Validation

When `upstream.strictModelValidation` is enabled, automatic routing fails closed if the chosen target is missing from the 9Router `/v1/models` catalog.

For local development, set `upstream.strictModelValidation: false` when the catalog is incomplete or unavailable.
