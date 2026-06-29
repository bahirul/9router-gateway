# Client Setup

Point clients at 9Router Gateway instead of directly at 9Router.

## Base URLs

```text
OpenAI-compatible base URL: http://127.0.0.1:20129/v1
Anthropic Messages endpoint: http://127.0.0.1:20129/v1/messages
```

Use `auto`, `auto-fast`, or `auto-quality` for smart routing. Explicit 9Router model or combo names pass through unless the API key has a forced model limit.

## API-Key Header

If API-key enforcement is enabled, send either header:

```http
Authorization: Bearer sk-...
```

or:

```http
x-api-key: sk-...
```

Keys are created from Dashboard → API Keys. A key can be limited by expiration, daily/monthly quota, and forced dispatch model.

Client keys authenticate callers to this gateway only. The gateway strips client `Authorization` and `x-api-key` headers before proxying. If the upstream 9Router URL requires authentication, set `NINEROUTER_API_KEY` in the gateway process; the gateway forwards that value upstream as `Authorization: Bearer ...`.

Quota is consumed for `/v1` proxy requests after authorization, including `GET /v1/models` when the key has a quota period.

## OpenAI-Compatible Clients

Use the `/v1` base URL:

```bash
curl http://127.0.0.1:20129/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk-...' \
  -d '{
    "model": "auto",
    "messages": [{"role":"user","content":"Plan a database migration"}]
  }'
```

The gateway smart-routes `POST` requests whose path ends with `/chat/completions`, `/responses`, or `/messages`. Other `/v1` paths are proxied to upstream 9Router unchanged, except for `GET /v1/models`, which adds virtual model aliases.

## Codex CLI

Minimal `~/.codex/config.toml` provider:

```toml
# 9Router Configuration for Codex CLI
model = "auto"
model_provider = "smartrouter"

[model_providers.smartrouter]
name = "smartrouter"
base_url = "http://127.0.0.1:20129/v1"
wire_api = "responses"
```

Then provide the client-side key via `~/.codex/auth.json` when API-key enforcement is enabled:

```json
{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "sk-..."
}
```

For remote upstream access, also set the gateway-side upstream key before starting `9router-gateway`:

```bash
export NINEROUTER_API_KEY='sk-upstream-...'
```

If the upstream response is `API key required for remote API access`, the gateway process is missing `NINEROUTER_API_KEY` or was not restarted with it.

## Claude / Anthropic Messages

Claude Code can use a gateway root URL in `settings.json`:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "model": "auto",
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:20129",
    "ANTHROPIC_AUTH_TOKEN": "sk-...",
    "ANTHROPIC_CUSTOM_MODEL_OPTION": "auto",
    "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": "9Router auto"
  }
}
```

Direct Anthropic Messages-compatible calls should use `/v1/messages`:

```bash
curl http://127.0.0.1:20129/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk-...' \
  -d '{
    "model": "auto",
    "max_tokens": 512,
    "messages": [{"role":"user","content":"Review this change"}]
  }'
```

## Model Behavior

`auto`, `auto-fast`, and `auto-quality` are virtual aliases. Requests using those aliases are normalized, classified, rewritten to the selected 9Router dispatch model, and logged with a routing decision. Requests using explicit upstream models or combos are passed through without smart routing.

Forced-model API keys override routable virtual aliases and explicit passthrough models. The request is dispatched to the forced model, and smart-routed requests report mode `key_shadow` in the response headers.

If Dashboard → Routing → Model identity override is enabled, the gateway adds a short system-level instruction before proxying so assistants answer identity/model-name questions with the configured display name and creator/maker/owner/provider questions with the configured creator name. This applies to Chat Completions, Responses, and Anthropic Messages requests and is best-effort prompt behavior rather than guaranteed response filtering.

Routing normalization currently reads:

- Chat Completions: `messages[].content`
- Responses: `input`, `input[].content`, `input[].input`, or `input[].text`
- Anthropic Messages: `system` plus `messages[].content`
- Tool names from `tools`, image content markers, structured output fields, and reasoning effort fields

Session affinity uses `x-smart-router-session-id` when present. Without that header, it falls back to `prompt_cache_key`, `session_id`, `conversation_id`, `thread_id`, matching metadata fields, or a fingerprint of the first prompt and user agent.

## Model List Behavior

`GET /v1/models` returns upstream 9Router models plus virtual aliases:

- `auto`
- `auto-fast`
- `auto-quality`

If the API key has a forced model limit, `/v1/models` is filtered to those virtual aliases plus the forced model.

## Useful Response Headers

Routed responses include smart-router headers:

- `x-smart-router-request-id`
- `x-smart-router-target`
- `x-smart-router-dispatch-target`
- `x-smart-router-task`
- `x-smart-router-complexity`
- `x-smart-router-confidence`
- `x-smart-router-mode`

These headers are exposed to browsers through `Access-Control-Expose-Headers`. Passthrough requests do not include routing headers.
