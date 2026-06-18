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
const RUNTIME_CONFIG_KEY = "runtime_config";
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

function apiKeyLookup(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

function generateApiKeySecret() {
  return `sk-${crypto.randomBytes(32).toString("base64url")}`;
}

function generateApiKeyId() {
  return `key_${crypto.randomBytes(12).toString("base64url")}`;
}

function quotaPeriodKey(period, date = new Date()) {
  if (period === "day") return date.toISOString().slice(0, 10);
  if (period === "month") return date.toISOString().slice(0, 7);
  return null;
}

function normalizeQuota({ quotaPeriod = null, quotaLimit = null } = {}) {
  const period = quotaPeriod === undefined ? null : quotaPeriod;
  const limit = quotaLimit === undefined ? null : quotaLimit;
  if (period === null || period === "") return { quotaPeriod: null, quotaLimit: null };
  if (period !== "day" && period !== "month") throw new Error("quotaPeriod must be day, month, or null");
  const parsedLimit = Number(limit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit <= 0) throw new Error("quotaLimit must be a positive integer");
  return { quotaPeriod: period, quotaLimit: parsedLimit };
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
        CREATE TABLE IF NOT EXISTS correctionRuns (
          id TEXT PRIMARY KEY,
          createdAt TEXT NOT NULL,
          appliedAt TEXT,
          status TEXT NOT NULL,
          judgeModel TEXT NOT NULL,
          filtersJson TEXT,
          requestedCount INTEGER NOT NULL,
          eligibleCount INTEGER NOT NULL,
          promptVersion TEXT NOT NULL,
          configRevision TEXT NOT NULL,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS correctionItems (
          runId TEXT NOT NULL,
          requestId TEXT NOT NULL,
          eligible INTEGER NOT NULL,
          skipReason TEXT,
          verdict TEXT,
          expectedTargetKey TEXT,
          expectedTarget TEXT,
          confidence REAL,
          rationale TEXT,
          applyDefault INTEGER NOT NULL DEFAULT 0,
          applied INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(runId, requestId),
          FOREIGN KEY(runId) REFERENCES correctionRuns(id) ON DELETE CASCADE,
          FOREIGN KEY(requestId) REFERENCES decisions(requestId) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS promptCorrections (
          promptHash TEXT PRIMARY KEY,
          expectedTargetKey TEXT NOT NULL,
          expectedTarget TEXT NOT NULL,
          sourceRequestId TEXT NOT NULL,
          correctionRunId TEXT NOT NULL,
          confidence REAL NOT NULL,
          rationale TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          FOREIGN KEY(sourceRequestId) REFERENCES decisions(requestId) ON DELETE CASCADE,
          FOREIGN KEY(correctionRunId) REFERENCES correctionRuns(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS apiKeys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          secretHash TEXT NOT NULL,
          secretLookup TEXT,
          secret TEXT,
          displayPrefix TEXT,
          expiresAt TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          revokedAt TEXT,
          quotaPeriod TEXT,
          quotaLimit INTEGER,
          forcedModel TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS apiKeyUsage (
          apiKeyId TEXT NOT NULL,
          periodKey TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          updatedAt TEXT NOT NULL,
          PRIMARY KEY(apiKeyId, periodKey),
          FOREIGN KEY(apiKeyId) REFERENCES apiKeys(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_decisions_target ON decisions(targetKey);
        CREATE INDEX IF NOT EXISTS idx_decisions_task ON decisions(task);
        CREATE INDEX IF NOT EXISTS idx_decisions_complexity ON decisions(complexity);
        CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
        CREATE INDEX IF NOT EXISTS idx_decisions_mode ON decisions(mode);
        CREATE INDEX IF NOT EXISTS idx_correction_items_run ON correctionItems(runId);
        CREATE INDEX IF NOT EXISTS idx_prompt_corrections_active ON promptCorrections(active);
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
    if (apiKeyColumns.size && !apiKeyColumns.has("secretLookup")) {
      this.db.exec(`ALTER TABLE apiKeys ADD COLUMN secretLookup TEXT`);
    }
    if (apiKeyColumns.size && !apiKeyColumns.has("active")) {
      this.db.exec(`ALTER TABLE apiKeys ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
    }
    if (apiKeyColumns.size && !apiKeyColumns.has("revokedAt")) {
      this.db.exec(`ALTER TABLE apiKeys ADD COLUMN revokedAt TEXT`);
    }
    if (apiKeyColumns.size && !apiKeyColumns.has("quotaPeriod")) {
      this.db.exec(`ALTER TABLE apiKeys ADD COLUMN quotaPeriod TEXT`);
    }
    if (apiKeyColumns.size && !apiKeyColumns.has("quotaLimit")) {
      this.db.exec(`ALTER TABLE apiKeys ADD COLUMN quotaLimit INTEGER`);
    }
    if (apiKeyColumns.size && !apiKeyColumns.has("forcedModel")) {
      this.db.exec(`ALTER TABLE apiKeys ADD COLUMN forcedModel TEXT`);
    }
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_secret_lookup ON apiKeys(secretLookup) WHERE secretLookup IS NOT NULL;
      CREATE TABLE IF NOT EXISTS apiKeyUsage (
        apiKeyId TEXT NOT NULL,
        periodKey TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY(apiKeyId, periodKey),
        FOREIGN KEY(apiKeyId) REFERENCES apiKeys(id) ON DELETE CASCADE
      );
    `);
    const lookupRows = this.db.prepare(`SELECT id,secret FROM apiKeys WHERE secretLookup IS NULL AND secret IS NOT NULL`).all();
    const updateLookup = this.db.prepare(`UPDATE apiKeys SET secretLookup=? WHERE id=?`);
    for (const row of lookupRows) updateLookup.run(apiKeyLookup(row.secret), row.id);
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

  getRuntimeConfig() {
    if (!this.ready) return null;
    const value = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(RUNTIME_CONFIG_KEY)?.value;
    return json(value, null);
  }

  setRuntimeConfig(config) {
    this.execute(() => this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`)
      .run(RUNTIME_CONFIG_KEY, JSON.stringify(config || {})));
  }

  clearRuntimeConfig() {
    this.execute(() => this.db.prepare(`DELETE FROM meta WHERE key = ?`).run(RUNTIME_CONFIG_KEY));
  }

  listApiKeys() {
    if (!this.ready) return [];
    const now = new Date();
    return this.db.prepare(`
      SELECT id,name,secret,displayPrefix,expiresAt,active,quotaPeriod,quotaLimit,forcedModel,createdAt,updatedAt
      FROM apiKeys
      ORDER BY createdAt DESC
    `).all().map((row) => this.apiKeyRecord(row, now));
  }

  createApiKey({ name, expiresAt = null, quotaPeriod = null, quotaLimit = null, forcedModel = null }) {
    const now = new Date().toISOString();
    const id = generateApiKeyId();
    const secret = generateApiKeySecret();
    const displayPrefix = `${secret.slice(0, 10)}...`;
    const quota = normalizeQuota({ quotaPeriod, quotaLimit });
    this.execute(() => this.db.prepare(`
      INSERT INTO apiKeys(id,name,secretHash,secretLookup,secret,displayPrefix,expiresAt,active,revokedAt,quotaPeriod,quotaLimit,forcedModel,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, name, encodeApiKeySecret(secret), apiKeyLookup(secret), secret, displayPrefix, expiresAt, 1, null, quota.quotaPeriod, quota.quotaLimit, forcedModel, now, now));
    return this.apiKeyRecord({ id, name, displayPrefix, expiresAt, active: 1, ...quota, forcedModel, createdAt: now, updatedAt: now, secret }, new Date(now));
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
    const row = this.db.prepare(`SELECT id,name,secret,displayPrefix,expiresAt,active,quotaPeriod,quotaLimit,forcedModel,createdAt,updatedAt FROM apiKeys WHERE id=?`).get(id);
    if (!row) return null;
    return this.apiKeyRecord(row);
  }

  setApiKeyQuota(id, quotaPeriod, quotaLimit) {
    const now = new Date().toISOString();
    const quota = normalizeQuota({ quotaPeriod, quotaLimit });
    this.execute(() => this.db.prepare(`
      UPDATE apiKeys SET quotaPeriod=?, quotaLimit=?, updatedAt=? WHERE id=?
    `).run(quota.quotaPeriod, quota.quotaLimit, now, id));
    return this.getApiKey(id);
  }

  setApiKeyForcedModel(id, forcedModel) {
    const now = new Date().toISOString();
    const normalized = forcedModel ? String(forcedModel).trim() : null;
    this.execute(() => this.db.prepare(`
      UPDATE apiKeys SET forcedModel=?, updatedAt=? WHERE id=?
    `).run(normalized || null, now, id));
    return this.getApiKey(id);
  }

  apiKeyRecord(row, date = new Date()) {
    const periodKey = quotaPeriodKey(row.quotaPeriod, date);
    const quotaUsed = periodKey
      ? Number(this.db.prepare(`SELECT count FROM apiKeyUsage WHERE apiKeyId=? AND periodKey=?`).get(row.id, periodKey)?.count || 0)
      : 0;
    const quotaLimit = row.quotaLimit == null ? null : Number(row.quotaLimit);
    const limited = quotaLimit != null && quotaUsed >= quotaLimit;
    const expired = row.expiresAt && row.expiresAt <= date.toISOString();
    return {
      ...row,
      displayPrefix: row.displayPrefix || `${row.id.slice(0, 10)}...`,
      active: Boolean(row.active),
      quotaPeriod: row.quotaPeriod || null,
      quotaLimit,
      forcedModel: row.forcedModel || null,
      quotaUsed,
      quotaRemaining: quotaLimit == null ? null : Math.max(0, quotaLimit - quotaUsed),
      quotaPeriodKey: periodKey,
      status: expired ? "expired" : row.active ? (limited ? "limited" : "active") : "inactive",
    };
  }

  verifyApiKey(candidate) {
    return this.authorizeApiKey(candidate).ok;
  }

  authorizeApiKey(candidate, { consume = false, now = new Date() } = {}) {
    if (!this.ready || !candidate) return { ok: false, reason: "missing" };
    const selectColumns = `id,name,secretHash,secret,displayPrefix,expiresAt,active,quotaPeriod,quotaLimit,forcedModel,createdAt,updatedAt`;
    const lookup = apiKeyLookup(candidate);
    let row = this.db.prepare(`
      SELECT ${selectColumns}
      FROM apiKeys
      WHERE secretLookup=?
    `).get(lookup);
    if (row && !verifySecret(candidate, row.secretHash)) return { ok: false, reason: "invalid" };
    if (!row) {
      const rows = this.db.prepare(`
      SELECT ${selectColumns}
      FROM apiKeys
      WHERE secretLookup IS NULL
    `).all();
      row = rows.find((item) => verifySecret(candidate, item.secretHash));
      if (row) this.execute(() => this.db.prepare(`UPDATE apiKeys SET secretLookup=? WHERE id=?`).run(lookup, row.id));
    }
    if (!row) return { ok: false, reason: "invalid" };
    if (!row.active) return { ok: false, reason: "inactive", key: this.apiKeyRecord(row, now) };
    if (row.expiresAt && row.expiresAt <= now.toISOString()) return { ok: false, reason: "expired", key: this.apiKeyRecord(row, now) };
    const periodKey = quotaPeriodKey(row.quotaPeriod, now);
    if (!periodKey || row.quotaLimit == null) return { ok: true, key: this.apiKeyRecord(row, now) };

    let used = 0;
    try {
      if (consume) this.db.exec(`BEGIN IMMEDIATE`);
      const current = this.db.prepare(`SELECT count FROM apiKeyUsage WHERE apiKeyId=? AND periodKey=?`).get(row.id, periodKey);
      used = Number(current?.count || 0);
      if (used >= Number(row.quotaLimit)) {
        if (consume) this.db.exec(`ROLLBACK`);
        return { ok: false, reason: "quota_exceeded", key: this.apiKeyRecord(row, now) };
      }
      if (consume) {
        const timestamp = now.toISOString();
        this.db.prepare(`
          INSERT INTO apiKeyUsage(apiKeyId,periodKey,count,updatedAt)
          VALUES(?,?,1,?)
          ON CONFLICT(apiKeyId,periodKey) DO UPDATE SET count=count+1, updatedAt=excluded.updatedAt
        `).run(row.id, periodKey, timestamp);
        this.db.exec(`COMMIT`);
        used += 1;
      }
    } catch (error) {
      if (consume) {
        try { this.db.exec(`ROLLBACK`); } catch {}
      }
      throw error;
    }
    return { ok: true, key: this.apiKeyRecord({ ...row, quotaUsed: used }, now) };
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
    this.execute(() => this.db.exec(`DELETE FROM promptCorrections; DELETE FROM correctionItems; DELETE FROM correctionRuns; DELETE FROM decisions; DELETE FROM feedback;`));
  }

  resetDatabase() {
    if (!this.ready) return false;
    try {
      const adminPassword = this.getAdminPasswordRecord();
      const jsonlImported = this.db.prepare(`SELECT value FROM meta WHERE key='jsonlImported'`).get()?.value || new Date().toISOString();
      this.db.exec(`
        DELETE FROM promptCorrections;
        DELETE FROM correctionItems;
        DELETE FROM correctionRuns;
        DELETE FROM feedback;
        DELETE FROM decisions;
        DELETE FROM apiKeyUsage;
        DELETE FROM apiKeys;
        DELETE FROM meta;
      `);
      if (adminPassword) this.db.prepare(`INSERT INTO meta(key,value) VALUES(?,?)`).run(ADMIN_PASSWORD_KEY, adminPassword);
      this.db.prepare(`INSERT INTO meta(key,value) VALUES('jsonlImported',?)`).run(jsonlImported);
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error;
      this.logger.warn?.(`[storage] reset failed: ${error.message}`);
      return false;
    }
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

  listForCorrection({ ids = [], filters = {}, limit = 25 } = {}) {
    if (!this.ready) return [];
    const where = [];
    const params = [];
    if (ids.length) {
      where.push(`d.requestId IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    } else {
      for (const [column, value] of [["targetKey", filters.target], ["task", filters.task], ["complexity", filters.complexity], ["status", filters.status], ["mode", filters.mode]]) {
        if (value !== undefined && value !== null && value !== "") {
          where.push(`d.${column} = ?`);
          params.push(value);
        }
      }
    }
    const size = Math.min(25, Math.max(1, Number(limit) || 25));
    return this.db.prepare(`
      SELECT d.*,f.rating,f.expectedTarget,f.note,f.updatedAt AS feedbackUpdatedAt
      FROM decisions d LEFT JOIN feedback f ON f.requestId=d.requestId
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY d.timestamp DESC LIMIT ?
    `).all(...params, size).map((row) => this.mapRow(row));
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

  saveCorrectionRun(run, items) {
    this.execute(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO correctionRuns(
          id,createdAt,appliedAt,status,judgeModel,filtersJson,requestedCount,eligibleCount,promptVersion,configRevision,error
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        run.id, run.createdAt, run.appliedAt || null, run.status, run.judgeModel,
        JSON.stringify(run.filters || null), run.requestedCount, run.eligibleCount,
        run.promptVersion, run.configRevision, run.error || null,
      );
      const statement = this.db.prepare(`
        INSERT OR REPLACE INTO correctionItems(
          runId,requestId,eligible,skipReason,verdict,expectedTargetKey,expectedTarget,confidence,rationale,applyDefault,applied
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      `);
      for (const item of items) {
        statement.run(
          run.id, item.requestId, Number(item.eligible), item.skipReason || null,
          item.verdict || null, item.expectedTargetKey || null, item.expectedTarget || null,
          item.confidence ?? null, item.rationale || null, Number(item.applyDefault || false),
          Number(item.applied || false),
        );
      }
    });
  }

  getCorrectionRun(runId) {
    if (!this.ready) return null;
    const run = this.db.prepare(`SELECT * FROM correctionRuns WHERE id=?`).get(runId);
    if (!run) return null;
    const items = this.db.prepare(`
      SELECT ci.*,d.promptHash,d.target,d.targetKey,d.task,d.complexity,d.score,d.confidence AS decisionConfidence
      FROM correctionItems ci JOIN decisions d ON d.requestId=ci.requestId
      WHERE ci.runId=? ORDER BY d.timestamp DESC
    `).all(runId).map((item) => ({
      ...item,
      eligible: Boolean(item.eligible),
      applyDefault: Boolean(item.applyDefault),
      applied: Boolean(item.applied),
    }));
    return { ...run, filters: json(run.filtersJson), items };
  }

  applyCorrectionRun(runId, selectedRequestIds, { minConfidence = 0.7, enablePromptCorrections = true, writePositiveFeedback = false } = {}) {
    if (!this.ready) return { appliedFeedback: 0, promptCorrections: 0, skipped: [], degraded: true };
    const selected = new Set(selectedRequestIds || []);
    const run = this.getCorrectionRun(runId);
    if (!run) return null;
    const now = new Date().toISOString();
    let appliedFeedback = 0;
    let promptCorrections = 0;
    const skipped = [];
    this.execute(() => {
      for (const item of run.items) {
        if (selected.size && !selected.has(item.requestId)) continue;
        if (!item.eligible) { skipped.push({ requestId: item.requestId, reason: item.skipReason || "ineligible" }); continue; }
        if (item.applied) { skipped.push({ requestId: item.requestId, reason: "already_applied" }); continue; }
        if ((Number(item.confidence) || 0) < minConfidence) { skipped.push({ requestId: item.requestId, reason: "low_confidence" }); continue; }
        const incorrect = item.verdict === "incorrect" && item.expectedTargetKey && item.expectedTarget;
        if (!incorrect && !(writePositiveFeedback && item.verdict === "correct")) {
          skipped.push({ requestId: item.requestId, reason: "no_correction" });
          continue;
        }
        this.db.prepare(`
          INSERT INTO feedback(requestId,rating,expectedTarget,note,updatedAt) VALUES(?,?,?,?,?)
          ON CONFLICT(requestId) DO UPDATE SET rating=excluded.rating,expectedTarget=excluded.expectedTarget,
          note=excluded.note,updatedAt=excluded.updatedAt
        `).run(
          item.requestId,
          incorrect ? 2 : 5,
          incorrect ? item.expectedTarget : null,
          item.rationale || "Batch correction reviewed by upstream model",
          now,
        );
        appliedFeedback += 1;
        if (incorrect && enablePromptCorrections && item.promptHash) {
          this.db.prepare(`
            INSERT INTO promptCorrections(
              promptHash,expectedTargetKey,expectedTarget,sourceRequestId,correctionRunId,confidence,rationale,active,createdAt,updatedAt
            ) VALUES(?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(promptHash) DO UPDATE SET expectedTargetKey=excluded.expectedTargetKey,
            expectedTarget=excluded.expectedTarget,sourceRequestId=excluded.sourceRequestId,
            correctionRunId=excluded.correctionRunId,confidence=excluded.confidence,
            rationale=excluded.rationale,active=1,updatedAt=excluded.updatedAt
          `).run(
            item.promptHash, item.expectedTargetKey, item.expectedTarget, item.requestId,
            runId, item.confidence, item.rationale || null, 1, now, now,
          );
          promptCorrections += 1;
        }
        this.db.prepare(`UPDATE correctionItems SET applied=1 WHERE runId=? AND requestId=?`).run(runId, item.requestId);
      }
      this.db.prepare(`UPDATE correctionRuns SET status='applied', appliedAt=? WHERE id=?`).run(now, runId);
    });
    return { runId, appliedFeedback, promptCorrections, skipped };
  }

  getPromptCorrection(promptHash) {
    if (!this.ready || !promptHash) return null;
    const row = this.db.prepare(`SELECT * FROM promptCorrections WHERE promptHash=? AND active=1`).get(promptHash);
    return row ? { ...row, active: Boolean(row.active) } : null;
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
