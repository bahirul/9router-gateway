import assert from "node:assert/strict";
import test from "node:test";
import { extractFeatures } from "../src/features.js";
import { normalizeRequest } from "../src/request-normalizer.js";
import { makeDecision } from "../src/policy.js";
import { DEFAULT_TASK_CLASSES, compileTaskClasses } from "../src/task-classes.js";

const routingConfig = {
  shadowMode: false,
  thresholds: { medium: 35, high: 70 },
  ambiguityMargin: 8,
  profiles: {
    auto: { scoreBias: 0 },
    "auto-fast": { scoreBias: -15 },
    "auto-quality": { scoreBias: 15 },
  },
  targets: {
    small: "smart-small",
    medium: "smart-medium",
    planning: "smart-planning",
    large: "smart-large",
    vision: "smart-vision",
  },
};

function decide(text, model = "auto", extra = {}) {
  const normalized = normalizeRequest("/v1/chat/completions", {
    model,
    messages: [{ role: "user", content: text }],
    ...extra,
  });
  const features = extractFeatures(normalized, routingConfig.thresholds);
  return makeDecision({
    requestedModel: model,
    normalized,
    features,
    semantic: null,
    routingConfig,
  });
}

test("routes quick transformations to the small tier", () => {
  const decision = decide("Translate this sentence to Indonesian.");
  assert.equal(decision.task, "quick");
  assert.equal(decision.target, "smart-small");
});

test("routes planning to its dedicated combo", () => {
  const decision = decide("Plan the architecture and implementation strategy for a cache service.");
  assert.equal(decision.task, "planning");
  assert.equal(decision.complexity, "medium");
  assert.equal(decision.target, "smart-planning");
});

test("forces risky migrations to the large tier", () => {
  const decision = decide("Design a zero downtime production authentication schema migration with rollback.");
  assert.equal(decision.complexity, "high");
  assert.equal(decision.target, "smart-large");
});

test("routes image input to the vision combo", () => {
  const decision = decide("Describe this UI.", "auto", {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Describe this UI." },
        { type: "image_url", image_url: { url: "https://example.test/ui.png" } },
      ],
    }],
  });
  assert.equal(decision.target, "smart-vision");
});

test("profile bias changes uncertain routing without violating hard floors", () => {
  const text = "Implement a function that parses a configuration object and returns validation errors.";
  assert.ok(decide(text, "auto-fast").score <= decide(text, "auto").score);
  assert.ok(decide(text, "auto-quality").score >= decide(text, "auto").score);

  const risky = "Review production authorization and tenant isolation vulnerabilities.";
  assert.equal(decide(risky, "auto-fast").target, "smart-large");
});

test("fuses semantic classifier results for ambiguous prompts", () => {
  const normalized = normalizeRequest("/v1/chat/completions", {
    model: "auto",
    messages: [{ role: "user", content: "Think through the best approach." }],
  });
  const features = extractFeatures(normalized, routingConfig.thresholds);
  const decision = makeDecision({
    requestedModel: "auto",
    normalized,
    features,
    semantic: { label: "planning", confidence: 0.95 },
    routingConfig,
  });

  assert.equal(decision.classifierUsed, true);
  assert.equal(decision.task, "planning");
  assert.equal(decision.target, "smart-planning");
});

test("recognizes Indonesian planning and risk signals", () => {
  const decision = decide("Rencanakan arsitektur migrasi basis data produksi tanpa downtime dan rollback.");
  assert.equal(decision.task, "planning");
  assert.equal(decision.target, "smart-large");
});

test("uses configured task classes for deterministic classification", () => {
  const taskClasses = compileTaskClasses({
    ...DEFAULT_TASK_CLASSES,
    translation: {
      semanticLabel: "translation work",
      priority: 95,
      scoreDelta: -10,
      patterns: ["\\blocali[sz]e\\b"],
    },
  });
  const normalized = normalizeRequest("/v1/chat/completions", {
    model: "auto",
    messages: [{ role: "user", content: "Localize these button labels for Indonesian users." }],
  });
  const features = extractFeatures(normalized, routingConfig.thresholds, taskClasses);
  const decision = makeDecision({
    requestedModel: "auto",
    normalized,
    features,
    semantic: null,
    routingConfig,
    taskClasses,
  });

  assert.equal(features.flags.translation, true);
  assert.equal(decision.task, "translation");
  assert.equal(decision.target, "smart-small");
});
