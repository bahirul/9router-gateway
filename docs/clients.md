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

The gateway also proxies `/v1/responses`, `/v1/models`, and other 9Router-compatible paths.

## Codex CLI

Minimal `~/.codex/config.toml` provider:

```toml
model = "auto"
model_provider = "smartrouter"

[model_providers.smartrouter]
name = "smartrouter"
base_url = "http://127.0.0.1:20129/v1"
wire_api = "responses"
env_key = "SMART_ROUTER_API_KEY"
```

Then set the client-side key when API-key enforcement is enabled:

```bash
export SMART_ROUTER_API_KEY='sk-...'
```

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
