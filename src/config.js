import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

const DEFAULT_CONFIG = {
  server: {
    host: "127.0.0.1",
    port: 20129,
    maxBodyBytes: 128 * 1024 * 1024,
    uiEnabled: true,
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

const ENV_FIELDS = {
  "server.host": "SMART_ROUTER_HOST",
  "server.port": "SMART_ROUTER_PORT",
  "server.maxBodyBytes": "SMART_ROUTER_MAX_BODY_BYTES",
  "server.uiEnabled": "SMART_ROUTER_UI_ENABLED",
  "upstream.baseUrl": "NINEROUTER_BASE_URL",
  "upstream.apiKey": "NINEROUTER_API_KEY",
  "upstream.requestTimeoutMs": "SMART_ROUTER_REQUEST_TIMEOUT_MS",
  "upstream.strictModelValidation": "SMART_ROUTER_STRICT_MODEL_VALIDATION",
  "routing.shadowMode": "SMART_ROUTER_SHADOW_MODE",
  "classifier.enabled": "SMART_ROUTER_CLASSIFIER_ENABLED",
  "classifier.cacheDir": "SMART_ROUTER_MODEL_CACHE",
  "classifier.minimumConfidence": "SMART_ROUTER_CLASSIFIER_MIN_CONFIDENCE",
  "classifier.localFilesOnly": "SMART_ROUTER_LOCAL_FILES_ONLY",
  "logging.directory": "SMART_ROUTER_DATA_DIR",
  "logging.rawPrompts": "SMART_ROUTER_LOG_RAW_PROMPTS",
  "security.apiKeyAuthEnabled": "SMART_ROUTER_API_KEY_AUTH_ENABLED",
};

const UI_EDITABLE_PATHS = new Set([
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

function envBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be true, false, 1, or 0`);
}

function applyEnvironment(config) {
  return mergeDeep(config, {
    server: {
      host: process.env.SMART_ROUTER_HOST ?? config.server.host,
      port: envNumber("SMART_ROUTER_PORT", config.server.port),
      maxBodyBytes: envNumber("SMART_ROUTER_MAX_BODY_BYTES", config.server.maxBodyBytes),
      uiEnabled: envBoolean("SMART_ROUTER_UI_ENABLED", config.server.uiEnabled),
    },
    upstream: {
      baseUrl: process.env.NINEROUTER_BASE_URL ?? config.upstream.baseUrl,
      apiKey: process.env.NINEROUTER_API_KEY ?? config.upstream.apiKey,
      requestTimeoutMs: envNumber("SMART_ROUTER_REQUEST_TIMEOUT_MS", config.upstream.requestTimeoutMs),
      strictModelValidation: envBoolean(
        "SMART_ROUTER_STRICT_MODEL_VALIDATION",
        config.upstream.strictModelValidation,
      ),
    },
    routing: {
      shadowMode: envBoolean("SMART_ROUTER_SHADOW_MODE", config.routing.shadowMode),
    },
    classifier: {
      enabled: envBoolean("SMART_ROUTER_CLASSIFIER_ENABLED", config.classifier.enabled),
      cacheDir: process.env.SMART_ROUTER_MODEL_CACHE ?? config.classifier.cacheDir,
      minimumConfidence: envNumber(
        "SMART_ROUTER_CLASSIFIER_MIN_CONFIDENCE",
        config.classifier.minimumConfidence,
      ),
      localFilesOnly: envBoolean("SMART_ROUTER_LOCAL_FILES_ONLY", config.classifier.localFilesOnly),
    },
    logging: {
      directory: process.env.SMART_ROUTER_DATA_DIR ?? config.logging.directory,
      rawPrompts: envBoolean("SMART_ROUTER_LOG_RAW_PROMPTS", config.logging.rawPrompts),
    },
    security: {
      apiKeyAuthEnabled: envBoolean("SMART_ROUTER_API_KEY_AUTH_ENABLED", config.security.apiKeyAuthEnabled),
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

function getPath(source, dottedPath) {
  let cursor = source;
  for (const part of dottedPath.split(".")) {
    if (!isObject(cursor) && cursor === undefined) return undefined;
    cursor = cursor?.[part];
  }
  return cursor;
}

function deletePath(target, dottedPath) {
  const parts = dottedPath.split(".");
  const parents = [];
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) return;
    parents.push([cursor, part]);
    cursor = cursor[part];
  }
  delete cursor[parts.at(-1)];
  for (const [parent, part] of parents.reverse()) {
    if (isObject(parent[part]) && Object.keys(parent[part]).length === 0) delete parent[part];
  }
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
  return Object.fromEntries(
    Object.entries(ENV_FIELDS)
      .filter(([, envName]) => process.env[envName] !== undefined)
      .map(([field, envName]) => [field, envName]),
  );
}

function publicConfig(config) {
  return {
    server: { uiEnabled: config.server.uiEnabled },
    upstream: {
      baseUrl: config.upstream.baseUrl,
      requestTimeoutMs: config.upstream.requestTimeoutMs,
      catalogRefreshMs: config.upstream.catalogRefreshMs,
      strictModelValidation: config.upstream.strictModelValidation,
      apiKeyConfigured: Boolean(config.upstream.apiKey),
    },
    routing: structuredClone(config.routing),
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
    this.runtimeOverrides = readJson(this.runtimePath);
    this.listeners = new Set();
    this.reload();
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
    const locks = lockedFields();
    const locked = paths.filter((field) => locks[field]
      && !Object.is(getPath(patch, field), getPath(this.effective, field)));
    if (locked.length) {
      const error = new Error(`Fields are controlled by environment variables: ${locked.join(", ")}`);
      error.status = 400;
      throw error;
    }
    const editable = flattenEditable(patch);
    for (const field of paths.filter((path) => locks[path])) deletePath(editable, field);
    const nextOverrides = mergeDeep(this.runtimeOverrides, editable);
    const candidate = validate(applyEnvironment(
      mergeDeep(mergeDeep(DEFAULT_CONFIG, this.fileConfig), nextOverrides),
    ));
    if (candidateValidator) await candidateValidator(candidate);
    fs.mkdirSync(path.dirname(this.runtimePath), { recursive: true });
    const temporary = `${this.runtimePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(nextOverrides, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.runtimePath);
    this.runtimeOverrides = nextOverrides;
    this.effective = candidate;
    this.revision = stableRevision({ runtime: this.runtimeOverrides, effective: publicConfig(candidate) });
    for (const listener of this.listeners) await listener(candidate);
    return this.describe();
  }

  async reset(expectedRevision) {
    if (expectedRevision !== this.revision) {
      const error = new Error("Configuration changed; reload before resetting");
      error.status = 409;
      throw error;
    }
    if (fs.existsSync(this.runtimePath)) fs.unlinkSync(this.runtimePath);
    this.runtimeOverrides = {};
    this.reload();
    for (const listener of this.listeners) await listener(this.effective);
    return this.describe();
  }
}

export function loadConfig(configPath = process.env.SMART_ROUTER_CONFIG || "./config.yaml") {
  return new RuntimeConfigManager(configPath).get();
}

export { DEFAULT_CONFIG, ENV_FIELDS, UI_EDITABLE_PATHS, mergeDeep, publicConfig, validate };
