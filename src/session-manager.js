import crypto from "node:crypto";

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export class SessionManager {
  constructor({ ttlMs, sessionTtlMs = ttlMs, maxAttempts = 5, attemptWindowMs = 60_000 }) {
    this.ttlMs = sessionTtlMs;
    this.maxAttempts = maxAttempts;
    this.attemptWindowMs = attemptWindowMs;
    this.sessions = new Map();
    this.attempts = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
    for (const [ip, attempt] of this.attempts) if (attempt.resetAt <= now) this.attempts.delete(ip);
  }

  authenticate(ip, candidate, configuredKeyOrSecure = false, secure = false) {
    const expectedKey = typeof configuredKeyOrSecure === "string" ? configuredKeyOrSecure : null;
    const useSecureCookie = typeof configuredKeyOrSecure === "boolean" ? configuredKeyOrSecure : secure;
    this.cleanup();
    const now = Date.now();
    const attempt = this.attempts.get(ip);
    if (attempt && attempt.count >= this.maxAttempts && attempt.resetAt > now) {
      const error = new Error("Too many login attempts");
      error.status = 429;
      throw error;
    }
    const verified = this.adminPasswordVerifier
      ? this.adminPasswordVerifier(candidate)
      : expectedKey
        ? safeEqual(candidate, expectedKey)
        : false;
    if (!candidate || !verified) {
      this.attempts.set(ip, {
        count: (attempt?.count || 0) + 1,
        resetAt: attempt?.resetAt > now ? attempt.resetAt : now + this.attemptWindowMs,
      });
      const error = new Error("Invalid admin password");
      error.status = 401;
      throw error;
    }
    this.attempts.delete(ip);
    const id = crypto.randomBytes(32).toString("base64url");
    const csrfToken = crypto.randomBytes(24).toString("base64url");
    const expiresAt = now + this.ttlMs;
    this.sessions.set(id, { csrfToken, expiresAt });
    return {
      session: { csrfToken, expiresAt },
      cookie: `smart_router_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(this.ttlMs / 1000)}${useSecureCookie ? "; Secure" : ""}`,
    };
  }

  setPasswordVerifier(verifier) {
    this.adminPasswordVerifier = verifier;
  }

  get(req) {
    this.cleanup();
    const id = parseCookies(req.headers.cookie).smart_router_session;
    if (!id) return null;
    const session = this.sessions.get(id);
    return session ? { id, ...session } : null;
  }

  require(req, { csrf = false } = {}) {
    const session = this.get(req);
    if (!session) {
      const error = new Error("Authentication required");
      error.status = 401;
      throw error;
    }
    if (csrf && !safeEqual(req.headers["x-csrf-token"] || "", session.csrfToken)) {
      const error = new Error("Invalid CSRF token");
      error.status = 403;
      throw error;
    }
    return session;
  }

  logout(req) {
    const session = this.get(req);
    if (session) this.sessions.delete(session.id);
    return "smart_router_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
  }
}
