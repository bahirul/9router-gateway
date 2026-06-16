import process from "node:process";
import { pathToFileURL } from "node:url";
import { RuntimeConfigManager } from "../src/config.js";

function compactBody(body) {
  return body.replace(/\s+/g, " ").trim().slice(0, 500);
}

function describeFetchError(error, baseUrl) {
  const cause = error.cause || error;
  const code = cause.code ? ` (${cause.code})` : "";
  const message = cause.message || error.message;
  const hint = cause.code === "ECONNREFUSED"
    ? " Is the upstream 9Router server running?"
    : cause.code === "EPERM"
      ? " The environment blocked the connection; rerun with network permission."
      : "";
  return `Could not reach upstream 9Router at ${baseUrl}/v1/models${code}: ${message}.${hint}`;
}

export async function runUpstreamSmoke({
  configManager = new RuntimeConfigManager(),
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const config = configManager.get();
  const baseUrl = config.upstream.baseUrl.replace(/\/$/, "");
  const headers = { Accept: "application/json" };
  if (config.upstream.apiKey) headers.Authorization = `Bearer ${config.upstream.apiKey}`;

  let response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(Math.min(config.upstream.requestTimeoutMs, 15000)),
    });
  } catch (error) {
    throw new Error(describeFetchError(error, baseUrl), { cause: error });
  }

  if (!response.ok) {
    let body = "";
    try {
      body = compactBody(await response.text());
    } catch {
      body = "";
    }
    const detail = body ? `: ${body}` : "";
    throw new Error(`9Router /v1/models returned ${response.status}${detail}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`9Router /v1/models did not return valid JSON: ${error.message}`, { cause: error });
  }

  if (!Array.isArray(payload.data)) {
    throw new Error("9Router /v1/models did not return an OpenAI-compatible data array");
  }
  for (const model of payload.data) {
    if (!model || typeof model.id !== "string") {
      throw new Error("9Router model catalog contains an entry without a string id");
    }
  }
  logger.log(`9Router compatibility smoke passed with ${payload.data.length} models`);
  return payload.data.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runUpstreamSmoke();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
