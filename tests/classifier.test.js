import assert from "node:assert/strict";
import test from "node:test";
import { SemanticClassifier } from "../src/classifier.js";
import { DEFAULT_TASK_CLASSES, compileTaskClasses } from "../src/task-classes.js";

test("semantic classifier uses labels from configured task classes", async () => {
  const taskClasses = compileTaskClasses({
    ...DEFAULT_TASK_CLASSES,
    translation: {
      semanticLabel: "translation work",
      priority: 95,
      scoreDelta: -10,
      patterns: ["\\blocali[sz]e\\b"],
    },
  });
  const classifier = new SemanticClassifier(
    { enabled: true, timeoutMs: 100, cacheDir: ".", localFilesOnly: true },
    { observeClassifier() {} },
  );
  classifier.load = async () => async (_text, labels) => {
    assert.ok(labels.includes("translation work"));
    const orderedLabels = ["translation work", ...labels.filter((label) => label !== "translation work")];
    return {
      labels: orderedLabels,
      scores: orderedLabels.map((label) => label === "translation work" ? 0.91 : 0.01),
    };
  };

  const result = await classifier.classify("Localize these labels.", taskClasses);
  assert.equal(result.label, "translation");
  assert.equal(result.rawLabel, "translation work");
  assert.equal(result.confidence, 0.91);
});
