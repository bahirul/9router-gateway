export class AffinityStore {
  constructor({ ttlMs, maxEntries }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
  }

  apply(sessionId, decision, now = Date.now(), persist = true) {
    this.cleanup(now);
    const current = this.entries.get(sessionId);
    if (current && current.expiresAt > now && current.decision.targetRank > decision.targetRank) {
      const sticky = {
        ...decision,
        targetKey: current.decision.targetKey,
        target: current.decision.target,
        targetRank: current.decision.targetRank,
        affinityHeld: true,
        previousTarget: current.decision.target,
      };
      if (persist) {
        this.entries.delete(sessionId);
        this.entries.set(sessionId, { decision: sticky, expiresAt: now + this.ttlMs });
      }
      return sticky;
    }

    const next = {
      ...decision,
      affinityHeld: false,
      previousTarget: current?.decision.target || null,
    };
    if (persist) {
      this.entries.delete(sessionId);
      this.entries.set(sessionId, { decision: next, expiresAt: now + this.ttlMs });
    }
    return next;
  }

  size() {
    this.cleanup();
    return this.entries.size;
  }
}
