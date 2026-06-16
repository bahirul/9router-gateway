import assert from "node:assert/strict";
import test from "node:test";
import { runUpstreamSmoke } from "../scripts/upstream-smoke.js";

function configManager(overrides = {}) {
  return {
    get() {
      return {
        upstream: {
          baseUrl: "http://upstream.test",
          apiKey: "test-key",
          requestTimeoutMs: 15000,
          ...overrides,
        },
      };
    },
  };
}

test("upstream smoke sends configured API key and validates models", async () => {
  let observedUrl = null;
  let observedHeaders = null;
  const logs = [];

  const count = await runUpstreamSmoke({
    configManager: configManager(),
    logger: { log(message) { logs.push(message); } },
    async fetchImpl(url, options) {
      observedUrl = url;
      observedHeaders = options.headers;
      return Response.json({ data: [{ id: "smart-medium" }, { id: "smart-large" }] });
    },
  });

  assert.equal(count, 2);
  assert.equal(observedUrl, "http://upstream.test/v1/models");
  assert.equal(observedHeaders.Authorization, "Bearer test-key");
  assert.equal(observedHeaders.Accept, "application/json");
  assert.deepEqual(logs, ["9Router compatibility smoke passed with 2 models"]);
});

test("upstream smoke includes upstream response body on HTTP errors", async () => {
  await assert.rejects(
    runUpstreamSmoke({
      configManager: configManager(),
      async fetchImpl() {
        return new Response("missing auth token", { status: 401 });
      },
    }),
    /9Router \/v1\/models returned 401: missing auth token/,
  );
});

test("upstream smoke reports blocked connections without stack traces", async () => {
  const error = new TypeError("fetch failed");
  error.cause = Object.assign(new Error("connect EPERM 127.0.0.1:20128"), { code: "EPERM" });

  await assert.rejects(
    runUpstreamSmoke({
      configManager: configManager({ baseUrl: "http://127.0.0.1:20128" }),
      async fetchImpl() {
        throw error;
      },
    }),
    /Could not reach upstream 9Router at http:\/\/127\.0\.0\.1:20128\/v1\/models \(EPERM\).*rerun with network permission/,
  );
});
