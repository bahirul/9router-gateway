import { DEFAULT_COMPILED_TASK_CLASSES } from "./task-classes.js";

function matched(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function chooseTask(flags, taskClasses) {
  return taskClasses.find((taskClass) => flags[taskClass.id])?.id || "general";
}

function strongestHardFloor(matchedClasses) {
  if (matchedClasses.some((taskClass) => taskClass.hardFloor === "high")) return "high";
  if (matchedClasses.some((taskClass) => taskClass.hardFloor === "medium")) return "medium";
  return null;
}

function ruleConfidence(score, thresholds, signalCount) {
  const distance = Math.min(
    Math.abs(score - thresholds.medium),
    Math.abs(score - thresholds.high),
  );
  const distanceConfidence = Math.min(1, distance / 20);
  const signalConfidence = Math.min(1, signalCount / 5);
  return Number((0.45 + distanceConfidence * 0.35 + signalConfidence * 0.2).toFixed(3));
}

export function extractFeatures(normalized, thresholds, taskClasses = DEFAULT_COMPILED_TASK_CLASSES) {
  const text = `${normalized.systemText}\n${normalized.latestUserText}`.trim();
  const flags = Object.fromEntries(
    taskClasses.classes.map((taskClass) => [taskClass.id, matched(taskClass.patterns, text)]),
  );
  const matchedClasses = taskClasses.classes.filter((taskClass) => flags[taskClass.id]);
  const chars = normalized.allText.length;
  let score = chars < 400 ? 5 : chars < 2000 ? 15 : chars < 8000 ? 25 : 35;

  if (normalized.messageCount > 6) score += 5;
  if (normalized.messageCount > 15) score += 5;
  score += Math.min(15, normalized.toolCount * 3);
  if (normalized.hasStructuredOutput) score += 10;
  for (const taskClass of matchedClasses) score += taskClass.scoreDelta;
  if (["high", "xhigh", "enabled"].includes(String(normalized.reasoningEffort).toLowerCase())) {
    score += 20;
  }

  score = Math.max(0, Math.min(100, score));
  const signalCount = Object.values(flags).filter(Boolean).length
    + Number(normalized.toolCount > 0)
    + Number(normalized.hasStructuredOutput);

  return {
    text,
    chars,
    estimatedTokens: Math.ceil(chars / 4),
    flags,
    task: chooseTask(flags, taskClasses.taskClasses),
    ruleScore: score,
    ruleConfidence: ruleConfidence(score, thresholds, signalCount),
    signalCount,
    hardFloor: strongestHardFloor(matchedClasses),
  };
}
