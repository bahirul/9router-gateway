import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DecisionStore } from "../src/decision-store.js";
import { requestSnapshot } from "../src/log-store.js";

test("persists decisions, outcomes, feedback, filters, and analytics", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-store-"));
  const store = new DecisionStore({
    directory,
    retentionDays: 30,
    logger: { warn() {} },
  });
  await store.init();
  t.after(() => store.close());
  assert.equal(store.status().ready, true);

  store.decision({
    requestId: "request-1",
    timestamp: new Date().toISOString(),
    sessionHash: "session",
    promptHash: "prompt",
    requestedModel: "auto",
    target: "smart-planning",
    targetKey: "planning",
    task: "planning",
    complexity: "medium",
    score: 55,
    confidence: 0.9,
    mode: "active",
    classifierUsed: false,
    affinityHeld: false,
    messageCount: 1,
    toolCount: 0,
    estimatedTokens: 20,
    client: "test",
    clientIp: "203.0.113.10",
    userAgent: "store-test-agent",
    prompt: "Plan a migration",
    request: requestSnapshot({
      model: "auto",
      api_key: "secret-value",
      messages: [{ role: "user", content: "Plan a migration" }],
    }),
    reasons: ["planning"],
    features: { ruleScore: 55 },
  });
  store.outcome({
    requestId: "request-1",
    status: 200,
    latencyMs: 42,
    error: null,
    tokens: { totalTokens: 25 },
  });
  store.feedback({
    requestId: "request-1",
    rating: 5,
    expectedTarget: "smart-planning",
    note: "correct",
  });

  const item = store.get("request-1");
  assert.equal(item.status, 200);
  assert.equal(item.feedback.rating, 5);
  assert.equal(item.clientIp, "203.0.113.10");
  assert.equal(item.userAgent, "store-test-agent");
  assert.equal(item.reviewed, true);
  assert.deepEqual(item.reasons, ["planning"]);
  assert.equal(item.prompt, "Plan a migration");
  assert.equal(item.request.body.api_key, "[REDACTED]");
  assert.equal(item.request.truncated, false);

  store.clearFeedback("request-1");
  assert.equal(store.get("request-1").feedback, null);
  assert.equal(store.get("request-1").reviewed, false);

  store.feedback({
    requestId: "request-1",
    rating: 4,
    expectedTarget: null,
    note: null,
  });
  store.clearDecisions();
  assert.equal(store.get("request-1"), null);

  const filtered = store.list({ target: "planning", status: 200 });
  assert.equal(filtered.items.length, 0);
  assert.equal(store.list({ target: "large" }).items.length, 0);

  const analytics = store.analytics();
  assert.equal(analytics.total, 0);
  assert.equal(analytics.successRate, 0);
  assert.equal(analytics.p95LatencyMs, 0);
  assert.equal(analytics.tokenTotal, 0);
});

test("manages api keys, expirations, and verification", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-keys-"));
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());

  const created = store.createApiKey({ name: "CLI", expiresAt: null });
  assert.equal(created.name, "CLI");
  assert.match(created.secret, /^sk-/);
  assert.match(created.displayPrefix, /^sk-/);
  assert.equal(created.quotaPeriod, null);
  assert.equal(created.quotaLimit, null);
  assert.equal(created.forcedModel, null);
  assert.equal(created.quotaUsed, 0);
  assert.equal(store.listApiKeys()[0].secret, created.secret);
  assert.equal(store.verifyApiKey(created.secret), true);
  assert.equal(store.verifyApiKey("wrong"), false);
  store.db.prepare(`UPDATE apiKeys SET secretLookup=NULL WHERE id=?`).run(created.id);
  assert.equal(store.verifyApiKey(created.secret), true);
  assert.equal(typeof store.db.prepare(`SELECT secretLookup FROM apiKeys WHERE id=?`).get(created.id).secretLookup, "string");

  const disabled = store.setApiKeyActive(created.id, false);
  assert.equal(disabled.status, "inactive");
  assert.equal(store.verifyApiKey(created.secret), false);

  const enabled = store.setApiKeyActive(created.id, true);
  assert.equal(enabled.status, "active");
  assert.equal(store.verifyApiKey(created.secret), true);

  const forced = store.setApiKeyForcedModel(created.id, "model-a");
  assert.equal(forced.forcedModel, "model-a");
  assert.equal(store.authorizeApiKey(created.secret).key.forcedModel, "model-a");

  const expired = store.createApiKey({ name: "Expired", expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(expired.name, "Expired");
  assert.equal(store.verifyApiKey(expired.secret), false);

  assert.equal(store.deleteApiKey(created.id), true);
  assert.equal(store.getApiKey(created.id), null);
  assert.equal(store.verifyApiKey(created.secret), false);
});

