import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function readJsonLines(filename) {
  if (!fs.existsSync(filename)) return [];
  return fs.readFileSync(filename, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSON on ${filename}:${index + 1}`);
      }
    });
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] ?? "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

const dataDir = path.resolve(process.argv[2] || process.env.SMART_ROUTER_DATA_DIR || "./data");
const decisions = readJsonLines(path.join(dataDir, "decisions.jsonl"))
  .filter((record) => record.event === "decision");
const outcomes = readJsonLines(path.join(dataDir, "decisions.jsonl"))
  .filter((record) => record.event === "outcome");
const feedback = readJsonLines(path.join(dataDir, "feedback.jsonl"));
const averageRating = feedback.length
  ? feedback.reduce((sum, item) => sum + Number(item.rating || 0), 0) / feedback.length
  : null;

console.log(JSON.stringify({
  dataDir,
  decisions: decisions.length,
  outcomes: outcomes.length,
  feedback: feedback.length,
  averageRating,
  byTarget: countBy(decisions, "targetKey"),
  byTask: countBy(decisions, "task"),
  byComplexity: countBy(decisions, "complexity"),
  byStatus: countBy(outcomes, "status"),
  classifierUsageRate: decisions.length
    ? decisions.filter((item) => item.classifierUsed).length / decisions.length
    : 0,
  affinityHoldRate: decisions.length
    ? decisions.filter((item) => item.affinityHeld).length / decisions.length
    : 0,
}, null, 2));
