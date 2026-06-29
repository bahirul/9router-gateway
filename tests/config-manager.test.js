import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RuntimeConfigManager } from "../src/config.js";
import { DecisionStore } from "../src/decision-store.js";

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

async function runtimeManagerFixture(t) {
  const { directory, configPath } = configFixture();
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());
  const manager = new RuntimeConfigManager(configPath);
  await manager.attachStore(store);
  return { directory, configPath, store, manager };
}

test("persists revisioned UI overrides in SQLite and can reset them", async (t) => {
  const { store, manager } = await runtimeManagerFixture(t);
  const initial = manager.describe();
  let observed = null;
  manager.onChange((config) => { observed = config.routing.ambiguityMargin; });

  const updated = await manager.update(
    { routing: { ambiguityMargin: 11 } },
    initial.revision,
  );
  assert.equal(updated.config.routing.ambiguityMargin, 11);
  assert.equal(observed, 11);
  assert.equal(store.getRuntimeConfig().routing.ambiguityMargin, 11);
  assert.equal(updated.runtimeStore, "router.sqlite:meta.runtime_config");
  assert.deepEqual(updated.locked, {});

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
  assert.equal(store.getRuntimeConfig().routing.ambiguityMargin, undefined);
  assert.equal(store.getRuntimeConfig().routing.taskClasses.general.semanticLabel, "general question");
});

