import assert from "node:assert/strict";
import test from "node:test";
import { createAdminApi } from "../src/admin-api.js";

function response() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(payload) { this.body = JSON.parse(Buffer.from(payload).toString("utf8")); },
  };
}

test("prompt correction reset reports degraded storage", async () => {
  const metrics = [];
  const handleAdmin = createAdminApi({
    configManager: {},
    sessions: { require() {} },
    store: {
      clearPromptCorrections: () => ({ deactivated: 0, degraded: true }),
      status: () => ({ error: "storage offline" }),
    },
    engine: {},
    catalog: { ready: true, models: new Set() },
    classifier: {},
    affinity: {},
    metrics: { increment: (name, labels) => metrics.push({ name, labels }) },
    getConfig: () => ({ server: { maxBodyBytes: 1024 } }),
    corrector: null,
  });
  const res = response();

  assert.equal(await handleAdmin({ method: "DELETE", headers: {} }, res, "/api/admin/prompt-corrections", new URLSearchParams()), true);
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: "storage offline" });
  assert.deepEqual(metrics, [{ name: "smart_router_prompt_corrections_reset_total", labels: { result: "degraded" } }]);
});
