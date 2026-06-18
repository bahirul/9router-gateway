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

Client keys authenticate callers to this gateway only. If the upstream 9Router URL requires authentication, set `NINEROUTER_API_KEY` in the gateway process; client `Authorization` and `x-api-key` values are not forwarded upstream.

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