test("kept environment variables still configure bootstrap settings", async () => {
  const previous = {
    host: process.env.SMART_ROUTER_HOST,
    port: process.env.SMART_ROUTER_PORT,
    maxBodyBytes: process.env.SMART_ROUTER_MAX_BODY_BYTES,
    baseUrl: process.env.NINEROUTER_BASE_URL,
    apiKey: process.env.NINEROUTER_API_KEY,
    modelCache: process.env.SMART_ROUTER_MODEL_CACHE,
    dataDir: process.env.SMART_ROUTER_DATA_DIR,
  };
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-data-env-"));
  const modelCache = path.join(dataDirectory, "models-env");
  process.env.SMART_ROUTER_HOST = "0.0.0.0";
  process.env.SMART_ROUTER_PORT = "31234";
  process.env.SMART_ROUTER_MAX_BODY_BYTES = "4096";
  process.env.NINEROUTER_BASE_URL = "http://upstream-env.test:20128";
  process.env.NINEROUTER_API_KEY = "env-key";
  process.env.SMART_ROUTER_MODEL_CACHE = modelCache;
  process.env.SMART_ROUTER_DATA_DIR = dataDirectory;
  try {
    const { configPath } = configFixture();
    const manager = new RuntimeConfigManager(configPath);
    const state = manager.describe();
    assert.equal(state.config.upstream.baseUrl, "http://upstream-env.test:20128");
    assert.equal(manager.get().upstream.apiKey, "env-key");
    assert.equal(state.config.classifier.model, "Xenova/nli-deberta-v3-xsmall");
    assert.equal(manager.get().server.host, "0.0.0.0");
    assert.equal(manager.get().server.port, 31234);
    assert.equal(manager.get().server.maxBodyBytes, 4096);
    assert.equal(manager.get().classifier.cacheDir, path.resolve(modelCache));
    assert.equal(manager.runtimePath, path.join(dataDirectory, "runtime-config.json"));
  } finally {
    for (const [key, value] of Object.entries({
      SMART_ROUTER_HOST: previous.host,
      SMART_ROUTER_PORT: previous.port,
      SMART_ROUTER_MAX_BODY_BYTES: previous.maxBodyBytes,
      NINEROUTER_BASE_URL: previous.baseUrl,
      NINEROUTER_API_KEY: previous.apiKey,
      SMART_ROUTER_MODEL_CACHE: previous.modelCache,
      SMART_ROUTER_DATA_DIR: previous.dataDir,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("legacy runtime config files are migrated into SQLite", async (t) => {
  const { directory, configPath } = configFixture();
  fs.writeFileSync(path.join(directory, "runtime-config.json"), `${JSON.stringify({ routing: { ambiguityMargin: 12 } })}\n`);
  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());
  const manager = new RuntimeConfigManager(configPath);
  await manager.attachStore(store);

  assert.equal(manager.describe().config.routing.ambiguityMargin, 12);
  assert.equal(store.getRuntimeConfig().routing.ambiguityMargin, 12);
  assert.equal(store.getRuntimeConfig().routing.taskClasses.general.semanticLabel, "general question");
  assert.equal(fs.existsSync(path.join(directory, "runtime-config.json")), false);
  assert.equal(fs.existsSync(path.join(directory, "runtime-config.json.migrated")), true);
});

test("security api key auth toggle is editable and persisted", async (t) => {
  const { store, manager } = await runtimeManagerFixture(t);
  const state = manager.describe();

  const updated = await manager.update({ security: { apiKeyAuthEnabled: true } }, state.revision);
  assert.equal(updated.config.security.apiKeyAuthEnabled, true);

  assert.equal(store.getRuntimeConfig().security.apiKeyAuthEnabled, true);
});

test("identity override is editable, trimmed, and validated", async (t) => {
  const { store, manager } = await runtimeManagerFixture(t);
  const state = manager.describe();

  const updated = await manager.update({ identity: { enabled: true, modelName: "  Codex Router  " } }, state.revision);
  assert.equal(updated.config.identity.enabled, true);
  assert.equal(updated.config.identity.modelName, "Codex Router");
  assert.equal(store.getRuntimeConfig().identity.enabled, true);
  assert.equal(store.getRuntimeConfig().identity.modelName, "Codex Router");

  await assert.rejects(
    manager.update({ identity: { enabled: true, modelName: "   " } }, updated.revision),
    /identity\.modelName must be non-empty/,
  );
});

test("seeds and edits task classes in SQLite runtime config", async (t) => {
  const { store, manager } = await runtimeManagerFixture(t);
  const initial = manager.describe();
  assert.equal(initial.config.routing.taskClasses.general.semanticLabel, "general question");
  assert.equal(initial.defaults.routing.taskClasses.quick.semanticLabel, "quick transformation");
  assert.equal(store.getRuntimeConfig().routing.taskClasses.general.semanticLabel, "general question");

  const nextTaskClasses = {
    general: initial.config.routing.taskClasses.general,
    translation: {
      semanticLabel: "translation work",
      semanticScore: 15,
      priority: 95,
      scoreDelta: -10,
      patterns: ["\\blocali[sz]e\\b"],
    },
  };
  const updated = await manager.update({ routing: { taskClasses: nextTaskClasses } }, initial.revision);
  assert.equal(updated.config.routing.taskClasses.translation.semanticLabel, "translation work");
  assert.equal(updated.config.routing.taskClasses.quick, undefined);
  assert.equal(store.getRuntimeConfig().routing.taskClasses.translation.semanticLabel, "translation work");
  assert.equal(store.getRuntimeConfig().routing.taskClasses.quick, undefined);

  const resetTaskClasses = await manager.update({
    classifier: { minimumConfidence: 0.42 },
    routing: { taskClasses: updated.defaults.routing.taskClasses },
  }, updated.revision);
  assert.equal(resetTaskClasses.config.routing.taskClasses.quick.semanticLabel, "quick transformation");
  assert.equal(resetTaskClasses.config.routing.taskClasses.translation, undefined);
  assert.equal(resetTaskClasses.config.classifier.minimumConfidence, 0.42);
  assert.equal(store.getRuntimeConfig().routing.taskClasses.quick.semanticLabel, "quick transformation");
  assert.equal(store.getRuntimeConfig().routing.taskClasses.translation, undefined);
});

test("imports legacy YAML task classes into SQLite once", async (t) => {
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
routing:
  taskClasses:
    translation:
      semanticLabel: translation work
      priority: 95
      scoreDelta: -10
      patterns:
        - "\\\\blocali[sz]e\\\\b"
`);

  const store = new DecisionStore({ directory, logger: { warn() {} } });
  await store.init();
  t.after(() => store.close());
  const manager = new RuntimeConfigManager(configPath);
  await manager.attachStore(store);
  assert.equal(manager.get().routing.taskClasses.translation.semanticLabel, "translation work");
  assert.equal(manager.describe().config.routing.taskClasses.translation.semanticLabel, "translation work");
  assert.equal(store.getRuntimeConfig().routing.taskClasses.translation.semanticLabel, "translation work");

  fs.writeFileSync(configPath, `
logging:
  directory: ${JSON.stringify(directory)}
classifier:
  cacheDir: ${JSON.stringify(path.join(directory, "models"))}
  enabled: false
upstream:
  strictModelValidation: false
routing:
  taskClasses:
    translation:
      semanticLabel: changed yaml label
      priority: 1
      patterns:
        - "changed"
`);
  const reloaded = new RuntimeConfigManager(configPath);
  await reloaded.attachStore(store);
  assert.equal(reloaded.get().routing.taskClasses.translation.semanticLabel, "translation work");
});

test("rejects invalid SQLite task class updates", async (t) => {
  const { manager } = await runtimeManagerFixture(t);
  const state = manager.describe();
  await assert.rejects(
    manager.update({ routing: { taskClasses: { general: { task: false } } } }, state.revision),
    /routing\.taskClasses\.general is required/,
  );
  await assert.rejects(
    manager.update({ routing: { taskClasses: { ...state.config.routing.taskClasses, broken: { semanticLabel: "broken work", patterns: ["["] } } } }, state.revision),
    /routing\.taskClasses\.broken\.patterns\.0 is invalid/,
  );
});
