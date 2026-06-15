import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function json(value, fallback = null) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

const ADMIN_PASSWORD_KEY = "admin_password";
const DEFAULT_ADMIN_PASSWORD = "smart9router";

function encodeAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("base64url");
  return JSON.stringify({ salt, hash, iterations: 120000, algorithm: "sha256" });
}

function verifyAdminPassword(password, stored) {
  if (!stored) return false;
  try {
    const record = JSON.parse(stored);
    const hash = crypto.pbkdf2Sync(
      String(password),
      String(record.salt),
      Number(record.iterations) || 120000,
      32,
      String(record.algorithm) || "sha256",
    ).toString("base64url");
    const left = Buffer.from(hash);
    const right = Buffer.from(String(record.hash || ""));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function encodeApiKeySecret(secret) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(String(secret), salt, 120000, 32, "sha256").toString("base64url");
  return JSON.stringify({ salt, hash, iterations: 120000, algorithm: "sha256" });
}

function verifySecret(secret, stored) {
  if (!stored) return false;
  try {
    const record = JSON.parse(stored);
    const hash = crypto.pbkdf2Sync(
      String(secret),
      String(record.salt),
      Number(record.iterations) || 120000,
      32,
      String(record.algorithm) || "sha256",
    ).toString("base64url");
    const left = Buffer.from(hash);
    const right = Buffer.from(String(record.hash || ""));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function generateApiKeySecret() {
  return `sk-${crypto.randomBytes(32).toString("base64url")}`;
}

function generateApiKeyId() {
  return `key_${crypto.randomBytes(12).toString("base64url")}`;
}

function percentile(values, percent) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1)];
}

export class DecisionStore {
  constructor({ directory, retentionDays = 30, logger = console }) {
    this.directory = directory;
    this.retentionDays = retentionDays;
    this.logger = logger;
    this.ready = false;
    this.lastError = null;
    this.buffer = [];
    this.maxBuffer = 1000;
    this.db = null;
  }

  async init() {
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      const { DatabaseSync } = await import("node:sqlite");
      this.db = new DatabaseSync(path.join(this.directory, "router.sqlite"));
      this.db.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS decisions (
          requestId TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          sessionHash TEXT,
          promptHash TEXT,
          requestedModel TEXT,
          target TEXT,
          targetKey TEXT,
          task TEXT,
          complexity TEXT,
          score INTEGER,
          confidence REAL,
          mode TEXT,
          classifierUsed INTEGER,
          affinityHeld INTEGER,
          messageCount INTEGER,
          toolCount INTEGER,
          estimatedTokens INTEGER,
          client TEXT,
          prompt TEXT,
          requestJson TEXT,
          reasons TEXT,
          features TEXT,
          status INTEGER,
          latencyMs INTEGER,
          error TEXT,
          tokens TEXT
        );
        CREATE TABLE IF NOT EXISTS feedback (
          requestId TEXT PRIMARY KEY,
          rating INTEGER NOT NULL,
          expectedTarget TEXT,
          note TEXT,
          updatedAt TEXT NOT NULL,
          FOREIGN KEY(requestId) REFERENCES decisions(requestId) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS apiKeys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          secretHash TEXT NOT NULL,
          secret TEXT,
          displayPrefix TEXT,
          expiresAt TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          revokedAt TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_decisions_target ON decisions(targetKey);
        CREATE INDEX IF NOT EXISTS idx_decisions_task ON decisions(task);
        CREATE INDEX IF NOT EXISTS idx_decisions_complexity ON decisions(complexity);
        CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
        CREATE INDEX IF NOT EXISTS idx_decisions_mode ON decisions(mode);
      `);
      this.migrate();
      this.ensureAdminPassword();
      this.ready = true;
      this.lastError = null;
      this.importJsonlOnce();
      this.flushBuffer();
      this.cleanup();
    } catch (error) {
      this.ready = false;
      this.lastError = error;
      this.logger.warn?.(`[storage] degraded: ${error.message}`);
    }
  }

  migrate() {
    const columns = new Set(this.db.prepare(`PRAGMA table_info(decisions)`).all().map((column) => column.name));
    if (!columns.has("requestJson")) {
      this.db.exec(`ALTER TABLE decisions ADD COLUMN requestJson TEXT`);
    }
    const apiKeyColumns = new Set(this.db.prepare(`PRAGMA table_info(apiKeys)`).all().map((column) => column.name));
    if (apiKeyColumns.size && !apiKeyColumns.has("displayPrefix")) {
      this.db.exec(`ALTER TABLE apiKeys ADD COLUMN displayPrefix TEXT`);
    }
    if (apiKeyColumns.size && !apiKeyColumns.has("secret")) {
      this.db.exec(`ALTER TABLE apiKeys ADD COLUMN secret TEXT`);
    }
    if (apiKeyColumns.size && !apiKeyColumns.has("active")) {
      this.db.exec(`ALTER TABLE apiKeys ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
    }
    if (apiKeyColumns.size && !apiKeyColumns.has("revokedAt")) {
      this.db.exec(`ALTER TABLE apiKeys ADD COLUMN revokedAt TEXT`);
    }
    this.db.exec(`UPDATE apiKeys SET active=0 WHERE revokedAt IS NOT NULL`);
  }