test("persists direct decision review feedback and learned routing", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-corrections-"));
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());

  store.decision({
    requestId: "correction-request",
    timestamp: new Date().toISOString(),
    sessionHash: "session",
    promptHash: "prompt-correction-hash",
    requestedModel: "auto",
    target: "smart-medium",
    targetKey: "medium",
    task: "coding",
    complexity: "medium",
    score: 55,
    confidence: 0.7,
    mode: "active",
    classifierUsed: false,
    affinityHeld: false,
    messageCount: 1,
    toolCount: 0,
    estimatedTokens: 20,
    client: "test",
    prompt: "Plan a rollout",
    request: requestSnapshot({ model: "auto", messages: [{ role: "user", content: "Plan a rollout" }] }),
    reasons: ["coding"],
    features: { ruleScore: 55 },
  });

  const applied = store.applyDecisionReview("correction-request", {
    verdict: "incorrect",
    expectedTargetKey: "planning",
    expectedTarget: "smart-planning",
    confidence: 0.9,
    rationale: "planning prompt",
  }, { minConfidence: 0.7 });
  assert.equal(applied.appliedFeedback, true);
  assert.equal(applied.promptCorrection, false);
  assert.equal(store.get("correction-request").feedback.expectedTarget, null);
  assert.equal(store.getPromptCorrection("prompt-correction-hash"), null);

  const trained = store.applyDecisionReview("correction-request", {
    verdict: "incorrect",
    expectedTargetKey: "planning",
    expectedTarget: "smart-planning",
    confidence: 0.9,
    rationale: "planning prompt",
  }, { minConfidence: 0.7, trainLearning: true });
  assert.equal(trained.appliedFeedback, true);
  assert.equal(trained.promptCorrection, true);
  assert.equal(store.get("correction-request").feedback.expectedTarget, "smart-planning");
  assert.equal(store.getPromptCorrection("prompt-correction-hash").expectedTargetKey, "planning");
});

test("creates manual routing corrections from feedback only when requested", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-manual-corrections-"));
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());

  store.decision({
    requestId: "manual-correction-request",
    timestamp: new Date().toISOString(),
    sessionHash: "session",
    promptHash: "manual-correction-hash",
    requestedModel: "auto",
    target: "smart-medium",
    targetKey: "medium",
    task: "coding",
    complexity: "medium",
    score: 55,
    confidence: 0.7,
    mode: "active",
    classifierUsed: false,
    affinityHeld: false,
    messageCount: 1,
    toolCount: 0,
    estimatedTokens: 20,
    client: "test",
    prompt: "Plan a rollout",
    request: requestSnapshot({ model: "auto", messages: [{ role: "user", content: "Plan a rollout" }] }),
    reasons: ["coding"],
    features: { ruleScore: 55 },
  });

  const targets = { small: "smart-small", medium: "smart-medium", planning: "smart-planning" };
  const feedbackOnly = store.feedbackWithCorrection({
    requestId: "manual-correction-request",
    rating: 2,
    expectedTarget: "smart-planning",
    note: "needs planning",
  }, { targets });
  assert.equal(feedbackOnly.promptCorrection, false);
  assert.equal(store.getPromptCorrection("manual-correction-hash"), null);

  const corrected = store.feedbackWithCorrection({
    requestId: "manual-correction-request",
    rating: 2,
    expectedTarget: "smart-planning",
    note: "needs planning",
  }, { createPromptCorrection: true, targets });
  assert.equal(corrected.promptCorrection, true);
  assert.equal(store.getPromptCorrection("manual-correction-hash").expectedTargetKey, "planning");
  assert.equal(store.getPromptCorrection("manual-correction-hash").correctionRunId, "manual_feedback");
  assert.equal(store.get("manual-correction-request").reviewed, true);
  assert.equal(store.get("manual-correction-request").promptCorrection.expectedTargetKey, "planning");
  assert.equal(store.list().items.find((item) => item.requestId === "manual-correction-request").reviewed, true);

  const reset = store.clearPromptCorrections();
  assert.equal(reset.deactivated, 1);
  assert.equal(store.getPromptCorrection("manual-correction-hash"), null);
  assert.equal(store.get("manual-correction-request").feedback.expectedTarget, "smart-planning");
  assert.equal(store.get("manual-correction-request").reviewed, true);

  store.clearFeedback("manual-correction-request");
  assert.equal(store.get("manual-correction-request").feedback, null);
  assert.equal(store.getPromptCorrection("manual-correction-hash"), null);
  assert.equal(store.get("manual-correction-request").reviewed, false);
});

