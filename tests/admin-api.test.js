import assert from "node:assert/strict";
import test from "node:test";
import { createAdminApi } from "../src/admin-api.js";

function response() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(payload) { this.body = JSON.parse(Buffer.from(payload).toString("utf8")); },
  };
}

function request(method, body = undefined, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

function baseContext(overrides = {}) {
  return {
    configManager: {},
    sessions: { require() {} },
    store: {},
    engine: {},
    catalog: { ready: true, models: new Set() },
    classifier: {},
    affinity: {},
    metrics: { increment() {} },
    getConfig: () => ({ server: { maxBodyBytes: 1024 }, routing: { targets: [] } }),
    corrector: null,
    logStore: { append() {} },
    ...overrides,
  };
}

test("prompt correction reset reports degraded storage", async () => {
  const metrics = [];
  const handleAdmin = createAdminApi({
    configManager: {},
    sessions: { require() {} },
    store: {
      clearPromptCorrections: () => ({ deactivated: 0, degraded: true }),
      status: () => ({ error: "storage offline" }),
    },
    engine: {},
    catalog: { ready: true, models: new Set() },
    classifier: {},
    affinity: {},
    metrics: { increment: (name, labels) => metrics.push({ name, labels }) },
    getConfig: () => ({ server: { maxBodyBytes: 1024 } }),
    corrector: null,
  });
  const res = response();

  assert.equal(await handleAdmin({ method: "DELETE", headers: {} }, res, "/api/admin/prompt-corrections", new URLSearchParams()), true);
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: "storage offline" });
  assert.deepEqual(metrics, [{ name: "smart_router_prompt_corrections_reset_total", labels: { result: "degraded" } }]);
});

test("decision review proposal endpoint returns success", async () => {
  const calls = [];
  const handleAdmin = createAdminApi(baseContext({
    sessions: { require: (req, options) => calls.push({ type: "session", options }) },
    corrector: {
      reviewDecision: async (requestId, body) => {
        calls.push({ type: "review", requestId, body });
        return {
          requestId,
          eligible: true,
          configRevision: "rev-1",
          suggestion: { verdict: "incorrect", expectedTargetKey: "planning", confidence: 0.9 },
        };
      },
    },
  }));
  const res = response();

  assert.equal(await handleAdmin(
    request("POST", { judgeModel: "smart-large", minConfidence: 0.8 }),
    res,
    "/api/admin/decisions/request%201/review",
    new URLSearchParams(),
  ), true);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    requestId: "request 1",
    eligible: true,
    configRevision: "rev-1",
    suggestion: { verdict: "incorrect", expectedTargetKey: "planning", confidence: 0.9 },
  });
  assert.deepEqual(calls, [
    { type: "session", options: { csrf: true } },
    { type: "review", requestId: "request 1", body: { judgeModel: "smart-large", minConfidence: 0.8 } },
  ]);
});

test("decision review proposal endpoint reports degraded corrector", async () => {
  const handleAdmin = createAdminApi(baseContext({ corrector: null }));
  const res = response();

  assert.equal(await handleAdmin(
    request("POST", { judgeModel: "smart-large" }),
    res,
    "/api/admin/decisions/request-1/review",
    new URLSearchParams(),
  ), true);

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: "Decision correction is unavailable" });
});

test("decision review proposal apply reports stale config", async () => {
  const handleAdmin = createAdminApi(baseContext({
    corrector: {
      applyDecisionReview: () => {
        const error = new Error("Configuration changed; rerun review before applying");
        error.status = 409;
        throw error;
      },
    },
  }));
  const res = response();

  assert.equal(await handleAdmin(
    request("POST", { expectedRevision: "old-rev", suggestion: { verdict: "incorrect" } }),
    res,
    "/api/admin/decisions/request-1/review/apply",
    new URLSearchParams(),
  ), true);

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "Configuration changed; rerun review before applying" });
});

test("decision review proposal endpoints require CSRF", async () => {
  const calls = [];
  const csrfError = new Error("Invalid CSRF token");
  csrfError.status = 403;
  const handleAdmin = createAdminApi(baseContext({
    sessions: {
      require: (req, options) => {
        calls.push(options);
        if (options.csrf) throw csrfError;
      },
    },
    corrector: {
      reviewDecision: async () => { throw new Error("should not review"); },
      applyDecisionReview: () => { throw new Error("should not apply"); },
    },
  }));

  for (const pathname of [
    "/api/admin/decisions/request-1/review",
    "/api/admin/decisions/request-1/review/apply",
  ]) {
    const res = response();
    assert.equal(await handleAdmin(request("POST", {}), res, pathname, new URLSearchParams()), true);
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: "Invalid CSRF token" });
  }

  assert.deepEqual(calls, [{ csrf: true }, { csrf: true }]);
});

test("routing config proposal endpoints call proposer and config manager", async () => {
  const calls = [];
  const handleAdmin = createAdminApi(baseContext({
    configManager: {
      update: async (patch, expectedRevision) => {
        calls.push({ type: "update", patch, expectedRevision });
        return { revision: "rev-2", config: { routing: { thresholds: { medium: 40 } } } };
      },
    },
    routingConfigProposer: {
      generate: async (body) => {
        calls.push({ type: "generate", body });
        return { configRevision: "rev-1", proposal: { changes: [] }, patch: {}, preview: [] };
      },
      preview: (samples, patch, currentConfig) => {
        calls.push({ type: "preview", samples, patch, currentConfig });
        return [{ id: "request-1", changed: true }];
      },
      validate: (patch, currentConfig) => {
        calls.push({ type: "validate", patch, currentConfig });
      },
    },
    getConfig: () => ({
      server: { maxBodyBytes: 4096 },
      routing: { targets: { small: "smart-small" }, shadowTarget: "smart-medium" },
    }),
  }));

  const proposalRes = response();
  assert.equal(await handleAdmin(
    request("POST", { samples: [{ requestId: "request-1" }] }),
    proposalRes,
    "/api/admin/routing-config/proposals",
    new URLSearchParams(),
  ), true);
  assert.equal(proposalRes.status, 200);
  assert.equal(proposalRes.body.configRevision, "rev-1");

  const previewRes = response();
  assert.equal(await handleAdmin(
    request("POST", { samples: [{ requestId: "request-1" }], patch: { routing: { thresholds: { medium: 40 } } } }),
    previewRes,
    "/api/admin/routing-config/preview",
    new URLSearchParams(),
  ), true);
  assert.deepEqual(previewRes.body, [{ id: "request-1", changed: true }]);

  const applyRes = response();
  assert.equal(await handleAdmin(
    request("POST", { expectedRevision: "rev-1", patch: { routing: { thresholds: { medium: 40 } } }, operatorConfirmed: true }),
    applyRes,
    "/api/admin/routing-config/apply",
    new URLSearchParams(),
  ), true);
  assert.equal(applyRes.status, 200);
  assert.equal(applyRes.body.applied, true);
  assert.equal(applyRes.body.config.revision, "rev-2");

  assert.deepEqual(calls.map((call) => call.type), ["generate", "preview", "validate", "update"]);
});

test("routing config apply requires operator confirmation", async () => {
  const handleAdmin = createAdminApi(baseContext({
    configManager: { update: async () => { throw new Error("should not update"); } },
    routingConfigProposer: { validate: () => { throw new Error("should not validate"); } },
  }));
  const res = response();

  assert.equal(await handleAdmin(
    request("POST", { expectedRevision: "rev-1", patch: {} }),
    res,
    "/api/admin/routing-config/apply",
    new URLSearchParams(),
  ), true);
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "operatorConfirmed must be true" });
});
