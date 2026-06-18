import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AffinityStore } from "../src/affinity.js";
import { DEFAULT_CONFIG, mergeDeep } from "../src/config.js";
import { DecisionCorrector } from "../src/decision-corrector.js";
import { DecisionStore } from "../src/decision-store.js";
import { requestSnapshot } from "../src/log-store.js";
import { Metrics } from "../src/metrics.js";
import { normalizeRequest } from "../src/request-normalizer.js";
import { RouterEngine } from "../src/router-engine.js";

async function createStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-corrector-"));
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());
  return store;
}

function seedDecision(store, { requestId = "request-1", prompt = "Plan a zero downtime rollout", targetKey = "medium", target = "smart-medium", context = true } = {}) {
  const body = { model: "auto", messages: [{ role: "user", content: prompt }] };
  const normalized = normalizeRequest("/v1/chat/completions", body);
  store.decision({
    requestId,
    timestamp: new Date().toISOString(),
    sessionHash: "session",
    promptHash: normalized.promptHash,
    requestedModel: "auto",
    target,
    targetKey,
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
    prompt: context ? prompt : null,
    request: context ? requestSnapshot(body) : null,
    reasons: ["coding"],
    features: { ruleScore: 55 },
  });
  return { body, normalized };
}

test("reviews and applies one upstream model decision correction", async (t) => {
  const store = await createStore(t);
  seedDecision(store);
  const catalog = { ready: true, models: new Set(["smart-large", "smart-planning"]) };
  let observed;
  const corrector = new DecisionCorrector({
    store,
    catalog,
    metrics: new Metrics(),
    getConfig: () => mergeDeep(DEFAULT_CONFIG, { upstream: { baseUrl: "http://upstream.test", apiKey: "upstream-key" } }),
    getRevision: () => "rev-1",
    fetchImpl: async (url, options) => {
      observed = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ verdict: "incorrect", expectedTargetKey: "planning", confidence: 0.91, rationale: "rollout planning" }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const review = await corrector.reviewDecision("request-1", { judgeModel: "smart-large", minConfidence: 0.7 });
  assert.equal(observed.url, "http://upstream.test/v1/chat/completions");
  assert.equal(observed.options.headers.Authorization, "Bearer upstream-key");
  assert.equal(observed.body.model, "smart-large");
  assert.equal(observed.body.messages[1].content.includes("request-1"), true);
  assert.equal(review.suggestion.expectedTargetKey, "planning");

  const applied = corrector.applyDecisionReview("request-1", { expectedRevision: "rev-1", suggestion: review.suggestion });
  assert.equal(applied.appliedFeedback, true);
  assert.equal(applied.promptCorrection, true);
  assert.equal(store.get("request-1").feedback.expectedTarget, "smart-planning");
});

test("returns ineligible review without upstream call when context is missing", async (t) => {
  const store = await createStore(t);
  seedDecision(store, { context: false });
  const corrector = new DecisionCorrector({
    store,
    catalog: { ready: true, models: new Set(["smart-large"]) },
    metrics: new Metrics(),
    getConfig: () => DEFAULT_CONFIG,
    getRevision: () => "rev-1",
    fetchImpl: async () => { throw new Error("should not call upstream"); },
  });

  const review = await corrector.reviewDecision("request-1");
  assert.equal(review.eligible, false);
  assert.equal(review.skipReason, "missing_context");
});

test("retries judge call without response_format when upstream rejects it", async (t) => {
  const store = await createStore(t);
  seedDecision(store);
  const catalog = { ready: true, models: new Set(["smart-large"]) };
  const calls = [];
  const corrector = new DecisionCorrector({
    store,
    catalog,
    metrics: new Metrics(),
    getConfig: () => mergeDeep(DEFAULT_CONFIG, { upstream: { baseUrl: "http://upstream.test", apiKey: "" } }),
    getRevision: () => "rev-1",
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.response_format) {
        return new Response("response_format json_object not supported", { status: 400 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "```json\n{\"verdict\":\"correct\",\"confidence\":0.8}\n```" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const review = await corrector.reviewDecision("request-1", { judgeModel: "smart-large" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].response_format?.type, "json_object");
  assert.equal(calls[1].response_format, undefined);
  assert.equal(review.suggestion.verdict, "correct");
});

test("router uses accepted prompt corrections for future matching prompts", async (t) => {
  const store = await createStore(t);
  const { body, normalized } = seedDecision(store, { requestId: "source-request" });
  store.applyDecisionReview("source-request", {
    verdict: "incorrect",
    expectedTargetKey: "planning",
    expectedTarget: "smart-planning",
    confidence: 0.95,
    rationale: "planning prompt",
  });
  assert.equal(store.getPromptCorrection(normalized.promptHash).expectedTargetKey, "planning");

  const config = mergeDeep(DEFAULT_CONFIG, { classifier: { enabled: false }, upstream: { strictModelValidation: false } });
  const engine = new RouterEngine({
    config,
    classifier: { classify: async () => null },
    affinity: new AffinityStore(config.affinity),
    catalog: { resolve: (target) => target, lastError: null },
    metrics: new Metrics(),
    logStore: { decision() {} },
    decisionStore: store,
  });
  const result = await engine.decide({ pathname: "/v1/chat/completions", body, explainOnly: true });
  assert.equal(result.decision.mode, "feedback_corrected");
  assert.equal(result.decision.targetKey, "planning");
  assert.equal(result.decision.dispatchTarget, "smart-planning");
});
