import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";
import { DEFAULT_TASK_CLASSES, compileTaskClasses } from "./task-classes.js";

const DEFAULT_CONFIG = {
  server: {
    host: "127.0.0.1",
    port: 20129,
    maxBodyBytes: 128 * 1024 * 1024,
  },
  upstream: {
    baseUrl: "http://127.0.0.1:20128",
    apiKey: "",
    requestTimeoutMs: 10 * 60 * 1000,
    catalogRefreshMs: 30 * 1000,
    strictModelValidation: true,
  },
  routing: {
    shadowMode: false,
    shadowTarget: "smart-medium",
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
    taskClasses: DEFAULT_TASK_CLASSES,
  },
  classifier: {
    enabled: true,
    model: "Xenova/nli-deberta-v3-xsmall",
    revision: "2a4f614a701367a02d51389039afc998faeda637",
    timeoutMs: 400,
    minimumConfidence: 0.32,
    cacheDir: "./data/models",
    localFilesOnly: false,
  },
  affinity: {
    ttlMs: 2 * 60 * 60 * 1000,
    maxEntries: 10000,
  },
  logging: {
    directory: "./data",
    rawPrompts: false,
    retentionDays: 30,
  },
  security: {
    sessionTtlMs: 8 * 60 * 60 * 1000,
    apiKeyAuthEnabled: false,
  },
};

const UI_EDITABLE_PATHS = new Set([
  "upstream.requestTimeoutMs",
  "upstream.strictModelValidation",
  "routing.shadowMode",
  "routing.shadowTarget",
  "routing.thresholds.medium",
  "routing.thresholds.high",
  "routing.ambiguityMargin",
  "routing.profiles.auto.scoreBias",
  "routing.profiles.auto-fast.scoreBias",
  "routing.profiles.auto-quality.scoreBias",
  "routing.targets.small",
  "routing.targets.medium",
  "routing.targets.planning",
  "routing.targets.large",
  "routing.targets.vision",
  "classifier.enabled",
  "classifier.timeoutMs",
  "classifier.minimumConfidence",
  "classifier.localFilesOnly",
  "affinity.ttlMs",
  "affinity.maxEntries",
  "logging.rawPrompts",
  "logging.retentionDays",
  "security.apiKeyAuthEnabled",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isObject(value) && isObject(result[key])) result[key] = mergeDeep(result[key], value);
    else result[key] = value;
  }
  return result;
}

function interpolateEnv(text) {
  return text.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_, name, fallback = "") => {
    return process.env[name] ?? fallback;
  });
}

function envNumber(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return parsed;
}

function applyEnvironment(config) {
  return mergeDeep(config, {
    server: {
      host: process.env.SMART_ROUTER_HOST ?? config.server.host,
      port: envNumber("SMART_ROUTER_PORT", config.server.port),
      maxBodyBytes: envNumber("SMART_ROUTER_MAX_BODY_BYTES", config.server.maxBodyBytes),
    },
    upstream: {
      baseUrl: process.env.NINEROUTER_BASE_URL ?? config.upstream.baseUrl,
      apiKey: process.env.NINEROUTER_API_KEY ?? config.upstream.apiKey,
    },
    classifier: {
      cacheDir: process.env.SMART_ROUTER_MODEL_CACHE ?? config.classifier.cacheDir,
    },
    logging: {
      directory: process.env.SMART_ROUTER_DATA_DIR ?? config.logging.directory,
    },
  });
}

function assertPositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
}

