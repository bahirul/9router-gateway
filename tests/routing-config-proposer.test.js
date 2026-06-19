import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RuntimeConfigManager } from "../src/config.js";
import {
  RoutingConfigProposer,
  createConfigPatch,
  previewImpact,
  validateAllowedChanges,
} from "../src/routing-config-proposer.js";

function configFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-proposer-"));
  const configPath = path.join(directory, "config.yaml");
  fs.writeFileSync(configPath, `
logging:
  directory: ${JSON.stringify(directory)}
classifier:
  cacheDir: ${JSON.stringify(path.join(directory, "models"))}
  enabled: false
upstream:
  baseUrl: https://judge.example.test
  apiKey: test-key
  strictModelValidation: false
`);
  return { configPath };
}

function currentConfig() {
  const { configPath } = configFixture();
  return new RuntimeConfigManager(configPath).get();
}

function taskClassProposal(config, overrides = {}) {
  return {
    ...config.routing.taskClasses,
    incident_triage: {
      semanticLabel: "incident triage",
      semanticScore: 75,
      priority: 95,
      scoreDelta: 35,
      hardFloor: "high",
      patterns: ["\\btriage\\b"],
      ...overrides,
    },
  };
}

function sample(prompt) {
  return {
    id: "sample-1",
    body: { model: "auto", messages: [{ role: "user", content: prompt }] },
  };
}

test("generates and validates a routing config proposal", async () => {
  const config = currentConfig();
  let requestedBody = null;
  const proposer = new RoutingConfigProposer({
    getConfig: () => config,
    getRevision: () => "rev-1",
    catalog: { ready: true, models: new Set(["smart-small"]) },
    fetchImpl: async (_url, request) => {
      requestedBody = JSON.parse(request.body);
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "Add incident triage routing.",
              rationale: "Triage prompts should use the large tier.",
              changes: [{
                path: "routing.taskClasses",
                value: taskClassProposal(config),
                reason: "Detect triage requests explicitly.",
              }],
            }),
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const result = await proposer.generate({
    samples: [sample("Triage this support queue.")],
    goals: "Improve triage routing.",
  });

  assert.equal(requestedBody.model, "smart-small");
  assert.equal(result.configRevision, "rev-1");
  assert.equal(result.proposal.summary, "Add incident triage routing.");
  assert.equal(result.patch.routing.taskClasses.incident_triage.semanticLabel, "incident triage");
  assert.equal(result.preview[0].before.task, "general");
  assert.equal(result.preview[0].after.task, "incident_triage");
  assert.equal(result.preview[0].changed, true);
});

test("rejects invalid proposal paths and regex patterns", () => {
  const config = currentConfig();

  assert.throws(
    () => createConfigPatch([{ path: "routing.targets.secret", value: "smart-large" }]),
    /Proposed field is not allowed: routing\.targets\.secret/,
  );

  assert.throws(
    () => validateAllowedChanges({
      routing: { taskClasses: taskClassProposal(config, { patterns: ["["] }) },
    }, config),
    /routing\.taskClasses\.incident_triage\.patterns\.0 is invalid/,
  );
});

test("allows safe classifier setting proposals", () => {
  const config = currentConfig();
  const patch = createConfigPatch([
    { path: "classifier.enabled", value: true },
    { path: "classifier.minimumConfidence", value: 0.45 },
  ]);
  const { candidate } = validateAllowedChanges(patch, config);

  assert.equal(candidate.classifier.enabled, true);
  assert.equal(candidate.classifier.minimumConfidence, 0.45);
});

test("previews routing impact for candidate config", () => {
  const config = currentConfig();
  const { candidate } = validateAllowedChanges({
    routing: { taskClasses: taskClassProposal(config) },
  }, config);

  const [impact] = previewImpact([sample("Triage this support queue.")], config, candidate);

  assert.equal(impact.id, "sample-1");
  assert.equal(impact.before.task, "general");
  assert.equal(impact.before.targetKey, "small");
  assert.equal(impact.after.task, "incident_triage");
  assert.equal(impact.after.targetKey, "large");
  assert.equal(impact.changed, true);
});
