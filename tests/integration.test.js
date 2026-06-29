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
      const reviewInput = JSON.parse(body.messages[1].content.match(/\{[\s\S]*\}/)[0]);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          verdict: "incorrect",
          expectedTargetKey: "planning",
          confidence: 0.92,
          rationale: `integration correction for ${reviewInput.record.requestId}`,
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
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "integration-agent/1.0",
      "CF-Connecting-IP": "203.0.113.77",
      "X-Forwarded-For": "198.51.100.42, 10.0.0.8",
    },
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
  assert.ok(analytics.totalLatencyMs >= 0);

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

  const manualFeedbackDecision = decisions.items.find((item) => item.prompt?.includes("Audit production authorization security"));
  assert.ok(manualFeedbackDecision);
  assert.equal(manualFeedbackDecision.clientIp, "203.0.113.77");
  assert.equal(manualFeedbackDecision.userAgent, "integration-agent/1.0");
  assert.equal(manualFeedbackDecision.reviewed, false);
  const manualFeedbackDetail = await fetch(`${baseUrl}/api/admin/decisions/${encodeURIComponent(manualFeedbackDecision.requestId)}`, {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  assert.equal(manualFeedbackDetail.clientIp, "203.0.113.77");
  assert.equal(manualFeedbackDetail.userAgent, "integration-agent/1.0");
  const feedbackOnly = await fetch(`${baseUrl}/api/admin/decisions/${encodeURIComponent(manualFeedbackDecision.requestId)}/feedback`, {
    method: "PUT",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ rating: 2, expectedTarget: "smart-small", note: "too expensive" }),
  }).then((response) => response.json());
  assert.equal(feedbackOnly.feedback.expectedTarget, "smart-small");
  assert.equal(feedbackOnly.reviewed, true);

  const learnedByFeedback = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "Audit production authorization security." }],
    }),
  });
  assert.equal((await learnedByFeedback.json()).model, "smart-small");

  const feedbackCorrection = await fetch(`${baseUrl}/api/admin/decisions/${encodeURIComponent(manualFeedbackDecision.requestId)}/feedback`, {
    method: "PUT",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ rating: 2, expectedTarget: "smart-small", note: "too expensive", createPromptCorrection: true }),
  }).then((response) => response.json());
  assert.equal(feedbackCorrection.feedback.expectedTarget, "smart-small");

  const manuallyCorrected = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "Audit production authorization security." }],
    }),
  });
  assert.equal((await manuallyCorrected.json()).model, "smart-small");

  const resetManualFeedback = await fetch(`${baseUrl}/api/admin/decisions/${encodeURIComponent(manualFeedbackDecision.requestId)}/feedback`, {
    method: "DELETE",
    headers: {
      Cookie: cookie,
      "x-csrf-token": session.csrfToken,
    },
  });
  assert.equal(resetManualFeedback.status, 200);
  assert.equal((await resetManualFeedback.json()).feedback, null);

  const correctedAfterReset = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "Audit production authorization security." }],
    }),
  });
  assert.equal((await correctedAfterReset.json()).model, "smart-large");

  const oldBatchPreview = await fetch(`${baseUrl}/api/admin/decisions/corrections/preview`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ ids: [decisionWithContext.requestId], judgeModel: "smart-large" }),
  });
  assert.equal(oldBatchPreview.status, 404);

  const decisionReview = await fetch(`${baseUrl}/api/admin/decisions/${encodeURIComponent(decisionWithContext.requestId)}/review`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ judgeModel: "smart-large" }),
  }).then((response) => response.json());
  assert.equal(decisionReview.eligible, true);
  assert.equal(decisionReview.suggestion.expectedTargetKey, "planning");

  const correctionApply = await fetch(`${baseUrl}/api/admin/decisions/${encodeURIComponent(decisionWithContext.requestId)}/review/apply`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ expectedRevision: decisionReview.configRevision, suggestion: decisionReview.suggestion }),
  }).then((response) => response.json());
  assert.equal(correctionApply.appliedFeedback, true);
  assert.equal(correctionApply.promptCorrection, false);

  const untrained = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "Translate hello to French." }],
    }),
  });
  assert.equal(untrained.headers.get("x-smart-router-target"), "smart-small");

  const trainedCorrectionApply = await fetch(`${baseUrl}/api/admin/decisions/${encodeURIComponent(decisionWithContext.requestId)}/review/apply`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ expectedRevision: decisionReview.configRevision, suggestion: decisionReview.suggestion, trainLearning: true }),
  }).then((response) => response.json());
  assert.equal(trainedCorrectionApply.appliedFeedback, true);
  assert.equal(trainedCorrectionApply.promptCorrection, true);

  const corrected = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "Translate hello to French." }],
    }),
  });
  assert.equal(corrected.headers.get("x-smart-router-target"), "smart-planning");

  const missingPromptCorrectionCsrf = await fetch(`${baseUrl}/api/admin/prompt-corrections`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  assert.equal(missingPromptCorrectionCsrf.status, 403);

  const resetPromptCorrections = await fetch(`${baseUrl}/api/admin/prompt-corrections`, {
    method: "DELETE",
    headers: {
      Cookie: cookie,
      "x-csrf-token": session.csrfToken,
    },
  }).then((response) => response.json());
  assert.equal(resetPromptCorrections.reset, true);
  assert.equal(resetPromptCorrections.deactivated, 1);
  assert.equal(resetPromptCorrections.cleared, 2);

  const correctedAfterGlobalReset = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "Translate hello to French." }],
    }),
  });
  assert.equal(correctedAfterGlobalReset.headers.get("x-smart-router-target"), "smart-small");
  assert.equal(correctedAfterGlobalReset.headers.get("x-smart-router-mode"), "active");

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

  assert.equal(upstreamRequests.length, 14);
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

