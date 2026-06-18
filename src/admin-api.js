import { packageVersion } from "./package-info.js";

function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

async function readJson(req, maxBytes) {
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
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function clientIp(req) {
  return req.socket?.remoteAddress || "unknown";
}

function secureRequest(req) {
  return Boolean(req.socket?.encrypted)
    || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function validExpiry(value) {
  if (value === null || value === undefined) return true;
  return Number.isFinite(Date.parse(value));
}

function parseQuota(body) {
  const quotaPeriod = body.quotaPeriod ?? null;
  const quotaLimit = body.quotaLimit ?? null;
  if (quotaPeriod === null || quotaPeriod === "") {
    if (quotaLimit !== null && quotaLimit !== "") return { error: "quotaLimit must be null when quotaPeriod is null" };
    return { quotaPeriod: null, quotaLimit: null };
  }
  if (quotaPeriod !== "day" && quotaPeriod !== "month") return { error: "quotaPeriod must be day, month, or null" };
  const parsedLimit = Number(quotaLimit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit <= 0) return { error: "quotaLimit must be a positive integer" };
  return { quotaPeriod, quotaLimit: parsedLimit };
}

function validateTargets(config, catalog) {
  if (!config.upstream.strictModelValidation || !catalog.ready) return;
  const targets = new Set([
    ...Object.values(config.routing.targets),
    config.routing.shadowTarget,
  ]);
  const missing = [...targets].filter((target) => !catalog.models.has(target));
  if (missing.length) {
    const error = new Error(`9Router models or combos not found: ${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

export function createAdminApi(context) {
  const {
    configManager,
    sessions,
    store,
    engine,
    catalog,
    classifier,
    affinity,
    metrics,
    getConfig,
  } = context;

  return async function handleAdmin(req, res, pathname, searchParams) {
    if (!pathname.startsWith("/api/admin/")) return false;
    const config = getConfig();

    try {
      if (pathname === "/api/admin/session" && req.method === "POST") {
        const body = await readJson(req, config.server.maxBodyBytes);
        const result = sessions.authenticate(
          clientIp(req),
          body.password || "",
          secureRequest(req),
        );
        metrics.increment("smart_router_ui_login_total", { result: "success" });
        sendJson(res, 200, {
          authenticated: true,
          csrfToken: result.session.csrfToken,
          expiresAt: result.session.expiresAt,
        }, { "Set-Cookie": result.cookie });
        return true;
      }

      if (pathname === "/api/admin/session" && req.method === "GET") {
        const session = sessions.get(req);
        sendJson(res, 200, session ? {
          authenticated: true,
          csrfToken: session.csrfToken,
          expiresAt: session.expiresAt,
        } : { authenticated: false });
        return true;
      }

      if (pathname === "/api/admin/session" && req.method === "DELETE") {
        sessions.require(req, { csrf: true });
        sendJson(res, 200, { authenticated: false }, { "Set-Cookie": sessions.logout(req) });
        return true;
      }

      const mutation = !["GET", "HEAD"].includes(req.method);
      sessions.require(req, { csrf: mutation });

      if (pathname === "/api/admin/status" && req.method === "GET") {
        const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
        const protocol = forwardedProto || (secureRequest(req) ? "https" : "http");
        const host = req.headers.host || `${config.server.host}:${config.server.port}`;
        sendJson(res, 200, {
          version: packageVersion,
          uptimeSeconds: Math.floor(process.uptime()),
          ready: catalog.ready || !config.upstream.strictModelValidation,
          catalog: {
            ready: catalog.ready,
            models: catalog.models.size,
            error: catalog.lastError?.message || null,
          },
          classifier: {
            enabled: config.classifier.enabled,
            state: !config.classifier.enabled ? "disabled" : classifier.lastError ? "degraded" : "ready",
            model: config.classifier.model,
            error: classifier.lastError?.message || null,
          },
          storage: store.status(),
          affinityEntries: affinity.size(),
          proxyBaseUrl: `${protocol}://${host}/v1`,
        });
        return true;
      }

      if (pathname === "/api/admin/catalog" && req.method === "GET") {
        sendJson(res, 200, {
          ready: catalog.ready,
          models: [...catalog.models].sort(),
          error: catalog.lastError?.message || null,
        });
        return true;
      }

      if (pathname === "/api/admin/config" && req.method === "GET") {
        sendJson(res, 200, configManager.describe());
        return true;
      }

      if (pathname === "/api/admin/config" && req.method === "PATCH") {
        const body = await readJson(req, config.server.maxBodyBytes);
        const result = await configManager.update(
          body.patch || {},
          body.expectedRevision,
          (candidate) => validateTargets(candidate, catalog),
        );
        metrics.increment("smart_router_config_updates_total", { result: "success" });
        sendJson(res, 200, result);
        return true;
      }

      if (pathname === "/api/admin/config/overrides" && req.method === "DELETE") {
        const body = await readJson(req, config.server.maxBodyBytes);
        const result = await configManager.reset(body.expectedRevision);
        metrics.increment("smart_router_config_resets_total");
        sendJson(res, 200, result);
        return true;
      }

      if (pathname === "/api/admin/api-keys" && req.method === "GET") {
        sessions.require(req, { csrf: false });
        sendJson(res, 200, { items: store.listApiKeys() });
        return true;
      }

      if (pathname === "/api/admin/api-keys" && req.method === "POST") {
        sessions.require(req, { csrf: true });
        const body = await readJson(req, config.server.maxBodyBytes);
        if (typeof body.name !== "string" || !body.name.trim()) {
          sendJson(res, 400, { error: "name is required" });
          return true;
        }
        if (!validExpiry(body.expiresAt)) {
          sendJson(res, 400, { error: "expiresAt must be a valid ISO timestamp or null" });
          return true;
        }
        const quota = parseQuota(body);
        if (quota.error) {
          sendJson(res, 400, { error: quota.error });
          return true;
        }
        const expiresAt = body.expiresAt === null || body.expiresAt === undefined ? null : String(body.expiresAt);
        const created = store.createApiKey({ name: body.name.trim(), expiresAt, ...quota });
        metrics.increment("smart_router_api_keys_total", { result: "created" });
        sendJson(res, 200, created);
        return true;
      }

      const apiKeyMatch = pathname.match(/^\/api\/admin\/api-keys\/([^/]+)$/);
      if (apiKeyMatch && req.method === "PATCH") {
        sessions.require(req, { csrf: true });
        const body = await readJson(req, config.server.maxBodyBytes);
        const id = decodeURIComponent(apiKeyMatch[1]);
        if (!store.getApiKey(id)) {
          sendJson(res, 404, { error: "API key not found" });
          return true;
        }
        if (body.active !== undefined && typeof body.active !== "boolean") {
          sendJson(res, 400, { error: "active must be a boolean" });
          return true;
        }
        let updated = body.active === undefined ? store.getApiKey(id) : store.setApiKeyActive(id, body.active);
        if (body.quotaPeriod !== undefined || body.quotaLimit !== undefined) {
          const quota = parseQuota(body);
          if (quota.error) {
            sendJson(res, 400, { error: quota.error });
            return true;
          }
          updated = store.setApiKeyQuota(id, quota.quotaPeriod, quota.quotaLimit);
        }
        metrics.increment("smart_router_api_keys_total", { result: "updated" });
        sendJson(res, 200, updated);
        return true;
      }

      if (apiKeyMatch && req.method === "DELETE") {
        sessions.require(req, { csrf: true });
        const id = decodeURIComponent(apiKeyMatch[1]);
        if (!store.getApiKey(id)) {
          sendJson(res, 404, { error: "API key not found" });
          return true;
        }
        store.deleteApiKey(id);
        metrics.increment("smart_router_api_keys_total", { result: "deleted" });
        sendJson(res, 200, { deleted: true });
        return true;
      }

      if (pathname === "/api/admin/security/password" && req.method === "PUT") {
        sessions.require(req, { csrf: true });
        const body = await readJson(req, config.server.maxBodyBytes);
        if (typeof body.currentPassword !== "string" || !store.verifyAdminPassword(body.currentPassword)) {
          sendJson(res, 401, { error: "current password is incorrect" });
          return true;
        }
        if (typeof body.password !== "string" || body.password.length < 8) {
          sendJson(res, 400, { error: "password must be at least 8 characters" });
          return true;
        }
        store.setAdminPassword(body.password);
        sendJson(res, 200, { updated: true });
        return true;
      }

      if (pathname === "/api/admin/catalog/refresh" && req.method === "POST") {
        const ready = await catalog.refresh();
        sendJson(res, ready ? 200 : 502, {
          ready,
          models: catalog.models.size,
          error: catalog.lastError?.message || null,
        });
        return true;
      }

      if (pathname === "/api/admin/explain" && req.method === "POST") {
        const envelope = await readJson(req, config.server.maxBodyBytes);
        const body = envelope.request || envelope.body || envelope;
        const requestPath = envelope.path || "/v1/chat/completions";
        const result = await engine.decide({
          pathname: requestPath,
          body,
          headers: {},
          explainOnly: true,
        });
        sendJson(res, result.error ? result.status : 200, result.error
          ? { error: result.error, partialDecision: result.decision }
          : { passthrough: result.passthrough, decision: result.decision || null, features: result.features || null });
        return true;
      }

      if (pathname === "/api/admin/analytics" && req.method === "GET") {
        sendJson(res, 200, store.analytics({
          from: searchParams.get("from") || undefined,
          to: searchParams.get("to") || undefined,
        }));
        return true;
      }

      if (pathname === "/api/admin/decisions" && req.method === "GET") {
        sendJson(res, 200, store.list({
          cursor: searchParams.get("cursor") || undefined,
          limit: searchParams.get("limit") || undefined,
          target: searchParams.get("target") || undefined,
          task: searchParams.get("task") || undefined,
          complexity: searchParams.get("complexity") || undefined,
          status: searchParams.get("status") || undefined,
          mode: searchParams.get("mode") || undefined,
        }));
        return true;
      }

      if (pathname === "/api/admin/decisions" && req.method === "DELETE") {
        store.clearDecisions();
        sendJson(res, 200, { deleted: true });
        return true;
      }

      const decisionMatch = pathname.match(/^\/api\/admin\/decisions\/([^/]+)$/);
      if (decisionMatch && req.method === "GET") {
        const item = store.get(decodeURIComponent(decisionMatch[1]));
        sendJson(res, item ? 200 : 404, item || { error: "Decision not found" });
        return true;
      }

      const feedbackMatch = pathname.match(/^\/api\/admin\/decisions\/([^/]+)\/feedback$/);
      if (feedbackMatch && req.method === "PUT") {
        const body = await readJson(req, config.server.maxBodyBytes);
        if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
          sendJson(res, 400, { error: "rating must be an integer from 1 to 5" });
          return true;
        }
        const requestId = decodeURIComponent(feedbackMatch[1]);
        if (!store.get(requestId)) {
          sendJson(res, 404, { error: "Decision not found" });
          return true;
        }
        context.logStore.feedback({
          requestId,
          rating: body.rating,
          expectedTarget: body.expectedTarget || null,
          note: body.note || null,
        });
        sendJson(res, 200, store.get(requestId));
        return true;
      }

      if (feedbackMatch && req.method === "DELETE") {
        const requestId = decodeURIComponent(feedbackMatch[1]);
        if (!store.get(requestId)) {
          sendJson(res, 404, { error: "Decision not found" });
          return true;
        }
        context.logStore.clearFeedback(requestId);
        sendJson(res, 200, store.get(requestId));
        return true;
      }

      sendJson(res, 404, { error: "Admin endpoint not found" });
      return true;
    } catch (error) {
      if (pathname === "/api/admin/session" && req.method === "POST") {
        metrics.increment("smart_router_ui_login_total", {
          result: error.status === 429 ? "rate_limited" : "failure",
        });
      }
      sendJson(res, error.status || 500, { error: error.message });
      return true;
    }
  };
}
