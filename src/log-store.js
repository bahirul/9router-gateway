import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REQUEST_CONTEXT_BYTES = 64 * 1024;
const SENSITIVE_KEY = /authorization|api[_-]?key|token|secret|password|key/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(item),
  ]));
}

export function requestSnapshot(body) {
  const sanitized = sanitize(body);
  const serialized = JSON.stringify(sanitized);
  if (Buffer.byteLength(serialized) <= REQUEST_CONTEXT_BYTES) {
    return { body: sanitized, truncated: false };
  }
  return { body: serialized.slice(0, REQUEST_CONTEXT_BYTES), truncated: true };
}

export class LogStore {
  constructor(config, decisionStore = null) {
    this.directory = config.directory;
    this.rawPrompts = config.rawPrompts;
    this.decisionStore = decisionStore;
    fs.mkdirSync(this.directory, { recursive: true });
  }

  append(filename, record) {
    const target = path.join(this.directory, filename);
    fs.appendFile(target, `${JSON.stringify(record)}\n`, () => {});
  }

  decision({ requestId, sessionId, normalized, body, features, decision, client }) {
    const record = {
      timestamp: new Date().toISOString(),
      event: "decision",
      requestId,
      sessionHash: crypto.createHash("sha256").update(sessionId).digest("hex"),
      promptHash: normalized.promptHash,
      requestedModel: normalized.model,
      target: decision.target,
      targetKey: decision.targetKey,
      task: decision.task,
      complexity: decision.complexity,
      score: decision.score,
      confidence: decision.confidence,
      mode: decision.mode,
      classifierUsed: decision.classifierUsed,
      affinityHeld: decision.affinityHeld,
      messageCount: normalized.messageCount,
      toolCount: normalized.toolCount,
      estimatedTokens: features.estimatedTokens,
      client,
      reasons: decision.reasons,
      features: {
        chars: features.chars,
        estimatedTokens: features.estimatedTokens,
        flags: features.flags,
        ruleScore: features.ruleScore,
        ruleConfidence: features.ruleConfidence,
        hardFloor: features.hardFloor,
      },
    };
    if (this.rawPrompts) {
      record.prompt = normalized.latestUserText;
      record.request = requestSnapshot(body);
    }
    this.decisionStore?.decision(record);
    this.append("decisions.jsonl", record);
  }

  outcome({ requestId, status, latencyMs, error = null, tokens = null }) {
    const record = {
      timestamp: new Date().toISOString(),
      event: "outcome",
      requestId,
      status,
      latencyMs,
      error,
      tokens,
    };
    this.decisionStore?.outcome(record);
    this.append("decisions.jsonl", record);
  }

  feedback(record) {
    const stored = {
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.decisionStore?.feedback({ ...stored, updatedAt: stored.timestamp });
    this.append("feedback.jsonl", stored);
  }
}