test("clears stored prompt context only for reviewed decisions", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-clear-reviewed-context-"));
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());

  for (const requestId of ["reviewed-request", "unreviewed-request"]) {
    store.decision({
      requestId,
      timestamp: new Date().toISOString(),
      sessionHash: "session",
      promptHash: `${requestId}-hash`,
      requestedModel: "auto",
      target: "smart-medium",
      targetKey: "medium",
      task: "coding",
      complexity: "medium",
      score: 55,
      confidence: 0.7,
      mode: "active",
      classifierUsed: false,
      affinityHeld: false,
      messageCount: 1,
      toolCount: 0,
      estimatedTokens: 20,
      client: "test",
      prompt: `Prompt for ${requestId}`,
      request: requestSnapshot({ model: "auto", messages: [{ role: "user", content: `Prompt for ${requestId}` }] }),
      reasons: ["coding"],
      features: { ruleScore: 55 },
    });
  }

  const targets = { small: "smart-small", medium: "smart-medium", planning: "smart-planning" };
  store.feedbackWithCorrection({
    requestId: "reviewed-request",
    rating: 2,
    expectedTarget: "smart-planning",
    note: "needs planning",
  }, { createPromptCorrection: true, targets });

  const reset = store.clearPromptCorrections();
  assert.equal(reset.deactivated, 1);
  assert.equal(reset.cleared, 1);
  assert.equal(store.getPromptCorrection("reviewed-request-hash"), null);
  assert.equal(store.get("reviewed-request").prompt, null);
  assert.equal(store.get("reviewed-request").request, null);
  assert.equal(store.get("reviewed-request").feedback.expectedTarget, "smart-planning");
  assert.equal(store.get("unreviewed-request").prompt, "Prompt for unreviewed-request");
  assert.equal(store.get("unreviewed-request").request.truncated, false);
});

test("clears stored prompt context for all decisions", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-clear-all-context-"));
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());

  for (const requestId of ["first-request", "second-request"]) {
    store.decision({
      requestId,
      timestamp: new Date().toISOString(),
      sessionHash: "session",
      promptHash: `${requestId}-hash`,
      requestedModel: "auto",
      target: "smart-medium",
      targetKey: "medium",
      task: "coding",
      complexity: "medium",
      score: 55,
      confidence: 0.7,
      mode: "active",
      classifierUsed: false,
      affinityHeld: false,
      messageCount: 1,
      toolCount: 0,
      estimatedTokens: 20,
      client: "test",
      prompt: `Prompt for ${requestId}`,
      request: requestSnapshot({ model: "auto", messages: [{ role: "user", content: `Prompt for ${requestId}` }] }),
      reasons: ["coding"],
      features: { ruleScore: 55 },
    });
  }

  const reset = store.clearAllPromptData();
  assert.equal(reset.cleared, 2);
  assert.equal(store.get("first-request").prompt, null);
  assert.equal(store.get("first-request").request, null);
  assert.equal(store.get("second-request").prompt, null);
  assert.equal(store.get("second-request").request, null);
  assert.equal(store.list().items.length, 2);
});

