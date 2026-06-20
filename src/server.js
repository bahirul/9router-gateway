import http from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";
import { createAdminApi } from "./admin-api.js";
import { AffinityStore } from "./affinity.js";
import { ModelCatalog } from "./catalog.js";
import { SemanticClassifier } from "./classifier.js";
import { DecisionCorrector } from "./decision-corrector.js";
import {
  RuntimeConfigManager,
  mergeDeep,
  publicConfig,
  validate,
} from "./config.js";
import { DecisionStore } from "./decision-store.js";
import { LogStore } from "./log-store.js";
import { Metrics } from "./metrics.js";
import { packageVersion } from "./package-info.js";
import { clientIp } from "./client-ip.js";
import { isRoutablePath, normalizeRequest } from "./request-normalizer.js";
import { RouterEngine } from "./router-engine.js";
import { SessionManager } from "./session-manager.js";
import { createStaticUi } from "./static-ui.js";
import { evaluateGuardrails, mergeGuardrailConfig } from "./guardrails.js";

const HOP_BY_HOP = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function jsonResponse(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": payload.length,
    ...headers,
  });
  res.end(payload);
}

function requestHeaders(req) {
  const result = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) result[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

const CLIENT_AUTH_HEADERS = new Set(["authorization", "x-api-key"]);

function upstreamHeaders(req, upstreamApiKey = "") {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || HOP_BY_HOP.has(lower) || CLIENT_AUTH_HEADERS.has(lower)) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  headers.set("x-smart-router-proxy", "1");
  if (upstreamApiKey) headers.set("Authorization", `Bearer ${upstreamApiKey}`);
  return headers;
}

function upstreamUrl(rawTarget, baseUrl) {
  const parsed = new URL(rawTarget || "/", "http://smart-router.local");
  return new URL(`${parsed.pathname}${parsed.search}`, `${baseUrl}/`);
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`request body exceeds ${maxBytes} bytes`);
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function adminAuthorized(req, store) {
  if (!store?.verifyAdminPassword) return false;
  const authorization = req.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return store.verifyAdminPassword(bearer) || store.verifyAdminPassword(req.headers["x-admin-key"] || "");
}

function apiKeyAuthorized(req, store, { consume = false } = {}) {
  if (!store?.authorizeApiKey) return { ok: false, reason: "unavailable" };
  const authorization = req.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return store.authorizeApiKey(bearer || req.headers["x-api-key"] || "", { consume });
}

function rejectApiKeyAuthorization(res, authorization) {
  if (authorization.reason === "quota_exceeded") {
    return jsonResponse(res, 429, { error: "api key quota exceeded" });
  }
  return jsonResponse(res, 401, { error: "api key authorization required" });
}

function apiKeyNeedsQuotaConsume(authorization) {
  return Boolean(authorization?.key?.quotaPeriod && authorization.key.quotaLimit != null);
}

function apiKeyForcedModel(authorization) {
  return authorization?.key?.forcedModel || null;
}

function apiKeyGuardrails(authorization) {
  return authorization?.key?.guardrails || null;
}

function apiKeyId(authorization) {
  return authorization?.key?.id || null;
}

function rejectGuardrail(res, result) {
  return jsonResponse(res, 403, {
    error: {
      message: "Request blocked by gateway guardrails",
      type: "smart_router_guardrail_blocked",
      code: "guardrail_blocked",
      categories: result.categories,
      severity: result.severity,
    },
  });
}

function routingHeaders(decisionResult) {
  if (!decisionResult || decisionResult.passthrough || decisionResult.error) return {};
  const { requestId, decision } = decisionResult;
  return {
    "x-smart-router-request-id": requestId,
    "x-smart-router-target": decision.target,
    "x-smart-router-dispatch-target": decision.dispatchTarget,
    "x-smart-router-task": decision.task,
    "x-smart-router-complexity": decision.complexity,
    "x-smart-router-confidence": String(decision.confidence),
    "x-smart-router-mode": decision.mode,
    "Access-Control-Expose-Headers": [
      "x-smart-router-request-id",
      "x-smart-router-target",
      "x-smart-router-dispatch-target",
      "x-smart-router-task",
      "x-smart-router-complexity",
      "x-smart-router-confidence",
      "x-smart-router-mode",
    ].join(", "),
  };
}