test("model identity override injects instructions for routed request formats", async (t) => {
  const upstreamBodies = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      upstreamBodies.push({ url: req.url, body });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ model: body.model, ok: true }));
    });
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-identity-"));
  const config = mergeDeep(DEFAULT_CONFIG, {
    server: { host: "127.0.0.1", port: 0 },
    upstream: {
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      strictModelValidation: false,
    },
    classifier: { enabled: false, cacheDir: path.join(dataDir, "models") },
    identity: { enabled: true, modelName: "Codex Router" },
    logging: { directory: dataDir, rawPrompts: true },
  });
  const app = createSmartRouter({ config, logger: { error() {}, warn() {} } });
  await app.storageReady;
  const sidecarPort = await listen(app.server);
  t.after(async () => {
    await close(app.server);
    app.stopBackgroundServices();
  });
  const baseUrl = `http://127.0.0.1:${sidecarPort}`;

  const chat = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Who are you?" },
      ],
    }),
  });
  assert.equal(chat.status, 200);
  assert.equal(upstreamBodies.at(-1).body.messages[0].role, "system");
  assert.match(upstreamBodies.at(-1).body.messages[0].content, /Codex Router/);
  assert.equal(upstreamBodies.at(-1).body.messages[1].content, "Be concise.");

  const responses = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      instructions: "Keep answers short.",
      input: "What model are you?",
    }),
  });
  assert.equal(responses.status, 200);
  assert.match(upstreamBodies.at(-1).body.instructions, /^If the user asks.*Codex Router/s);
  assert.match(upstreamBodies.at(-1).body.instructions, /Keep answers short\.$/);

  const anthropic = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      max_tokens: 128,
      system: [{ type: "text", text: "Prefer bullets." }],
      messages: [{ role: "user", content: [{ type: "text", text: "What assistant are you?" }] }],
    }),
  });
  assert.equal(anthropic.status, 200);
  assert.equal(upstreamBodies.at(-1).body.system[0].type, "text");
  assert.match(upstreamBodies.at(-1).body.system[0].text, /Codex Router/);
  assert.equal(upstreamBodies.at(-1).body.system[1].text, "Prefer bullets.");
  const storedChat = app.decisionStore.list().items.find((item) => item.request?.body?.messages?.[0]?.content === "Be concise.");
  assert.ok(storedChat);
});
