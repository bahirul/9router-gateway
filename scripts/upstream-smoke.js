import process from "node:process";

const baseUrl = (process.env.NINEROUTER_BASE_URL || "http://127.0.0.1:20128").replace(/\/$/, "");
const response = await fetch(`${baseUrl}/v1/models`, {
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) {
  throw new Error(`9Router /v1/models returned ${response.status}`);
}
const payload = await response.json();
if (!Array.isArray(payload.data)) {
  throw new Error("9Router /v1/models did not return an OpenAI-compatible data array");
}
for (const model of payload.data) {
  if (!model || typeof model.id !== "string") {
    throw new Error("9Router model catalog contains an entry without a string id");
  }
}
console.log(`9Router compatibility smoke passed with ${payload.data.length} models`);