test("validates manual routing correction inputs", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-manual-correction-validation-"));
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());

  store.decision({
    requestId: "missing-context-request",
    timestamp: new Date().toISOString(),
    sessionHash: "session",
    promptHash: null,
    requestedModel: "auto",
    target: "smart-medium",
    targetKey: "medium",
    task: "general",
    complexity: "low",
    score: 10,
    confidence: 0.5,
    mode: "active",
    classifierUsed: false,
    affinityHeld: false,
    messageCount: 1,
    toolCount: 0,
    estimatedTokens: 10,
    client: "test",
    reasons: [],
    features: {},
  });

  assert.throws(() => store.feedbackWithCorrection({
    requestId: "missing-context-request",
    rating: 2,
    expectedTarget: "smart-planning",
  }, { createPromptCorrection: true, targets: { planning: "smart-planning" } }), /stored prompt context/);

  store.decision({
    requestId: "invalid-target-request",
    timestamp: new Date().toISOString(),
    sessionHash: "session",
    promptHash: "invalid-target-hash",
    requestedModel: "auto",
    target: "smart-medium",
    targetKey: "medium",
    task: "general",
    complexity: "low",
    score: 10,
    confidence: 0.5,
    mode: "active",
    classifierUsed: false,
    affinityHeld: false,
    messageCount: 1,
    toolCount: 0,
    estimatedTokens: 10,
    client: "test",
    reasons: [],
    features: {},
  });
  assert.throws(() => store.feedbackWithCorrection({
    requestId: "invalid-target-request",
    rating: 2,
    expectedTarget: "smart-unknown",
  }, { createPromptCorrection: true, targets: { planning: "smart-planning" } }), /configured routing target/);
});

test("enforces api key request quotas", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-key-quotas-"));
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());

  const daily = store.createApiKey({ name: "Daily", quotaPeriod: "day", quotaLimit: 2 });
  assert.equal(store.authorizeApiKey(daily.secret, { consume: true }).ok, true);
  assert.equal(store.authorizeApiKey(daily.secret, { consume: true }).ok, true);
  const exhausted = store.authorizeApiKey(daily.secret, { consume: true });
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.reason, "quota_exceeded");
  assert.equal(store.getApiKey(daily.id).status, "limited");
  assert.equal(store.getApiKey(daily.id).quotaRemaining, 0);

  const monthly = store.createApiKey({ name: "Monthly", quotaPeriod: "month", quotaLimit: 1 });
  assert.equal(store.authorizeApiKey(monthly.secret, { consume: true }).ok, true);
  assert.equal(store.getApiKey(monthly.id).quotaPeriodKey.length, 7);

  const unlimited = store.createApiKey({ name: "Unlimited" });
  assert.equal(store.authorizeApiKey(unlimited.secret, { consume: true }).ok, true);
  assert.equal(store.authorizeApiKey(unlimited.secret, { consume: true }).ok, true);
  assert.equal(store.getApiKey(unlimited.id).quotaUsed, 0);

  store.setApiKeyActive(daily.id, false);
  assert.equal(store.authorizeApiKey(daily.secret, { consume: true }).reason, "inactive");

  assert.equal(store.deleteApiKey(monthly.id), true);
  const usageRows = store.db.prepare(`SELECT * FROM apiKeyUsage WHERE apiKeyId=?`).all(monthly.id);
  assert.equal(usageRows.length, 0);
});

