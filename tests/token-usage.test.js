import assert from "node:assert/strict";
import test from "node:test";
import { extractTokenUsage } from "../src/server.js";

function chunks(value) {
  return [Buffer.from(value)];
}

test("extracts token usage from JSON response shapes", () => {
  assert.deepEqual(extractTokenUsage(chunks(JSON.stringify({
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  }))), { promptTokens: 3, completionTokens: 4, totalTokens: 7 });

  assert.deepEqual(extractTokenUsage(chunks(JSON.stringify({
    response: { usage: { input_tokens: 5, output_tokens: 6 } },
  }))), { promptTokens: 5, completionTokens: 6, totalTokens: 11 });

  assert.deepEqual(extractTokenUsage(chunks(JSON.stringify({
    message: { usage: { input_tokens: 8, output_tokens: 9 } },
  }))), { promptTokens: 8, completionTokens: 9, totalTokens: 17 });
});

test("extracts token usage from streaming SSE chunks", () => {
  const usage = extractTokenUsage(chunks([
    "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n",
    "data: {\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2,\"total_tokens\":12}}\n\n",
    "data: [DONE]\n\n",
  ].join("")));
  assert.deepEqual(usage, { promptTokens: 10, completionTokens: 2, totalTokens: 12 });
});
