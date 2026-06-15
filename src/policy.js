import { DEFAULT_COMPILED_TASK_CLASSES } from "./task-classes.js";

const SEMANTIC_SCORES = {
  quick: 15,
  coding: 50,
  debugging: 60,
  planning: 80,
  review: 70,
  research: 70,
  general: 45,
};

const TARGET_RANK = {
  small: 0,
  medium: 1,
  planning: 2,
  large: 3,
  vision: 4,
};

function complexityForScore(score, thresholds) {
  if (score >= thresholds.high) return "high";
  if (score >= thresholds.medium) return "medium";
  return "low";
}

function chooseTargetKey(task, complexity, hasImage) {
  if (hasImage) return "vision";
  if (complexity === "high") return "large";
  if (task === "planning") return "planning";
  if (complexity === "medium") return "medium";
  return "small";
}

export function isAmbiguous(features, routingConfig) {
  const { medium, high } = routingConfig.thresholds;
  const margin = routingConfig.ambiguityMargin;
  return features.ruleConfidence < 0.72
    || Math.abs(features.ruleScore - medium) <= margin
    || Math.abs(features.ruleScore - high) <= margin;
}

export function makeDecision({
  requestedModel,
  normalized,
  features,
  semantic,
  routingConfig,
  taskClasses = DEFAULT_COMPILED_TASK_CLASSES,
}) {
  const profile = routingConfig.profiles[requestedModel];
  if (!profile) return null;

  const semanticScore = semantic
    ? taskClasses.semanticScores[semantic.label] ?? SEMANTIC_SCORES[semantic.label] ?? 45
    : null;
  let score = semanticScore === null
    ? features.ruleScore
    : Math.round(features.ruleScore * 0.6 + semanticScore * 0.4);
  score += Number(profile.scoreBias || 0);

  if (features.hardFloor === "high") score = Math.max(score, routingConfig.thresholds.high);
  if (features.hardFloor === "medium") score = Math.max(score, routingConfig.thresholds.medium);
  score = Math.max(0, Math.min(100, score));

  const task = features.task === "general" && semantic?.label ? semantic.label : features.task;
  const complexity = complexityForScore(score, routingConfig.thresholds);
  const targetKey = chooseTargetKey(task, complexity, normalized.hasImage);
  const confidence = semantic
    ? Number((features.ruleConfidence * 0.6 + semantic.confidence * 0.4).toFixed(3))
    : features.ruleConfidence;

  return {
    requestedModel,
    targetKey,
    target: routingConfig.targets[targetKey],
    targetRank: TARGET_RANK[targetKey],
    task,
    complexity,
    score,
    confidence,
    mode: routingConfig.shadowMode ? "shadow" : "active",
    classifierUsed: Boolean(semantic),
    ruleScore: features.ruleScore,
    semanticLabel: semantic?.label || null,
    semanticConfidence: semantic?.confidence || null,
    reasons: Object.entries(features.flags).filter(([, enabled]) => enabled).map(([name]) => name),
  };
}

export { TARGET_RANK };