function validate(config) {
  assertPositiveNumber(config.server.port || 1, "server.port");
  assertPositiveNumber(config.server.maxBodyBytes, "server.maxBodyBytes");
  assertPositiveNumber(config.upstream.requestTimeoutMs, "upstream.requestTimeoutMs");
  assertPositiveNumber(config.affinity.ttlMs, "affinity.ttlMs");
  assertPositiveNumber(config.affinity.maxEntries, "affinity.maxEntries");
  assertPositiveNumber(config.logging.retentionDays, "logging.retentionDays");
  assertPositiveNumber(config.security.sessionTtlMs, "security.sessionTtlMs");
  if (typeof config.security.apiKeyAuthEnabled !== "boolean") {
    throw new Error("security.apiKeyAuthEnabled must be a boolean");
  }

  let upstream;
  try {
    upstream = new URL(config.upstream.baseUrl);
  } catch {
    throw new Error("upstream.baseUrl must be a valid URL");
  }
  if (!["http:", "https:"].includes(upstream.protocol)) {
    throw new Error("upstream.baseUrl must use http or https");
  }
  config.upstream.baseUrl = upstream.toString().replace(/\/$/, "");

  const { medium, high } = config.routing.thresholds;
  if (!Number.isFinite(medium) || !Number.isFinite(high) || medium >= high) {
    throw new Error("routing.thresholds must satisfy medium < high");
  }
  for (const key of ["small", "medium", "planning", "large", "vision"]) {
    if (typeof config.routing.targets[key] !== "string" || !config.routing.targets[key].trim()) {
      throw new Error(`routing.targets.${key} must be a non-empty 9Router model or combo name`);
    }
  }
  if (typeof config.routing.shadowTarget !== "string" || !config.routing.shadowTarget.trim()) {
    throw new Error("routing.shadowTarget must be a non-empty 9Router model or combo name");
  }
  for (const model of ["auto", "auto-fast", "auto-quality"]) {
    if (!config.routing.profiles[model]) throw new Error(`routing.profiles.${model} is required`);
  }
  compileTaskClasses(config.routing.taskClasses);
  if (
    !Number.isFinite(config.classifier.minimumConfidence)
    || config.classifier.minimumConfidence < 0
    || config.classifier.minimumConfidence > 1
  ) {
    throw new Error("classifier.minimumConfidence must be between 0 and 1");
  }
  config.classifier.cacheDir = path.resolve(config.classifier.cacheDir);
  config.logging.directory = path.resolve(config.logging.directory);
  return config;
}

function readYaml(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) return {};
  return YAML.parse(interpolateEnv(fs.readFileSync(resolved, "utf8"))) || {};
}

function readJson(filename) {
  if (!fs.existsSync(filename)) return {};
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function stableRevision(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function setPath(target, dottedPath, value) {
  const parts = dottedPath.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function flattenEditable(source, prefix = "", target = {}) {
  for (const [key, value] of Object.entries(source || {})) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) flattenEditable(value, dotted, target);
    else if (UI_EDITABLE_PATHS.has(dotted)) setPath(target, dotted, value);
  }
  return target;
}

function leafPaths(source, prefix = "", target = []) {
  for (const [key, value] of Object.entries(source || {})) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) leafPaths(value, dotted, target);
    else target.push(dotted);
  }
  return target;
}

function lockedFields() {
  return {};
}

function publicConfig(config) {
  const { taskClasses, ...routing } = config.routing;
  return {
    upstream: {
      baseUrl: config.upstream.baseUrl,
      requestTimeoutMs: config.upstream.requestTimeoutMs,
      catalogRefreshMs: config.upstream.catalogRefreshMs,
      strictModelValidation: config.upstream.strictModelValidation,
      apiKeyConfigured: Boolean(config.upstream.apiKey),
    },
    routing: structuredClone(routing),
    classifier: {
      enabled: config.classifier.enabled,
      model: config.classifier.model,
      revision: config.classifier.revision,
      timeoutMs: config.classifier.timeoutMs,
      minimumConfidence: config.classifier.minimumConfidence,
      localFilesOnly: config.classifier.localFilesOnly,
    },
    affinity: structuredClone(config.affinity),
    logging: structuredClone(config.logging),
    security: {
      apiKeyAuthEnabled: config.security.apiKeyAuthEnabled,
      sessionTtlMs: config.security.sessionTtlMs,
    },
  };
}

