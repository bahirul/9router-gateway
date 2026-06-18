import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG, mergeDeep } from "../src/config.js";
import { packageVersion } from "../src/package-info.js";
import { createSmartRouter } from "../src/server.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function rawHttpRequest(port, request) {
  return new Promise((resolve, reject) => {
    let response = "";
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(request);
    });
    socket.setTimeout(1000);
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.on("end", () => resolve(response));
    socket.on("timeout", () => {
      socket.destroy(new Error("raw HTTP request timed out"));
    });
    socket.on("error", reject);
  });
}

test("sidecar routes virtual models, preserves explicit models, and exposes control endpoints", async (t) => {
  const upstreamRequests = [];
  const modelRequestUrls = [];
  let resolveSlowStreamClosed;
  const slowStreamClosed = new Promise((resolve) => {
    resolveSlowStreamClosed = resolve;
  });
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && new URL(req.url, "http://upstream.local").pathname === "/v1/models") {
      modelRequestUrls.push(req.url);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        object: "list",
        data: [
          "smart-small",
          "smart-medium",
          "smart-planning",
          "smart-large",
          "smart-vision",
          "explicit/model",
        ].map((id) => ({ id, object: "model", owned_by: "test" })),
      }));
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    upstreamRequests.push({ url: req.url, body });
    if (body.response_format?.type === "json_object") {
      const reviewInput = JSON.parse(body.messages[1].content);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          items: reviewInput.records.map((record) => ({
            requestId: record.requestId,
            verdict: "incorrect",
            expectedTargetKey: "planning",
            confidence: 0.92,
            rationale: "integration correction",
          })),
        }) } }],
      }));
    }
    if (body.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }], model: body.model })}\n\n`);
      if (JSON.stringify(body).includes("SLOW_STREAM")) {
        const timer = setTimeout(() => res.end("data: [DONE]\n\n"), 5000);
        res.once("close", () => {
          clearTimeout(timer);
          resolveSlowStreamClosed();
        });
        return;
      }
      res.write(`data: ${JSON.stringify({ usage: { input_tokens: 7, output_tokens: 3 } })}\n\n`);
      return res.end("data: [DONE]\n\n");
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      model: body.model,
      ok: true,
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-test-"));
  const config = mergeDeep(DEFAULT_CONFIG, {
    server: { host: "127.0.0.1", port: 0 },
    upstream: {
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      strictModelValidation: true,
      catalogRefreshMs: 60000,
    },
    classifier: { enabled: false, cacheDir: path.join(dataDir, "models") },
    logging: { directory: dataDir, rawPrompts: true },
  });
  const app = createSmartRouter({ config, logger: { error() {}, warn() {} } });
  await app.storageReady;
  await app.catalog.refresh();
  const sidecarPort = await listen(app.server);
  t.after(async () => {
    await close(app.server);
    app.stopBackgroundServices();
  });
  const baseUrl = `http://127.0.0.1:${sidecarPort}`;

  const health = await fetch(`${baseUrl}/healthz`).then((response) => response.json());
  assert.equal(health.version, packageVersion);

  const planned = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-smart-router-session-id": "integration-session",
    },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "Plan the architecture for a cache service." }],
    }),
  });
  assert.equal(planned.status, 200);
  assert.equal(planned.headers.get("x-smart-router-target"), "smart-planning");
  assert.equal((await planned.json()).model, "smart-planning");

  const explicit = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "explicit/model",
      messages: [{ role: "user", content: "Hello." }],
    }),
  });
  assert.equal((await explicit.json()).model, "explicit/model");
  assert.equal(explicit.headers.get("x-smart-router-target"), null);

  const responses = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      input: [{ role: "user", content: [{ type: "input_text", text: "Plan an API architecture." }] }],
    }),
  });
  assert.equal((await responses.json()).model, "smart-planning");

  const anthropic = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "Audit production authorization security." }],
    }),
  });
  assert.equal((await anthropic.json()).model, "smart-large");

  const streamed = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "Translate hello to French." }],
    }),
  });
  assert.equal(streamed.headers.get("content-type"), "text/event-stream");
  assert.match(await streamed.text(), /data: \[DONE\]/);

  const abortController = new AbortController();
  const slowStream = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortController.signal,
    body: JSON.stringify({
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "Translate SLOW_STREAM." }],
    }),
  });
  const reader = slowStream.body.getReader();
  await reader.read();
  abortController.abort();
  await Promise.race([
    slowStreamClosed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("upstream stream was not aborted")), 1000)),
  ]);

  const models = await fetch(`${baseUrl}/v1/models`).then((response) => response.json());
  assert.ok(models.data.some((model) => model.id === "auto" && model.owned_by === "smart-router"));

  const absoluteModels = await rawHttpRequest(sidecarPort, [
    "GET http://attacker.invalid/v1/models?foo=bar HTTP/1.1",
    `Host: 127.0.0.1:${sidecarPort}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n"));
  assert.match(absoluteModels, /^HTTP\/1\.1 200 /);
  assert.ok(modelRequestUrls.includes("/v1/models?foo=bar"));

  const absoluteChatBody = JSON.stringify({
    model: "auto",
    messages: [{ role: "user", content: "Translate hello to French." }],
  });
  const absoluteChat = await rawHttpRequest(sidecarPort, [
    "POST http://attacker.invalid/v1/chat/completions?probe=1 HTTP/1.1",
    `Host: 127.0.0.1:${sidecarPort}`,
    "Content-Type: application/json",
    `Content-Length: ${Buffer.byteLength(absoluteChatBody)}`,
    "Connection: close",
    "",
    absoluteChatBody,
  ].join("\r\n"));
  assert.match(absoluteChat, /^HTTP\/1\.1 200 /);
  const absoluteUpstreamRequest = upstreamRequests.find((request) => request.url === "/v1/chat/completions?probe=1");
  assert.ok(absoluteUpstreamRequest);
  assert.equal(absoluteUpstreamRequest.body.model, "smart-small");

  const unauthorizedMetrics = await fetch(`${baseUrl}/metrics`);
  assert.equal(unauthorizedMetrics.status, 401);
  const metrics = await fetch(`${baseUrl}/metrics`, {
    headers: { Authorization: "Bearer smart9router" },
  });
  assert.equal(metrics.status, 200);
  assert.match(await metrics.text(), /smart_router_decisions_total/);

  const explain = await fetch(`${baseUrl}/v1/router/explain`, {
    method: "POST",
    headers: {
      Authorization: "Bearer smart9router",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request: {
        model: "auto",
        messages: [{ role: "user", content: "Translate hello to French." }],
      },
    }),
  });
  assert.equal(explain.status, 200);
  assert.equal((await explain.json()).decision.target, "smart-small");

  const login = await fetch(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "smart9router" }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(Number.isFinite(session.expiresAt), true);
  assert.ok(session.expiresAt > Date.now());
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const dashboardStatus = await fetch(`${baseUrl}/api/admin/status`, {
    headers: { Cookie: cookie },
  });
  assert.equal(dashboardStatus.status, 200);
  const statusBody = await dashboardStatus.json();
  assert.equal(statusBody.version, packageVersion);
  assert.equal(statusBody.proxyBaseUrl, `${baseUrl}/v1`);

  const catalog = await fetch(`${baseUrl}/api/admin/catalog`, {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  assert.ok(catalog.models.includes("smart-planning"));

  const analytics = await fetch(`${baseUrl}/api/admin/analytics`, {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  assert.ok(analytics.tokenTotal >= 10);

  const currentConfig = await fetch(`${baseUrl}/api/admin/config`, {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  const missingCsrf = await fetch(`${baseUrl}/api/admin/config`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedRevision: currentConfig.revision,
      patch: { routing: { ambiguityMargin: 9 } },
    }),
  });
  assert.equal(missingCsrf.status, 403);

  const updatedConfig = await fetch(`${baseUrl}/api/admin/config`, {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({
      expectedRevision: currentConfig.revision,
      patch: { routing: { ambiguityMargin: 9 } },
    }),
  });
  assert.equal(updatedConfig.status, 200);
  assert.equal((await updatedConfig.json()).config.routing.ambiguityMargin, 9);

  const decisions = await fetch(`${baseUrl}/api/admin/decisions`, {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  assert.ok(decisions.items.length >= 5);
  assert.ok(decisions.items.some((item) => item.tokens?.totalTokens === 10));

  const decisionWithContext = decisions.items.find((item) => item.prompt?.includes("Translate hello"));
  assert.ok(decisionWithContext);
  const decisionDetail = await fetch(`${baseUrl}/api/admin/decisions/${encodeURIComponent(decisionWithContext.requestId)}`, {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  assert.equal(decisionDetail.request.truncated, false);
  assert.equal(decisionDetail.request.body.model, "auto");
  assert.match(decisionDetail.prompt, /Translate hello/);

  const correctionPreview = await fetch(`${baseUrl}/api/admin/decisions/corrections/preview`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ ids: [decisionWithContext.requestId], judgeModel: "smart-large" }),
  }).then((response) => response.json());
  assert.equal(correctionPreview.eligibleCount, 1);
  assert.equal(correctionPreview.items[0].suggestion.expectedTargetKey, "planning");

  const correctionApply = await fetch(`${baseUrl}/api/admin/decisions/corrections/${encodeURIComponent(correctionPreview.id)}/apply`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ expectedRevision: correctionPreview.configRevision, selectedRequestIds: [decisionWithContext.requestId] }),
  }).then((response) => response.json());
  assert.equal(correctionApply.appliedFeedback, 1);
  assert.equal(correctionApply.promptCorrections, 1);

  const corrected = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "Translate hello to French." }],
    }),
  });
  assert.equal(corrected.headers.get("x-smart-router-target"), "smart-planning");

  const createdKey = await fetch(`${baseUrl}/api/admin/api-keys`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ name: "Reset test", forcedModel: "smart-small" }),
  });
  assert.equal(createdKey.status, 200);
  assert.equal((await createdKey.json()).forcedModel, "smart-small");

  const wrongReset = await fetch(`${baseUrl}/api/admin/database`, {
    method: "DELETE",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ password: "wrong" }),
  });
  assert.equal(wrongReset.status, 401);

  const resetDatabase = await fetch(`${baseUrl}/api/admin/database`, {
    method: "DELETE",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ password: "smart9router" }),
  });
  assert.equal(resetDatabase.status, 200);
  assert.equal((await resetDatabase.json()).reset, true);

  const resetConfig = await fetch(`${baseUrl}/api/admin/config`, {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  assert.equal(resetConfig.config.routing.ambiguityMargin, 8);
  assert.ok(resetConfig.config.routing.taskClasses.general);

  const resetDecisions = await fetch(`${baseUrl}/api/admin/decisions`, {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  assert.equal(resetDecisions.items.length, 0);

  const resetKeys = await fetch(`${baseUrl}/api/admin/api-keys`, {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  assert.equal(resetKeys.items.length, 0);

  const relogin = await fetch(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "smart9router" }),
  });
  assert.equal(relogin.status, 200);

  assert.equal(upstreamRequests.length, 9);
  assert.ok(upstreamRequests.some((request) => request.body.response_format?.type === "json_object"));
});

test("api keys gate routed requests when enabled", async (t) => {
  const upstreamBodies = [];
  const upstreamHeaders = [];
  const upstream = http.createServer((req, res) => {
    upstreamHeaders.push(req.headers);
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "GET") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        upstreamBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.end(JSON.stringify({ model: upstreamBodies.at(-1).model, ok: true }));
      });
      return;
    }
    res.end(JSON.stringify({ object: "list", data: [{ id: "model-a", object: "model" }] }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-api-key-"));
  const config = mergeDeep(DEFAULT_CONFIG, {
    server: { host: "127.0.0.1", port: 0 },
    upstream: {
      apiKey: "upstream-secret",
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      strictModelValidation: false,
    },
    classifier: { enabled: false, cacheDir: path.join(dataDir, "models") },
    logging: { directory: dataDir },
    security: { apiKeyAuthEnabled: true },
  });
  const app = createSmartRouter({ config, logger: { error() {}, warn() {} } });
  await app.storageReady;
  const created = app.decisionStore.createApiKey({ name: "client-key" });
  const limited = app.decisionStore.createApiKey({ name: "limited-key", quotaPeriod: "day", quotaLimit: 1 });
  const forced = app.decisionStore.createApiKey({ name: "friend-key", forcedModel: "model-a" });
  const sidecarPort = await listen(app.server);
  t.after(async () => {
    await close(app.server);
    app.stopBackgroundServices();
  });
  const baseUrl = `http://127.0.0.1:${sidecarPort}`;

  const denied = await fetch(`${baseUrl}/v1/models`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${baseUrl}/v1/models`, {
    headers: { "x-api-key": created.secret },
  });
  assert.equal(allowed.status, 200);
  const models = (await allowed.json()).data.map((model) => model.id);
  assert.ok(models.includes("model-a"));
  assert.ok(models.includes("auto"));
  assert.equal(upstreamHeaders.at(-1).authorization, "Bearer upstream-secret");
  assert.equal(upstreamHeaders.at(-1)["x-api-key"], undefined);
  assert.equal(app.decisionStore.getApiKey(created.id).quotaUsed, 0);
  assert.equal(
    app.decisionStore.db.prepare(`SELECT COUNT(*) AS total FROM apiKeyUsage`).get().total,
    0,
  );

  const forcedModels = await fetch(`${baseUrl}/v1/models`, {
    headers: { "x-api-key": forced.secret },
  });
  assert.equal(forcedModels.status, 200);
  assert.deepEqual((await forcedModels.json()).data.map((model) => model.id).sort(), ["auto", "auto-fast", "auto-quality", "model-a"].sort());

  const forcedExplicit = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "x-api-key": forced.secret, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "explicit/model", messages: [{ role: "user", content: "hello" }] }),
  });
  assert.equal(forcedExplicit.status, 200);
  assert.equal(upstreamHeaders.at(-1).authorization, "Bearer upstream-secret");
  assert.equal(upstreamHeaders.at(-1)["x-api-key"], undefined);
  assert.equal(upstreamBodies.at(-1).model, "model-a");
  assert.equal(app.decisionStore.list().items.length, 0);

  const bearerResponses = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${created.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "auto", input: "Plan a migration" }),
  });
  assert.equal(bearerResponses.status, 200);
  assert.equal(upstreamHeaders.at(-1).authorization, "Bearer upstream-secret");
  assert.equal(upstreamHeaders.at(-1)["x-api-key"], undefined);
  assert.notEqual(upstreamHeaders.at(-1).authorization, `Bearer ${created.secret}`);

  const forcedAuto = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "x-api-key": forced.secret, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "Plan a migration" }] }),
  });
  assert.equal(forcedAuto.status, 200);
  assert.equal(forcedAuto.headers.get("x-smart-router-dispatch-target"), "model-a");
  assert.equal(upstreamBodies.at(-1).model, "model-a");
  const forcedDecision = app.decisionStore.list().items[0];
  assert.equal(forcedDecision.mode, "key_shadow");
  assert.equal(forcedDecision.requestedModel, "auto");

  const malformed = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "x-api-key": limited.secret },
    body: "not-json",
  });
  assert.equal(malformed.status, 400);
  assert.equal(app.decisionStore.getApiKey(limited.id).quotaUsed, 0);

  const limitedFirst = await fetch(`${baseUrl}/v1/models`, {
    headers: { "x-api-key": limited.secret },
  });
  assert.equal(limitedFirst.status, 200);

  const limitedSecond = await fetch(`${baseUrl}/v1/models`, {
    headers: { "x-api-key": limited.secret },
  });
  assert.equal(limitedSecond.status, 429);
  assert.equal((await limitedSecond.json()).error, "api key quota exceeded");
});

test("client api keys are not forwarded when upstream api key is empty", async (t) => {
  const upstreamHeaders = [];
  const upstream = http.createServer((req, res) => {
    upstreamHeaders.push(req.headers);
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ model: body.model, ok: true }));
    });
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-no-upstream-key-"));
  const config = mergeDeep(DEFAULT_CONFIG, {
    server: { host: "127.0.0.1", port: 0 },
    upstream: {
      apiKey: "",
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      strictModelValidation: false,
    },
    classifier: { enabled: false, cacheDir: path.join(dataDir, "models") },
    logging: { directory: dataDir },
    security: { apiKeyAuthEnabled: true },
  });
  const app = createSmartRouter({ config, logger: { error() {}, warn() {} } });
  await app.storageReady;
  const created = app.decisionStore.createApiKey({ name: "client-key" });
  const sidecarPort = await listen(app.server);
  t.after(async () => {
    await close(app.server);
    app.stopBackgroundServices();
  });

  const response = await fetch(`http://127.0.0.1:${sidecarPort}/v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${created.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "auto", input: "Plan a migration" }),
  });

  assert.equal(response.status, 200);
  assert.equal(upstreamHeaders.at(-1).authorization, undefined);
  assert.equal(upstreamHeaders.at(-1)["x-api-key"], undefined);
});
