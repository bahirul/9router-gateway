import net from "node:net";

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value.find((item) => item != null) || "";
  return value == null ? "" : String(value);
}

function stripPort(value) {
  if (/^\[[^\]]+](:\d+)?$/.test(value)) return value.slice(1, value.indexOf("]"));
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)) return value.slice(0, value.lastIndexOf(":"));
  return value;
}

export function normalizeIp(value) {
  let candidate = String(value || "").trim();
  if (!candidate) return "";
  if (candidate.toLowerCase() === "unknown") return "";
  candidate = candidate.replace(/^"|"$/g, "").trim();
  candidate = stripPort(candidate);
  return net.isIP(candidate) ? candidate : "";
}

function forwardedFor(value) {
  const header = firstHeaderValue(value);
  const match = header.match(/(?:^|[,;\s])for=("?\[[^\]]+](:\d+)?"?|"?[^;,\s]+"?)/i);
  return match ? normalizeIp(match[1]) : "";
}

function firstForwardedFor(value) {
  for (const part of firstHeaderValue(value).split(",")) {
    const ip = normalizeIp(part);
    if (ip) return ip;
  }
  return "";
}

export function clientIp(req) {
  const headers = req?.headers || {};
  return normalizeIp(firstHeaderValue(headers["cf-connecting-ip"]))
    || normalizeIp(firstHeaderValue(headers["true-client-ip"]))
    || firstForwardedFor(headers["x-forwarded-for"])
    || normalizeIp(firstHeaderValue(headers["x-real-ip"]))
    || forwardedFor(headers.forwarded)
    || normalizeIp(req?.socket?.remoteAddress)
    || "unknown";
}
