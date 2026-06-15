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
  assert.deepEqual(item.reasons, ["planning"]);
  assert.equal(item.prompt, "Plan a migration");
  assert.equal(item.request.body.api_key, "[REDACTED]");
  assert.equal(item.request.truncated, false);

  store.clearFeedback("request-1");
  assert.equal(store.get("request-1").feedback, null);

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
  assert.equal(store.listApiKeys()[0].secret, created.secret);
  assert.equal(store.verifyApiKey(created.secret), true);
  assert.equal(store.verifyApiKey("wrong"), false);

  const disabled = store.setApiKeyActive(created.id, false);
  assert.equal(disabled.status, "inactive");
  assert.equal(store.verifyApiKey(created.secret), false);

  const enabled = store.setApiKeyActive(created.id, true);
  assert.equal(enabled.status, "active");
  assert.equal(store.verifyApiKey(created.secret), true);

  const expired = store.createApiKey({ name: "Expired", expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(expired.name, "Expired");
  assert.equal(store.verifyApiKey(expired.secret), false);

  assert.equal(store.deleteApiKey(created.id), true);
  assert.equal(store.getApiKey(created.id), null);
  assert.equal(store.verifyApiKey(created.secret), false);
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
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.close();

  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());
  const columns = store.db.prepare(`PRAGMA table_info(decisions)`).all().map((column) => column.name);
  assert.ok(columns.includes("requestJson"));
  const apiKeyColumns = store.db.prepare(`PRAGMA table_info(apiKeys)`).all().map((column) => column.name);
  assert.ok(apiKeyColumns.includes("displayPrefix"));
  assert.ok(apiKeyColumns.includes("secret"));
  assert.ok(apiKeyColumns.includes("active"));
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