function copyResponseHeaders(upstream, extra = {}) {
  const headers = {};
  for (const [name, value] of upstream.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "content-encoding") continue;
    headers[name] = value;
  }
  delete headers["content-length"];
  delete headers["Content-Length"];
  return { ...headers, ...extra };
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? null;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? null;
  const totalTokens = usage.total_tokens ?? usage.totalTokens
    ?? (Number.isFinite(promptTokens) && Number.isFinite(completionTokens) ? promptTokens + completionTokens : null);
  if (![promptTokens, completionTokens, totalTokens].some(Number.isFinite)) return null;
  return { promptTokens, completionTokens, totalTokens };
}

function findUsage(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return null;
  const direct = normalizeUsage(value.usage || value.response?.usage || value.message?.usage || value);
  if (direct) return direct;
  for (const child of Object.values(value)) {
    const found = findUsage(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseSseUsage(text) {
  let latest = null;
  for (const event of text.split(/(?:\r?\n){2,}/)) {
    const data = event.split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      latest = findUsage(JSON.parse(data)) || latest;
    } catch {}
  }
  return latest;
}

export function extractTokenUsage(buffer) {
  if (!buffer?.length) return null;
  const text = Buffer.concat(buffer).toString("utf8");
  try {
    return findUsage(JSON.parse(text));
  } catch {
    return parseSseUsage(text);
  }
}

async function proxyFetch({
  req,
  res,
  bodyBuffer,
  config,
  fetchImpl,
  pathOverride,
  routingResult,
  logStore,
  metrics,
}) {
  const target = upstreamUrl(pathOverride || req.url, config.upstream.baseUrl);
  const controller = new AbortController();
  const abortWith = (message, status) => {
    const error = new Error(message);
    error.name = "AbortError";
    error.smartStatus = status;
    controller.abort(error);
  };
  const timeout = setTimeout(
    () => abortWith("upstream request timed out", 504),
    config.upstream.requestTimeoutMs,
  );
  const abort = () => abortWith("client disconnected", 499);
  const abortOnResponseClose = () => {
    if (!res.writableEnded) abort();
  };
  req.once("aborted", abort);
  res.once("close", abortOnResponseClose);
  const started = performance.now();

  try {
    const upstream = await fetchImpl(target, {
      method: req.method,
      headers: upstreamHeaders(req, config.upstream.apiKey),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : bodyBuffer,
      signal: controller.signal,
      redirect: "manual",
    });
    const extraHeaders = routingHeaders(routingResult);
    res.writeHead(upstream.status, copyResponseHeaders(upstream, extraHeaders));
    metrics.increment("smart_router_upstream_responses_total", { status: upstream.status });

    if (!upstream.body || req.method === "HEAD") {
      res.end();
      if (routingResult?.requestId) {
        logStore.outcome({
          requestId: routingResult.requestId,
          status: upstream.status,
          latencyMs: Math.round(performance.now() - started),
        });
      }
      return;
    }

    const stream = Readable.fromWeb(upstream.body);
    const contentType = upstream.headers.get("content-type") || "";
    const captureUsage = contentType.includes("application/json") || contentType.includes("text/event-stream");
    const captured = [];
    let capturedBytes = 0;
    stream.on("data", (chunk) => {
      if (!captureUsage || capturedBytes > 2 * 1024 * 1024) return;
      capturedBytes += chunk.length;
      if (capturedBytes <= 2 * 1024 * 1024) captured.push(Buffer.from(chunk));
    });
    await new Promise((resolve, reject) => {
      stream.once("end", resolve);
      stream.once("error", reject);
      stream.pipe(res);
    });
    if (routingResult?.requestId) {
      logStore.outcome({
        requestId: routingResult.requestId,
        status: upstream.status,
        latencyMs: Math.round(performance.now() - started),
        tokens: extractTokenUsage(captured),
      });
    }
  } catch (error) {
    const status = error.smartStatus || controller.signal.reason?.smartStatus
      || (error.name === "AbortError" ? 504 : 502);
    metrics.increment("smart_router_proxy_errors_total", {
      type: status === 499 ? "client_disconnect" : status === 504 ? "timeout" : "network",
    });
    if (!res.headersSent) {
      jsonResponse(res, status, {
        error: { message: `9Router upstream error: ${error.message}`, type: "smart_router_upstream_error" },
      }, routingHeaders(routingResult));
    } else {
      res.destroy(error);
    }
    if (routingResult?.requestId) {
      logStore.outcome({
        requestId: routingResult.requestId,
        status,
        latencyMs: Math.round(performance.now() - started),
        error: error.message,
      });
    }
  } finally {
    clearTimeout(timeout);
    req.off("aborted", abort);
    res.off("close", abortOnResponseClose);
  }
}

function addVirtualModels(payload) {
  const data = Array.isArray(payload.data) ? [...payload.data] : [];
  const existing = new Set(data.map((model) => model.id));
  for (const id of ["auto", "auto-fast", "auto-quality"]) {
    if (!existing.has(id)) data.unshift({ id, object: "model", owned_by: "smart-router" });
  }
  return { ...payload, object: payload.object || "list", data };
}

function filterModelsForApiKey(payload, forcedModel) {
  if (!forcedModel) return payload;
  const allowed = new Set(["auto", "auto-fast", "auto-quality", forcedModel]);
  return { ...payload, data: (payload.data || []).filter((model) => allowed.has(model.id)) };
}

function inMemoryConfigManager(initialConfig) {
  const baseConfig = validate(structuredClone(initialConfig));
  let config = baseConfig;
  let revision = "test-config";
  const listeners = new Set();
  return {
    get: () => config,
    describe: () => ({
      revision,
      config: publicConfig(config),
      overrides: {},
      locked: {},
      runtimePath: null,
    }),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async update(patch, expectedRevision, validator) {
      if (expectedRevision !== revision) {
        const error = new Error("Configuration changed; reload before saving");
        error.status = 409;
        throw error;
      }
      const candidate = validate(mergeDeep(config, patch));
      if (validator) await validator(candidate);
      config = candidate;
      revision = `${Date.now()}`;
      for (const listener of listeners) await listener(config);
      return this.describe();
    },
    async reset(expectedRevision) {
      if (expectedRevision !== revision) {
        const error = new Error("Configuration changed; reload before resetting");
        error.status = 409;
        throw error;
      }
      config = structuredClone(baseConfig);
      revision = `${Date.now()}`;
      for (const listener of listeners) await listener(config);
      return this.describe();
    },
  };
}

export function createSmartRouter({
  config,
  configManager,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const manager = configManager || (config
    ? inMemoryConfigManager(config)
    : new RuntimeConfigManager());
  let currentConfig = manager.get();
  const metrics = new Metrics();
  const affinity = new AffinityStore(currentConfig.affinity);
  const decisionStore = new DecisionStore({
    directory: currentConfig.logging.directory,
    retentionDays: currentConfig.logging.retentionDays,
    logger,
  });
  const storageReady = decisionStore.init().then(async () => {
    if (manager.attachStore) await manager.attachStore(decisionStore, { notify: true });
    decisionStore.cleanupGuardrailEvents(currentConfig.security.guardrails.auditRetentionDays);
  });
  const logStore = new LogStore(currentConfig.logging, decisionStore);
  const catalog = new ModelCatalog(currentConfig.upstream, metrics, fetchImpl);
  const classifier = new SemanticClassifier(currentConfig.classifier, metrics, logger);
  const getConfig = () => currentConfig;
  const engine = new RouterEngine({
    config: currentConfig,
    classifier,
    affinity,
    catalog,
    metrics,
    logStore,
    decisionStore,
  });
  const corrector = new DecisionCorrector({
    store: decisionStore,
    catalog,
    metrics,
    getConfig,
    getRevision: () => manager.describe().revision,
    fetchImpl,
  });
  const sessions = new SessionManager(currentConfig.security);
  sessions.setPasswordVerifier((candidate) => decisionStore.verifyAdminPassword(candidate));
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const serveStaticUi = createStaticUi(path.resolve(moduleDirectory, "../ui/dist"));
  const handleAdmin = createAdminApi({
    configManager: manager,
    sessions,
    store: decisionStore,
    engine,
    catalog,
    classifier,
    affinity,
    metrics,
    logStore,
    corrector,
    getConfig,
  });

  manager.onChange(async (nextConfig) => {
    currentConfig = nextConfig;
    engine.setConfig(nextConfig);
    classifier.config = nextConfig.classifier;
    catalog.config = nextConfig.upstream;
    affinity.ttlMs = nextConfig.affinity.ttlMs;
    affinity.maxEntries = nextConfig.affinity.maxEntries;
    logStore.rawPrompts = nextConfig.logging.rawPrompts;
    decisionStore.retentionDays = nextConfig.logging.retentionDays;
    decisionStore.cleanupGuardrailEvents(nextConfig.security.guardrails.auditRetentionDays);
    if (nextConfig.classifier.enabled) classifier.warm();
    await catalog.refresh();
  });

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, "http://smart-router.local");
    const pathname = parsedUrl.pathname;
    const activeConfig = getConfig();

    try {
      if (await handleAdmin(req, res, pathname, parsedUrl.searchParams)) return;

      if (req.method === "GET" && pathname === "/healthz") {
        return jsonResponse(res, 200, {
          status: "ok",
          version: packageVersion,
          classifier: activeConfig.classifier.enabled ? (classifier.lastError ? "degraded" : "enabled") : "disabled",
        });
      }

      if (req.method === "GET" && pathname === "/readyz") {
        const ready = catalog.ready || !activeConfig.upstream.strictModelValidation;
        return jsonResponse(res, ready ? 200 : 503, {
          status: ready ? "ready" : "not_ready",
          catalogReady: catalog.ready,
          catalogError: catalog.lastError?.message || null,
        });
      }

      if (req.method === "GET" && pathname === "/metrics") {
        if (!adminAuthorized(req, decisionStore)) {
          return jsonResponse(res, 401, { error: "admin authorization required" });
        }
        const body = metrics.render({ affinitySize: affinity.size(), catalogReady: catalog.ready });
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4", "Content-Length": Buffer.byteLength(body) });
        return res.end(body);
      }

      const apiKeyProtected = pathname.startsWith("/v1/") && !pathname.startsWith("/v1/router/");
      const apiKeyRequired = activeConfig.security?.apiKeyAuthEnabled && apiKeyProtected;
      let apiKeyAuthorization = null;
      if (apiKeyRequired) {
        apiKeyAuthorization = apiKeyAuthorized(req, decisionStore);
        if (!apiKeyAuthorization.ok) {
          return rejectApiKeyAuthorization(res, apiKeyAuthorization);
        }
      }
      const forcedModel = apiKeyForcedModel(apiKeyAuthorization);
      const guardrailOverride = apiKeyGuardrails(apiKeyAuthorization);

      if (req.method === "POST" && pathname === "/v1/router/explain") {
        if (!adminAuthorized(req, decisionStore)) {
          return jsonResponse(res, 401, { error: "admin authorization required" });
        }
        const raw = await readBody(req, activeConfig.server.maxBodyBytes);
        const envelope = JSON.parse(raw.toString("utf8"));
        const body = envelope.request || envelope.body || envelope;
        const requestPath = envelope.path || "/v1/chat/completions";
        const result = await engine.decide({
          pathname: requestPath,
          body,
          headers: requestHeaders(req),
          explainOnly: true,
        });
        return jsonResponse(res, result.error ? result.status : 200, result.error
          ? { error: result.error, partialDecision: result.decision }
          : {
              passthrough: result.passthrough,
              decision: result.decision || null,
              features: result.features || null,
            });
      }

      if (req.method === "POST" && pathname === "/v1/router/feedback") {
        if (!adminAuthorized(req, decisionStore)) {
          return jsonResponse(res, 401, { error: "admin authorization required" });
        }
        const raw = await readBody(req, activeConfig.server.maxBodyBytes);
        const feedback = JSON.parse(raw.toString("utf8"));
        if (!feedback.request_id || !Number.isInteger(feedback.rating) || feedback.rating < 1 || feedback.rating > 5) {
          return jsonResponse(res, 400, { error: "request_id and integer rating from 1 to 5 are required" });
        }
        logStore.feedback({
          requestId: feedback.request_id,
          rating: feedback.rating,
          expectedTarget: feedback.expected_target || null,
          note: feedback.note || null,
        });
        metrics.increment("smart_router_feedback_total", { rating: feedback.rating });
        return jsonResponse(res, 202, { accepted: true });
      }

      if (serveStaticUi(req, res, pathname)) return;

      const bodyBuffer = await readBody(req, activeConfig.server.maxBodyBytes);

      if (req.method === "GET" && pathname === "/v1/models") {
        if (apiKeyRequired && apiKeyNeedsQuotaConsume(apiKeyAuthorization)) {
          const authorization = apiKeyAuthorized(req, decisionStore, { consume: true });
          if (!authorization.ok) return rejectApiKeyAuthorization(res, authorization);
        }
        const upstream = await fetchImpl(upstreamUrl(req.url, activeConfig.upstream.baseUrl), {
          headers: upstreamHeaders(req, activeConfig.upstream.apiKey),
          signal: AbortSignal.timeout(Math.min(activeConfig.upstream.requestTimeoutMs, 10000)),
        });
        if (!upstream.ok) {
          const raw = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, copyResponseHeaders(upstream));
          return res.end(raw);
        }
        const payload = filterModelsForApiKey(addVirtualModels(await upstream.json()), forcedModel);
        return jsonResponse(res, 200, payload);
      }

      let routingResult = null;
      let outgoingBody = bodyBuffer;
      if (isRoutablePath(req.method, pathname)) {
        let body;
        try {
          body = JSON.parse(bodyBuffer.toString("utf8"));
        } catch {
          return jsonResponse(res, 400, {
            error: { message: "Invalid JSON body", type: "smart_router_invalid_request" },
          });
        }
        const guardrailConfig = mergeGuardrailConfig(activeConfig.security.guardrails, guardrailOverride);
        const normalized = normalizeRequest(pathname, body);
        const guardrailResult = evaluateGuardrails(guardrailConfig, normalized);
        metrics.increment("smart_router_guardrail_evaluations_total", { action: guardrailResult.action, result: guardrailResult.allowed ? "allowed" : "blocked" });
        for (const category of guardrailResult.categories) {
          metrics.increment("smart_router_guardrail_matches_total", { category, severity: guardrailResult.severity || "unknown" });
        }
        decisionStore.recordGuardrailEvent({
          apiKeyId: apiKeyId(apiKeyAuthorization),
          clientIp: clientIp(req),
          userAgent: req.headers["user-agent"] || null,
          path: pathname,
          model: body.model || null,
          action: guardrailResult.action,
          result: guardrailResult.allowed ? (guardrailResult.matchedRules.length ? "matched" : "allowed") : "blocked",
          severity: guardrailResult.severity,
          categories: guardrailResult.categories,
          matchedRules: guardrailResult.matchedRules,
          promptHash: normalized.promptHash,
          guardrailTextTruncated: normalized.guardrailTextTruncated,
          latencyMs: guardrailResult.latencyMs,
        });
        if (!guardrailResult.allowed) {
          metrics.increment("smart_router_guardrail_blocks_total", { severity: guardrailResult.severity || "unknown" });
          return rejectGuardrail(res, guardrailResult);
        }
        routingResult = await engine.decide({
          pathname,
          body,
          headers: requestHeaders(req),
          clientIp: clientIp(req),
          forcedModel,
        });
        if (routingResult.error) {
          return jsonResponse(res, routingResult.status, {
            error: { message: routingResult.error, type: "smart_router_unavailable" },
            decision: routingResult.decision,
          });
        }
        if (!routingResult.passthrough) {
          body.model = routingResult.decision.dispatchTarget;
          outgoingBody = Buffer.from(JSON.stringify(body));
        } else if (forcedModel) {
          body.model = forcedModel;
          outgoingBody = Buffer.from(JSON.stringify(body));
        }
      }

      if (apiKeyRequired && apiKeyNeedsQuotaConsume(apiKeyAuthorization)) {
        const authorization = apiKeyAuthorized(req, decisionStore, { consume: true });
        if (!authorization.ok) return rejectApiKeyAuthorization(res, authorization);
      }

      return proxyFetch({
        req,
        res,
        bodyBuffer: outgoingBody,
        config: activeConfig,
        fetchImpl,
        routingResult,
        logStore,
        metrics,
      });
    } catch (error) {
      logger.error(error);
      if (!res.headersSent) {
        jsonResponse(res, error.status || 500, {
          error: { message: error.message, type: "smart_router_error" },
        });
      } else {
        res.destroy(error);
      }
    }
  });

  return {
    server,
    get config() { return currentConfig; },
    configManager: manager,
    engine,
    classifier,
    catalog,
    metrics,
    affinity,
    decisionStore,
    sessions,
    storageReady,
    startBackgroundServices() {
      catalog.start();
      classifier.warm();
      this.cleanupTimer = setInterval(() => decisionStore.cleanup(), 24 * 60 * 60 * 1000);
      this.cleanupTimer.unref?.();
    },
    stopBackgroundServices() {
      catalog.stop();
      if (this.cleanupTimer) clearInterval(this.cleanupTimer);
      decisionStore.close();
    },
  };
}

export async function start() {
  const app = createSmartRouter();
  await app.storageReady;
  app.startBackgroundServices();
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(app.config.server.port, app.config.server.host, resolve);
  });
  console.log(`9Router Gateway listening on http://${app.config.server.host}:${app.config.server.port}`);
  console.log(`Forwarding to ${app.config.upstream.baseUrl}`);

  const shutdown = () => {
    app.stopBackgroundServices();
    app.server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
