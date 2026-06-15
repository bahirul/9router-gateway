import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "../src/session-manager.js";

function request(headers = {}) {
  return { headers };
}

test("creates HttpOnly sessions and enforces CSRF on mutations", () => {
  const manager = new SessionManager({ ttlMs: 60_000 });
  const authenticated = manager.authenticate("127.0.0.1", "secret", "secret", true);
  assert.match(authenticated.cookie, /HttpOnly/);
  assert.match(authenticated.cookie, /SameSite=Strict/);
  assert.match(authenticated.cookie, /Secure/);

  const cookie = authenticated.cookie.split(";")[0];
  assert.ok(manager.require(request({ cookie })));
  assert.throws(
    () => manager.require(request({ cookie }), { csrf: true }),
    (error) => error.status === 403,
  );
  assert.ok(manager.require(request({
    cookie,
    "x-csrf-token": authenticated.session.csrfToken,
  }), { csrf: true }));

  assert.match(manager.logout(request({ cookie })), /Max-Age=0/);
  assert.throws(() => manager.require(request({ cookie })), (error) => error.status === 401);
});

test("rate limits repeated invalid admin keys per client", () => {
  const manager = new SessionManager({
    ttlMs: 60_000,
    maxAttempts: 2,
    attemptWindowMs: 60_000,
  });
  assert.throws(
    () => manager.authenticate("client", "wrong", "secret"),
    (error) => error.status === 401,
  );
  assert.throws(
    () => manager.authenticate("client", "wrong", "secret"),
    (error) => error.status === 401,
  );
  assert.throws(
    () => manager.authenticate("client", "secret", "secret"),
    (error) => error.status === 429,
  );
});