export class RuntimeConfigManager {
  constructor(configPath = process.env.SMART_ROUTER_CONFIG || "./config.yaml") {
    this.configPath = path.resolve(configPath);
    this.fileConfig = readYaml(this.configPath);
    const preRuntime = mergeDeep(DEFAULT_CONFIG, this.fileConfig);
    const dataDir = path.resolve(process.env.SMART_ROUTER_DATA_DIR || preRuntime.logging.directory);
    this.runtimePath = path.join(dataDir, "runtime-config.json");
    this.runtimeStore = null;
    this.runtimeStoreLabel = null;
    this.runtimeOverrides = readJson(this.runtimePath);
    this.listeners = new Set();
    this.reload();
  }

  async attachStore(store, { notify = false } = {}) {
    if (!store?.ready) return this.describe();
    this.runtimeStore = store;
    this.runtimeStoreLabel = "router.sqlite:meta.runtime_config";
    const stored = store.getRuntimeConfig();
    if (stored === null && fs.existsSync(this.runtimePath)) {
      this.runtimeOverrides = readJson(this.runtimePath);
      store.setRuntimeConfig(this.runtimeOverrides);
      try {
        fs.renameSync(this.runtimePath, `${this.runtimePath}.migrated`);
      } catch {}
    } else {
      this.runtimeOverrides = stored || {};
    }
    this.reload();
    if (notify) {
      for (const listener of this.listeners) await listener(this.effective);
    }
    return this.describe();
  }

  reload() {
    this.effective = validate(applyEnvironment(
      mergeDeep(mergeDeep(DEFAULT_CONFIG, this.fileConfig), this.runtimeOverrides),
    ));
    this.revision = stableRevision({ runtime: this.runtimeOverrides, effective: publicConfig(this.effective) });
    return this.effective;
  }

  get() {
    return this.effective;
  }

  describe() {
    return {
      revision: this.revision,
      config: publicConfig(this.effective),
      overrides: structuredClone(this.runtimeOverrides),
      locked: lockedFields(),
      runtimePath: this.runtimePath,
      runtimeStore: this.runtimeStoreLabel,
    };
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async update(patch, expectedRevision, candidateValidator = null) {
    if (expectedRevision !== this.revision) {
      const error = new Error("Configuration changed; reload before saving");
      error.status = 409;
      throw error;
    }
    const paths = leafPaths(patch);
    const invalid = paths.filter((field) => !UI_EDITABLE_PATHS.has(field));
    if (invalid.length) {
      const error = new Error(`Fields are not UI-editable: ${invalid.join(", ")}`);
      error.status = 400;
      throw error;
    }
    const editable = flattenEditable(patch);
    const nextOverrides = mergeDeep(this.runtimeOverrides, editable);
    const candidate = validate(applyEnvironment(
      mergeDeep(mergeDeep(DEFAULT_CONFIG, this.fileConfig), nextOverrides),
    ));
    if (candidateValidator) await candidateValidator(candidate);
    this.persistRuntimeOverrides(nextOverrides);
    this.runtimeOverrides = nextOverrides;
    this.effective = candidate;
    this.revision = stableRevision({ runtime: this.runtimeOverrides, effective: publicConfig(candidate) });
    for (const listener of this.listeners) await listener(candidate);
    return this.describe();
  }

  persistRuntimeOverrides(overrides) {
    if (this.runtimeStore?.ready) {
      this.runtimeStore.setRuntimeConfig(overrides);
      return;
    }
    fs.mkdirSync(path.dirname(this.runtimePath), { recursive: true });
    const temporary = `${this.runtimePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(overrides, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.runtimePath);
  }

  async reset(expectedRevision) {
    if (expectedRevision !== this.revision) {
      const error = new Error("Configuration changed; reload before resetting");
      error.status = 409;
      throw error;
    }
    if (this.runtimeStore?.ready) this.runtimeStore.clearRuntimeConfig();
    if (fs.existsSync(this.runtimePath)) fs.unlinkSync(this.runtimePath);
    this.runtimeOverrides = {};
    this.reload();
    for (const listener of this.listeners) await listener(this.effective);
    return this.describe();
  }
}

export { DEFAULT_CONFIG, mergeDeep, publicConfig, validate };