test("resets sqlite data while preserving admin password and import marker", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-reset-"));
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());

  store.setAdminPassword("custom-password");
  store.setRuntimeConfig({ routing: { ambiguityMargin: 9 } });
  const key = store.createApiKey({ name: "Limited", quotaPeriod: "day", quotaLimit: 1 });
  assert.equal(store.authorizeApiKey(key.secret, { consume: true }).ok, true);
  store.decision({
    requestId: "reset-request",
    timestamp: new Date().toISOString(),
    targetKey: "small",
    task: "general",
    complexity: "low",
    mode: "active",
    reasons: [],
    features: {},
  });
  store.feedback({ requestId: "reset-request", rating: 1 });
  store.db.prepare(`INSERT OR REPLACE INTO meta(key,value) VALUES('jsonlImported','existing-marker')`).run();

  assert.equal(store.resetDatabase(), true);
  assert.equal(store.verifyAdminPassword("custom-password"), true);
  assert.equal(store.getRuntimeConfig(), null);
  assert.equal(store.listApiKeys().length, 0);
  assert.equal(store.list().items.length, 0);
  assert.equal(store.db.prepare(`SELECT count(*) AS count FROM apiKeyUsage`).get().count, 0);
  assert.equal(store.db.prepare(`SELECT value FROM meta WHERE key='jsonlImported'`).get().value, "existing-marker");
});

test("migrates existing stores to add request context", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-store-migrate-"));
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(directory, "router.sqlite"));
  db.exec(`
    CREATE TABLE decisions (
      requestId TEXT PRIMARY KEY,timestamp TEXT NOT NULL,sessionHash TEXT,promptHash TEXT,
      requestedModel TEXT,target TEXT,targetKey TEXT,task TEXT,complexity TEXT,score INTEGER,
      confidence REAL,mode TEXT,classifierUsed INTEGER,affinityHeld INTEGER,messageCount INTEGER,
      toolCount INTEGER,estimatedTokens INTEGER,client TEXT,prompt TEXT,reasons TEXT,features TEXT,
      status INTEGER,latencyMs INTEGER,error TEXT,tokens TEXT
    );
    CREATE TABLE feedback (requestId TEXT PRIMARY KEY,rating INTEGER NOT NULL,expectedTarget TEXT,note TEXT,updatedAt TEXT NOT NULL);
    CREATE TABLE apiKeys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      secretHash TEXT NOT NULL,
      secret TEXT,
      displayPrefix TEXT,
      expiresAt TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      revokedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.close();

  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());
  const columns = store.db.prepare(`PRAGMA table_info(decisions)`).all().map((column) => column.name);
  assert.ok(columns.includes("requestJson"));
  assert.ok(columns.includes("clientIp"));
  assert.ok(columns.includes("userAgent"));
  const apiKeyColumns = store.db.prepare(`PRAGMA table_info(apiKeys)`).all().map((column) => column.name);
  assert.ok(apiKeyColumns.includes("displayPrefix"));
  assert.ok(apiKeyColumns.includes("secret"));
  assert.ok(apiKeyColumns.includes("active"));
  assert.ok(apiKeyColumns.includes("secretLookup"));
  assert.ok(apiKeyColumns.includes("quotaPeriod"));
  assert.ok(apiKeyColumns.includes("quotaLimit"));
  assert.ok(apiKeyColumns.includes("forcedModel"));
  const indexes = store.db.prepare(`PRAGMA index_list(apiKeys)`).all().map((index) => index.name);
  assert.ok(indexes.includes("idx_api_keys_secret_lookup"));
});

test("request snapshots redact sensitive fields and cap large bodies", () => {
  const snapshot = requestSnapshot({ token: "abc", nested: { password: "pw" } });
  assert.equal(snapshot.body.token, "[REDACTED]");
  assert.equal(snapshot.body.nested.password, "[REDACTED]");

  const large = requestSnapshot({ content: "x".repeat(70 * 1024) });
  assert.equal(large.truncated, true);
  assert.equal(typeof large.body, "string");
});

test("returns dashboard-safe empty analytics while storage is degraded", () => {
  const store = new DecisionStore({ directory: "/unused" });
  assert.deepEqual(store.analytics().byTarget, {});
  assert.equal(store.analytics().total, 0);
  assert.equal(store.analytics().degraded, true);
});
