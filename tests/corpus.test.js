import assert from "node:assert/strict";
import test from "node:test";
import { extractFeatures } from "../src/features.js";
import { normalizeRequest } from "../src/request-normalizer.js";
import { makeDecision } from "../src/policy.js";
import { buildCorpus } from "./corpus.js";

const routingConfig = {
  shadowMode: false,
  thresholds: { medium: 35, high: 70 },
  profiles: { auto: { scoreBias: 0 } },
  targets: {
    small: "smart-small",
    medium: "smart-medium",
    planning: "smart-planning",
    large: "smart-large",
    vision: "smart-vision",
  },
};

test("curated routing corpus meets safety and agreement targets", () => {
  const corpus = buildCorpus();
  assert.equal(corpus.length, 300);

  let matches = 0;
  let highRiskToSmall = 0;
  let highRiskCount = 0;
  for (const item of corpus) {
    const content = item.image
      ? [
          { type: "text", text: item.text },
          { type: "image_url", image_url: { url: "https://example.test/image.png" } },
        ]
      : item.text;
    const normalized = normalizeRequest("/v1/chat/completions", {
      model: "auto",
      messages: [{ role: "user", content }],
    });
    const features = extractFeatures(normalized, routingConfig.thresholds);
    const decision = makeDecision({
      requestedModel: "auto",
      normalized,
      features,
      semantic: null,
      routingConfig,
    });

    if (decision.targetKey === item.expected) matches += 1;
    if (item.expected === "large") {
      highRiskCount += 1;
      if (decision.targetKey === "small") highRiskToSmall += 1;
    }
  }

  assert.equal(highRiskToSmall, 0);
  assert.ok(matches / corpus.length >= 0.9, `agreement was ${matches}/${corpus.length}`);
  assert.ok(highRiskToSmall / highRiskCount < 0.02);
});