  ensureAdminPassword() {
    const current = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(ADMIN_PASSWORD_KEY)?.value;
    if (!current) this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(ADMIN_PASSWORD_KEY, encodeAdminPassword(DEFAULT_ADMIN_PASSWORD));
  }

  getAdminPasswordRecord() {
    return this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(ADMIN_PASSWORD_KEY)?.value || null;
  }

  verifyAdminPassword(candidate) {
    return verifyAdminPassword(candidate, this.getAdminPasswordRecord());
  }

  setAdminPassword(password) {
    this.execute(() => this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`)
      .run(ADMIN_PASSWORD_KEY, encodeAdminPassword(password)));
  }

  listApiKeys() {
    if (!this.ready) return [];
    const now = new Date().toISOString();
    return this.db.prepare(`
      SELECT id,name,secret,displayPrefix,expiresAt,active,createdAt,updatedAt
      FROM apiKeys
      ORDER BY createdAt DESC
    `).all().map((row) => ({
      ...row,
      displayPrefix: row.displayPrefix || `${row.id.slice(0, 10)}...`,
      active: Boolean(row.active),
      status: row.expiresAt && row.expiresAt <= now ? "expired" : row.active ? "active" : "inactive",
    }));
  }

  createApiKey({ name, expiresAt = null }) {
    const now = new Date().toISOString();
    const id = generateApiKeyId();
    const secret = generateApiKeySecret();
    const displayPrefix = `${secret.slice(0, 10)}...`;
    this.execute(() => this.db.prepare(`
      INSERT INTO apiKeys(id,name,secretHash,secret,displayPrefix,expiresAt,active,revokedAt,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(id, name, encodeApiKeySecret(secret), secret, displayPrefix, expiresAt, 1, null, now, now));
    return { id, name, displayPrefix, expiresAt, active: true, createdAt: now, updatedAt: now, secret };
  }

  setApiKeyActive(id, active) {
    const now = new Date().toISOString();
    this.execute(() => this.db.prepare(`
      UPDATE apiKeys SET active=?, revokedAt=NULL, updatedAt=? WHERE id=?
    `).run(Number(active), now, id));
    return this.getApiKey(id);
  }

  deleteApiKey(id) {
    if (!this.ready) return false;
    return Number(this.db.prepare(`DELETE FROM apiKeys WHERE id=?`).run(id).changes || 0) > 0;
  }

  getApiKey(id) {
    if (!this.ready) return null;
    const row = this.db.prepare(`SELECT id,name,secret,displayPrefix,expiresAt,active,createdAt,updatedAt FROM apiKeys WHERE id=?`).get(id);
    if (!row) return null;
    const now = new Date().toISOString();
    return {
      ...row,
      displayPrefix: row.displayPrefix || `${row.id.slice(0, 10)}...`,
      active: Boolean(row.active),
      status: row.expiresAt && row.expiresAt <= now ? "expired" : row.active ? "active" : "inactive",
    };
  }

  verifyApiKey(candidate) {
    if (!this.ready || !candidate) return false;
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT secretHash, expiresAt
      FROM apiKeys
      WHERE active=1
    `).all();
    return rows.some((row) => (!row.expiresAt || row.expiresAt > now) && verifySecret(candidate, row.secretHash));
  }

  execute(operation) {
    if (!this.ready || !this.db) {
      if (this.buffer.length < this.maxBuffer) this.buffer.push(operation);
      return;
    }
    try {
      operation();
      this.lastError = null;
    } catch (error) {
      this.lastError = error;
      this.logger.warn?.(`[storage] write failed: ${error.message}`);
    }
  }

  flushBuffer() {
    if (!this.ready) return;
    const buffered = this.buffer.splice(0);
    for (const operation of buffered) this.execute(operation);
  }

  decision(record) {
    this.execute(() => this.db.prepare(`
      INSERT OR REPLACE INTO decisions (
        requestId,timestamp,sessionHash,promptHash,requestedModel,target,targetKey,task,complexity,
        score,confidence,mode,classifierUsed,affinityHeld,messageCount,toolCount,estimatedTokens,
        client,prompt,requestJson,reasons,features
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      record.requestId, record.timestamp, record.sessionHash, record.promptHash,
      record.requestedModel, record.target, record.targetKey, record.task, record.complexity,
      record.score, record.confidence, record.mode, Number(record.classifierUsed),
      Number(record.affinityHeld), record.messageCount, record.toolCount, record.estimatedTokens,
      record.client, record.prompt || null, record.request ? JSON.stringify(record.request) : null, JSON.stringify(record.reasons || []),
      JSON.stringify(record.features || null),
    ));
  }

