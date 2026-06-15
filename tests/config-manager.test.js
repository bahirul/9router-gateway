import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RuntimeConfigManager } from "../src/config.js";

function configFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-config-"));
  const configPath = path.join(directory, "config.yaml");
  fs.writeFileSync(configPath, `
logging:
  directory: ${JSON.stringify(directory)}
classifier:
  cacheDir: ${JSON.stringify(path.join(directory, "models"))}
  enabled: false
upstream:
  strictModelValidation: false
`);
  return { directory, configPath };
}

test("persists revisioned UI overrides and can reset them", async () => {
  const { directory, configPath } = configFixture();
  const manager = new RuntimeConfigManager(configPath);
  const initial = manager.describe();
  let observed = null;
  manager.onChange((config) => { observed = config.routing.ambiguityMargin; });

  const updated = await manager.update(
    { routing: { ambiguityMargin: 11 } },
    initial.revision,
  );
  assert.equal(updated.config.routing.ambiguityMargin, 11);
  assert.equal(observed, 11);
  assert.ok(fs.existsSync(path.join(directory, "runtime-config.json")));

  await assert.rejects(
    manager.update({ routing: { ambiguityMargin: 12 } }, initial.revision),
    (error) => error.status === 409,
  );
  await assert.rejects(
    manager.update({ upstream: { baseUrl: "http://invalid.test" } }, updated.revision),
    (error) => error.status === 400,
  );

  const reset = await manager.reset(updated.revision);
  assert.equal(reset.config.routing.ambiguityMargin, 8);
  assert.equal(fs.existsSync(path.join(directory, "runtime-config.json")), false);
});

test("environment-managed editable fields are reported and rejected", async () => {
  const previous = process.env.SMART_ROUTER_SHADOW_MODE;
  process.env.SMART_ROUTER_SHADOW_MODE = "true";
  try {
    const { configPath } = configFixture();
    const manager = new RuntimeConfigManager(configPath);
    const state = manager.describe();
    assert.equal(state.locked["routing.shadowMode"], "SMART_ROUTER_SHADOW_MODE");
    await assert.rejects(
      manager.update({ routing: { shadowMode: false } }, state.revision),
      (error) => error.status === 400,
    );
  } finally {
    if (previous === undefined) delete process.env.SMART_ROUTER_SHADOW_MODE;
    else process.env.SMART_ROUTER_SHADOW_MODE = previous;
  }
});

test("classifier enablement is dashboard-editable without an environment override", async () => {
  const previous = process.env.SMART_ROUTER_CLASSIFIER_ENABLED;
  delete process.env.SMART_ROUTER_CLASSIFIER_ENABLED;
  try {
    const { directory, configPath } = configFixture();
    const manager = new RuntimeConfigManager(configPath);
    const state = manager.describe();
    assert.equal(state.locked["classifier.enabled"], undefined);

    const updated = await manager.update({
      classifier: { enabled: !state.config.classifier.enabled },
    }, state.revision);

    assert.equal(updated.config.classifier.enabled, !state.config.classifier.enabled);
    const overrides = JSON.parse(fs.readFileSync(path.join(directory, "runtime-config.json"), "utf8"));
    assert.equal(overrides.classifier.enabled, !state.config.classifier.enabled);
  } finally {
    if (previous === undefined) delete process.env.SMART_ROUTER_CLASSIFIER_ENABLED;
    else process.env.SMART_ROUTER_CLASSIFIER_ENABLED = previous;
  }
});

