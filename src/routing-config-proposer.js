import { extractFeatures } from "./features.js";
import { makeDecision } from "./policy.js";
import { normalizeRequest } from "./request-normalizer.js";
import { compileTaskClasses } from "./task-classes.js";

const DEFAULT_ALLOWED_PATHS = new Set([
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
  "routing.taskClasses",
  "classifier.enabled",
  "classifier.minimumConfidence",
]);

const TARGET_KEYS = new Set(["small", "medium", "planning", "large", "vision"]);
const PROFILE_KEYS = new Set(["auto", "auto-fast", "auto-quality"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function getPath(source, dottedPath) {
  return dottedPath.split(".").reduce((cursor, part) => cursor?.[part], source);
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

function leafPaths(source, prefix = "", target = []) {
  for (const [key, value] of Object.entries(source || {})) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (dotted === "routing.taskClasses") {
      target.push(dotted);
    } else if (isObject(value)) {
      leafPaths(value, dotted, target);
    } else {
      target.push(dotted);
    }
  }
  return target;
}

function mergeDeep(base, patch) {
  const result = clone(base) || {};
  for (const [key, value] of Object.entries(patch || {})) {
    result[key] = isObject(value) && isObject(result[key]) ? mergeDeep(result[key], value) : clone(value);
  }
  return result;
}

function normalizeAllowedPaths(allowedPaths = DEFAULT_ALLOWED_PATHS) {
  return allowedPaths instanceof Set ? allowedPaths : new Set(allowedPaths);
}

function parseJsonObject(text) {
  if (typeof text !== "string") return text;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("judge response did not contain a JSON object");
    return JSON.parse(match[0]);
  }
}

function textFromChatCompletion(payload) {
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.content || "").join("\n");
  }
  return "";
}

function upstreamHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function fetchJudge(fetchImpl, url, headers, body, timeoutMs) {
  return fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function validateNumber(value, path, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} must be a finite number between ${min} and ${max}`);
  }
}

function validateCandidateConfig(config) {
  const routing = config?.routing;
  if (!routing) throw new Error("routing config is required");
  validateNumber(routing.thresholds?.medium, "routing.thresholds.medium", { min: 0, max: 100 });
  validateNumber(routing.thresholds?.high, "routing.thresholds.high", { min: 0, max: 100 });
  if (routing.thresholds.medium >= routing.thresholds.high) {
    throw new Error("routing.thresholds must satisfy medium < high");
  }
  validateNumber(routing.ambiguityMargin, "routing.ambiguityMargin", { min: 0, max: 50 });
  for (const key of TARGET_KEYS) {
    if (typeof routing.targets?.[key] !== "string" || !routing.targets[key].trim()) {
      throw new Error(`routing.targets.${key} must be a non-empty string`);
    }
  }
  for (const key of PROFILE_KEYS) {
    validateNumber(routing.profiles?.[key]?.scoreBias, `routing.profiles.${key}.scoreBias`, { min: -50, max: 50 });
  }
  if (typeof config.classifier?.enabled !== "boolean") throw new Error("classifier.enabled must be a boolean");
  validateNumber(config.classifier?.minimumConfidence, "classifier.minimumConfidence", { min: 0, max: 1 });
  compileTaskClasses(routing.taskClasses);
  return config;
}

export function normalizeProposal(rawProposal) {
  const proposal = parseJsonObject(rawProposal);
  const changes = Array.isArray(proposal?.changes) ? proposal.changes : [];
  return {
    summary: typeof proposal?.summary === "string" ? proposal.summary.slice(0, 1000) : "",
    rationale: typeof proposal?.rationale === "string" ? proposal.rationale.slice(0, 4000) : "",
    changes: changes.map((change) => ({
      path: String(change?.path || "").trim(),
      value: clone(change?.value),
      reason: typeof change?.reason === "string" ? change.reason.slice(0, 1000) : "",
    })).filter((change) => change.path),
  };
}

export function createConfigPatch(changes, { allowedPaths = DEFAULT_ALLOWED_PATHS } = {}) {
  const allowed = normalizeAllowedPaths(allowedPaths);
  const patch = {};
  for (const change of changes || []) {
    if (!allowed.has(change.path)) {
      const error = new Error(`Proposed field is not allowed: ${change.path}`);
      error.status = 400;
      throw error;
    }
    setPath(patch, change.path, change.value);
  }
  return patch;
}

export function validateAllowedChanges(patch, currentConfig, { allowedPaths = DEFAULT_ALLOWED_PATHS, catalog = null } = {}) {
  const allowed = normalizeAllowedPaths(allowedPaths);
  const invalid = leafPaths(patch).filter((path) => !allowed.has(path));
  if (invalid.length) {
    const error = new Error(`Proposed fields are not allowed: ${invalid.join(", ")}`);
    error.status = 400;
    throw error;
  }
  const candidate = validateCandidateConfig(mergeDeep(currentConfig, patch));
  if (catalog?.ready && candidate.upstream?.strictModelValidation !== false) {
    const targets = Object.values(candidate.routing.targets);
    const missing = targets.filter((target) => !catalog.models.has(target));
    if (missing.length) {
      const error = new Error(`9Router models or combos not found: ${missing.join(", ")}`);
      error.status = 400;
      throw error;
    }
  }
  return { patch, candidate };
}

export function routePreviewSample(sample, config) {
  const pathname = sample.pathname || "/v1/chat/completions";
  const body = sample.body || sample.request || sample;
  const normalized = sample.normalized || normalizeRequest(pathname, body);
  const taskClasses = compileTaskClasses(config.routing.taskClasses);
  const features = sample.features || extractFeatures(normalized, config.routing.thresholds, taskClasses);
  const requestedModel = sample.requestedModel || normalized.model || "auto";
  const decision = makeDecision({
    requestedModel,
    normalized: { ...normalized, model: requestedModel },
    features,
    semantic: sample.semantic || null,
    routingConfig: config.routing,
    taskClasses,
  });
  return { normalized, features, decision };
}

export function previewImpact(samples, currentConfig, candidateConfig) {
  return (samples || []).map((sample, index) => {
    const before = routePreviewSample(sample, currentConfig);
    const after = routePreviewSample(sample, candidateConfig);
    return {
      index,
      id: sample.id || sample.requestId || null,
      promptHash: before.normalized.promptHash,
      before: before.decision,
      after: after.decision,
      changed: before.decision?.targetKey !== after.decision?.targetKey
        || before.decision?.target !== after.decision?.target
        || before.decision?.complexity !== after.decision?.complexity,
    };
  });
}

export function proposalPrompt({ config, samples = [], goals = "" }) {
  return [
    {
      role: "system",
      content: "You propose safe smart-router routing config changes. Return strict JSON only with shape {summary,rationale,changes:[{path,value,reason}]}. Only propose allowed routing paths. Prefer small, explainable changes.",
    },
    {
      role: "user",
      content: JSON.stringify({
        allowedPaths: [...DEFAULT_ALLOWED_PATHS],
        goals,
        routing: config.routing,
        samples: samples.slice(0, 50).map((sample) => ({
          id: sample.id || sample.requestId || null,
          expectedTargetKey: sample.expectedTargetKey || null,
          decision: sample.decision || null,
          body: sample.body || sample.request || null,
          normalized: sample.normalized || null,
          features: sample.features || null,
        })),
      }),
    },
  ];
}

export class RoutingConfigProposer {
  constructor({ getConfig, getRevision = () => null, catalog = null, fetchImpl = fetch } = {}) {
    this.getConfig = getConfig;
    this.getRevision = getRevision;
    this.catalog = catalog;
    this.fetchImpl = fetchImpl;
  }

  defaultJudgeModel() {
    if (this.catalog?.ready && this.catalog.models.has("smart-small")) return "smart-small";
    return this.catalog?.ready ? [...this.catalog.models][0] || "smart-small" : "smart-small";
  }

  validateJudgeModel(judgeModel) {
    const model = String(judgeModel || this.defaultJudgeModel()).trim();
    if (!model) {
      const error = new Error("judgeModel is required");
      error.status = 400;
      throw error;
    }
    if (this.catalog?.ready && !this.catalog.models.has(model)) {
      const error = new Error(`judgeModel not found in 9Router catalog: ${model}`);
      error.status = 400;
      throw error;
    }
    return model;
  }

  async generate({ judgeModel, samples = [], goals = "", allowedPaths = DEFAULT_ALLOWED_PATHS } = {}) {
    const config = this.getConfig();
    const model = this.validateJudgeModel(judgeModel);
    const response = await fetchJudge(
      this.fetchImpl,
      `${config.upstream.baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
      upstreamHeaders(config.upstream.apiKey),
      {
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: proposalPrompt({ config, samples, goals }),
      },
      config.upstream.requestTimeoutMs,
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const error = new Error(`judge model returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      error.status = 502;
      throw error;
    }

    const proposal = normalizeProposal(textFromChatCompletion(await response.json()));
    const patch = createConfigPatch(proposal.changes, { allowedPaths });
    const { candidate } = validateAllowedChanges(patch, config, { allowedPaths, catalog: this.catalog });
    return {
      judgeModel: model,
      configRevision: this.getRevision(),
      proposal,
      patch,
      preview: previewImpact(samples, config, candidate),
    };
  }

  async propose(options = {}) {
    return this.generate(options);
  }

  buildPatch(changes, options = {}) {
    return createConfigPatch(changes, options);
  }

  validate(patch, currentConfig = this.getConfig(), options = {}) {
    return validateAllowedChanges(patch, currentConfig, { catalog: this.catalog, ...options });
  }

  preview(samples, patch, currentConfig = this.getConfig()) {
    const { candidate } = validateAllowedChanges(patch, currentConfig, { catalog: this.catalog });
    return previewImpact(samples, currentConfig, candidate);
  }
}

export { DEFAULT_ALLOWED_PATHS };