  outcome(record) {
    this.execute(() => this.db.prepare(`
      UPDATE decisions SET status=?, latencyMs=?, error=?, tokens=? WHERE requestId=?
    `).run(record.status, record.latencyMs, record.error, JSON.stringify(record.tokens), record.requestId));
  }

  feedback(record) {
    this.execute(() => this.db.prepare(`
      INSERT INTO feedback(requestId,rating,expectedTarget,note,updatedAt) VALUES(?,?,?,?,?)
      ON CONFLICT(requestId) DO UPDATE SET rating=excluded.rating,expectedTarget=excluded.expectedTarget,
      note=excluded.note,updatedAt=excluded.updatedAt
    `).run(
      record.requestId, record.rating, record.expectedTarget || null, record.note || null,
      record.updatedAt || new Date().toISOString(),
    ));
  }

  clearFeedback(requestId) {
    this.execute(() => this.db.prepare(`DELETE FROM feedback WHERE requestId=?`).run(requestId));
  }

  clearDecisions() {
    this.execute(() => this.db.exec(`DELETE FROM decisions; DELETE FROM feedback;`));
  }

  importJsonlOnce() {
    const marker = this.db.prepare(`SELECT value FROM meta WHERE key='jsonlImported'`).get();
    if (marker) return;
    const decisionsFile = path.join(this.directory, "decisions.jsonl");
    const feedbackFile = path.join(this.directory, "feedback.jsonl");
    if (fs.existsSync(decisionsFile)) {
      for (const line of fs.readFileSync(decisionsFile, "utf8").split("\n").filter(Boolean)) {
        try {
          const record = JSON.parse(line);
          if (record.event === "decision") this.decision(record);
          if (record.event === "outcome") this.outcome(record);
        } catch {}
      }
    }
    if (fs.existsSync(feedbackFile)) {
      for (const line of fs.readFileSync(feedbackFile, "utf8").split("\n").filter(Boolean)) {
        try { this.feedback(JSON.parse(line)); } catch {}
      }
    }
    this.db.prepare(`INSERT OR REPLACE INTO meta(key,value) VALUES('jsonlImported',?)`).run(new Date().toISOString());
  }

  cleanup(now = Date.now()) {
    if (!this.ready) return 0;
    const cutoff = new Date(now - this.retentionDays * 86400000).toISOString();
    return Number(this.db.prepare(`DELETE FROM decisions WHERE timestamp < ?`).run(cutoff).changes || 0);
  }

