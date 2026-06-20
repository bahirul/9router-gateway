import assert from "node:assert/strict";
import test from "node:test";
import { clientIp, normalizeIp } from "../src/client-ip.js";

function req(headers = {}, remoteAddress = "203.0.113.9") {
  return { headers, socket: { remoteAddress } };
}

test("prefers Cloudflare connecting IP over forwarded chains", () => {
  assert.equal(clientIp(req({
    "cf-connecting-ip": "198.51.100.42",
    "x-forwarded-for": "10.0.0.1, 10.0.0.2",
  })), "198.51.100.42");
});

test("uses true client IP before generic forwarded headers", () => {
  assert.equal(clientIp(req({
    "true-client-ip": "198.51.100.43",
    "x-forwarded-for": "10.0.0.1",
  })), "198.51.100.43");
});

test("uses first valid x-forwarded-for IP", () => {
  assert.equal(clientIp(req({ "x-forwarded-for": "unknown, 198.51.100.44, 10.0.0.8" })), "198.51.100.44");
});

test("normalizes IPv6 and bracketed forwarded values", () => {
  assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
  assert.equal(clientIp(req({ forwarded: "for=\"[2001:db8::2]:443\";proto=https" })), "2001:db8::2");
});

test("falls back to socket remote address", () => {
  assert.equal(clientIp(req({}, "192.0.2.10")), "192.0.2.10");
});