test("classifier confidence is dashboard-editable without an environment override", async () => {
  const previous = process.env.SMART_ROUTER_CLASSIFIER_MIN_CONFIDENCE;
  delete process.env.SMART_ROUTER_CLASSIFIER_MIN_CONFIDENCE;
  try {
    const { directory, configPath } = configFixture();
    const manager = new RuntimeConfigManager(configPath);
    const state = manager.describe();
    assert.equal(state.locked["classifier.minimumConfidence"], undefined);

    const updated = await manager.update({
      classifier: { minimumConfidence: 0.55 },
    }, state.revision);

    assert.equal(updated.config.classifier.minimumConfidence, 0.55);
    const overrides = JSON.parse(fs.readFileSync(path.join(directory, "runtime-config.json"), "utf8"));
    assert.equal(overrides.classifier.minimumConfidence, 0.55);
  } finally {
    if (previous === undefined) delete process.env.SMART_ROUTER_CLASSIFIER_MIN_CONFIDENCE;
    else process.env.SMART_ROUTER_CLASSIFIER_MIN_CONFIDENCE = previous;
  }
});

test("full-form updates can save unlocked fields when env-locked fields are unchanged", async () => {
  const previousShadowMode = process.env.SMART_ROUTER_SHADOW_MODE;
  const previousClassifierEnabled = process.env.SMART_ROUTER_CLASSIFIER_ENABLED;
  const previousMinimumConfidence = process.env.SMART_ROUTER_CLASSIFIER_MIN_CONFIDENCE;
  process.env.SMART_ROUTER_SHADOW_MODE = "true";
  process.env.SMART_ROUTER_CLASSIFIER_ENABLED = "false";
  process.env.SMART_ROUTER_CLASSIFIER_MIN_CONFIDENCE = "0.45";
  try {
    const { directory, configPath } = configFixture();
    const manager = new RuntimeConfigManager(configPath);
    const state = manager.describe();

    const updated = await manager.update({
      routing: {
        ...state.config.routing,
        shadowTarget: "smart-large",
      },
      classifier: {
        enabled: state.config.classifier.enabled,
        timeoutMs: 800,
        minimumConfidence: state.config.classifier.minimumConfidence,
      },
    }, state.revision);

    assert.equal(updated.config.routing.shadowMode, true);
    assert.equal(updated.config.routing.shadowTarget, "smart-large");
    assert.equal(updated.config.classifier.enabled, false);
    assert.equal(updated.config.classifier.timeoutMs, 800);
    assert.equal(updated.config.classifier.minimumConfidence, 0.45);

    const overrides = JSON.parse(fs.readFileSync(path.join(directory, "runtime-config.json"), "utf8"));
    assert.equal(overrides.routing.shadowTarget, "smart-large");
    assert.equal(overrides.routing.shadowMode, undefined);
    assert.equal(overrides.classifier.timeoutMs, 800);
    assert.equal(overrides.classifier.enabled, undefined);
    assert.equal(overrides.classifier.minimumConfidence, undefined);
  } finally {
    if (previousShadowMode === undefined) delete process.env.SMART_ROUTER_SHADOW_MODE;
    else process.env.SMART_ROUTER_SHADOW_MODE = previousShadowMode;
    if (previousClassifierEnabled === undefined) delete process.env.SMART_ROUTER_CLASSIFIER_ENABLED;
    else process.env.SMART_ROUTER_CLASSIFIER_ENABLED = previousClassifierEnabled;
    if (previousMinimumConfidence === undefined) delete process.env.SMART_ROUTER_CLASSIFIER_MIN_CONFIDENCE;
    else process.env.SMART_ROUTER_CLASSIFIER_MIN_CONFIDENCE = previousMinimumConfidence;
  }
});

test("security api key auth toggle is editable and persisted", async () => {
  const { directory, configPath } = configFixture();
  const manager = new RuntimeConfigManager(configPath);
  const state = manager.describe();

  const updated = await manager.update({ security: { apiKeyAuthEnabled: true } }, state.revision);
  assert.equal(updated.config.security.apiKeyAuthEnabled, true);

  const overrides = JSON.parse(fs.readFileSync(path.join(directory, "runtime-config.json"), "utf8"));
  assert.equal(overrides.security.apiKeyAuthEnabled, true);
});
