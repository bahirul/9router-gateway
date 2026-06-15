import assert from "node:assert/strict";
import test from "node:test";
import { AffinityStore } from "../src/affinity.js";

function decision(targetKey, targetRank) {
  return { targetKey, target: `smart-${targetKey}`, targetRank };
}

test("affinity allows escalation but prevents downgrade", () => {
  const store = new AffinityStore({ ttlMs: 1000, maxEntries: 10 });

  const medium = store.apply("session", decision("medium", 1), 100);
  const large = store.apply("session", decision("large", 3), 200);
  const attemptedSmall = store.apply("session", decision("small", 0), 300);

  assert.equal(medium.targetKey, "medium");
  assert.equal(large.targetKey, "large");
  assert.equal(attemptedSmall.targetKey, "large");
  assert.equal(attemptedSmall.affinityHeld, true);
});

test("affinity expires and enforces the entry cap", () => {
  const store = new AffinityStore({ ttlMs: 10, maxEntries: 2 });
  const now = Date.now();
  store.apply("one", decision("large", 3), now);
  store.apply("two", decision("medium", 1), now + 1);
  store.apply("three", decision("small", 0), now + 2);
  assert.equal(store.size(), 2);

  const afterExpiry = store.apply("one", decision("small", 0), now + 20);
  assert.equal(afterExpiry.targetKey, "small");
});

test("affinity preview does not mutate conversation state", () => {
  const store = new AffinityStore({ ttlMs: 1000, maxEntries: 10 });
  store.apply("session", decision("medium", 1), 100);
  const preview = store.apply("session", decision("large", 3), 200, false);
  const actual = store.apply("session", decision("small", 0), 300);

  assert.equal(preview.targetKey, "large");
  assert.equal(actual.targetKey, "medium");
});
