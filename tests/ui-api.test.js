import assert from "node:assert/strict";
import test from "node:test";
import { api, listPayloadItems, setCsrfToken, setUnauthorizedHandler } from "../ui/src/api.js";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("normalizes list payload shapes for guardrails ui", () => {
  const key = { id: "key-1", name: "CLI" };
  assert.deepEqual(listPayloadItems({ items: [key] }), [key]);
  assert.deepEqual(listPayloadItems({ keys: [key] }), [key]);
  assert.deepEqual(listPayloadItems([key]), [key]);
  assert.deepEqual(listPayloadItems({}), []);
  assert.deepEqual(listPayloadItems(null), []);
});

test("notifies once when concurrent authenticated requests return 401", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
    setUnauthorizedHandler(null);
    setCsrfToken("");
  });

  let notifications = 0;
  setCsrfToken("csrf");
  setUnauthorizedHandler(() => { notifications += 1; });
  globalThis.fetch = async () => jsonResponse(401, { error: "Authentication required" });

  const results = await Promise.allSettled([
    api("/api/admin/status"),
    api("/api/admin/config"),
  ]);

  assert.equal(results.every((result) => result.status === "rejected"), true);
  assert.equal(notifications, 1);

  let retryHeaders;
  globalThis.fetch = async (_path, options) => {
    retryHeaders = options.headers;
    return jsonResponse(200, { ok: true });
  };
  await api("/api/admin/config", { method: "PATCH", body: "{}" });
  assert.equal(retryHeaders["x-csrf-token"], undefined);
});

test("does not treat a failed login as an expired session", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
    setUnauthorizedHandler(null);
    setCsrfToken("");
  });

  let notifications = 0;
  setUnauthorizedHandler(() => { notifications += 1; });
  globalThis.fetch = async () => jsonResponse(401, { error: "Invalid admin password" });

  await assert.rejects(
    api("/api/admin/session", {
      method: "POST",
      skipUnauthorized: true,
      body: JSON.stringify({ password: "wrong" }),
    }),
    (error) => error.status === 401,
  );
  assert.equal(notifications, 0);
});

test("ignores a delayed 401 from an older authenticated session", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
    setUnauthorizedHandler(null);
    setCsrfToken("");
  });

  let resolveRequest;
  const response = new Promise((resolve) => { resolveRequest = resolve; });
  let notifications = 0;
  setCsrfToken("old");
  setUnauthorizedHandler(() => { notifications += 1; });
  globalThis.fetch = async () => response;

  const request = api("/api/admin/status");
  setCsrfToken("new");
  resolveRequest(jsonResponse(401, { error: "Authentication required" }));

  await assert.rejects(request, (error) => error.status === 401);
  assert.equal(notifications, 0);
});