  list({ limit = 50, cursor, target, task, complexity, status, mode } = {}) {
    if (!this.ready) return { items: [], nextCursor: null, degraded: true };
    const where = [];
    const params = [];
    if (cursor) { where.push("d.timestamp < ?"); params.push(cursor); }
    for (const [column, value] of [["targetKey", target], ["task", task], ["complexity", complexity], ["status", status], ["mode", mode]]) {
      if (value !== undefined && value !== null && value !== "") {
        where.push(`d.${column} = ?`);
        params.push(value);
      }
    }
    const size = Math.min(100, Math.max(1, Number(limit) || 50));
    const rows = this.db.prepare(`
      SELECT d.*,f.rating,f.expectedTarget,f.note,f.updatedAt AS feedbackUpdatedAt
      FROM decisions d LEFT JOIN feedback f ON f.requestId=d.requestId
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY d.timestamp DESC LIMIT ?
    `).all(...params, size + 1);
    const hasMore = rows.length > size;
    const items = rows.slice(0, size).map((row) => this.mapRow(row));
    return { items, nextCursor: hasMore ? items.at(-1).timestamp : null, degraded: false };
  }

  get(requestId) {
    if (!this.ready) return null;
    const row = this.db.prepare(`
      SELECT d.*,f.rating,f.expectedTarget,f.note,f.updatedAt AS feedbackUpdatedAt
      FROM decisions d LEFT JOIN feedback f ON f.requestId=d.requestId WHERE d.requestId=?
    `).get(requestId);
    return row ? this.mapRow(row) : null;
  }

  mapRow(row) {
    return {
      ...row,
      classifierUsed: Boolean(row.classifierUsed),
      affinityHeld: Boolean(row.affinityHeld),
      reasons: json(row.reasons, []),
      features: json(row.features),
      tokens: json(row.tokens),
      request: json(row.requestJson),
      feedback: row.rating ? {
        rating: row.rating,
        expectedTarget: row.expectedTarget,
        note: row.note,
        updatedAt: row.feedbackUpdatedAt,
      } : null,
    };
  }

  analytics({ from, to } = {}) {
    const end = to || new Date().toISOString();
    const start = from || new Date(Date.now() - 24 * 3600000).toISOString();
    if (!this.ready) {
      return {
        degraded: true,
        from: start,
        to: end,
        total: 0,
        completed: 0,
        successRate: 0,
        p95LatencyMs: 0,
        tokenTotal: 0,
        classifierUsageRate: 0,
        affinityHoldRate: 0,
        byTarget: {},
        byTask: {},
        byComplexity: {},
        byStatus: {},
        timeline: [],
      };
    }
    const rows = this.db.prepare(`
      SELECT * FROM decisions WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC
    `).all(start, end);
    const countBy = (key) => Object.fromEntries([...rows.reduce((map, row) => {
      const value = row[key] ?? "unknown";
      map.set(value, (map.get(value) || 0) + 1);
      return map;
    }, new Map())]);
    const completed = rows.filter((row) => row.status != null);
    const latencies = completed.map((row) => row.latencyMs).filter(Number.isFinite);
    const tokenTotal = completed.reduce((sum, row) => sum + (json(row.tokens, {})?.totalTokens || 0), 0);
    const buckets = new Map();
    for (const row of rows) {
      const date = new Date(row.timestamp);
      date.setMinutes(0, 0, 0);
      const key = date.toISOString();
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return {
      degraded: false,
      from: start,
      to: end,
      total: rows.length,
      completed: completed.length,
      successRate: completed.length ? completed.filter((row) => row.status >= 200 && row.status < 400).length / completed.length : 0,
      p95LatencyMs: percentile(latencies, 0.95),
      tokenTotal,
      classifierUsageRate: rows.length ? rows.filter((row) => row.classifierUsed).length / rows.length : 0,
      affinityHoldRate: rows.length ? rows.filter((row) => row.affinityHeld).length / rows.length : 0,
      byTarget: countBy("targetKey"),
      byTask: countBy("task"),
      byComplexity: countBy("complexity"),
      byStatus: countBy("status"),
      timeline: [...buckets].map(([timestamp, requests]) => ({ timestamp, requests })),
    };
  }

  status() {
    return {
      ready: this.ready,
      error: this.lastError?.message || null,
      bufferedEvents: this.buffer.length,
      retentionDays: this.retentionDays,
    };
  }

  close() {
    this.db?.close();
  }
}
