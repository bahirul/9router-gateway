export const DEFAULT_TASK_CLASSES = {
  quick: {
    semanticLabel: "quick transformation",
    semanticScore: 15,
    priority: 10,
    scoreDelta: -15,
    patterns: [
      "\\b(translate|summari[sz]e|rewrite|rephrase|format|spellcheck|typo|define|convert|one[- ]liner|short answer)\\b",
    ],
  },
  coding: {
    semanticLabel: "software coding",
    semanticScore: 50,
    priority: 50,
    scoreDelta: 10,
    patterns: [
      "\\b(code|implement|function|class|typescript|javascript|python|rust|golang|java|sql|regex|api|endpoint|component|refactor|repository|codebase)\\b",
    ],
  },
  research: {
    semanticLabel: "technical research",
    semanticScore: 70,
    priority: 60,
    scoreDelta: 20,
    hardFloor: "medium",
    patterns: [
      "\\b(research|compare|evaluate|benchmark|investigate|latest|sources?|citations?|evidence)\\b",
    ],
  },
  debugging: {
    semanticLabel: "software debugging",
    semanticScore: 60,
    priority: 70,
    scoreDelta: 15,
    hardFloor: "medium",
    patterns: [
      "\\b(debug|bug|error|exception|stack trace|fails?|broken|regression|root cause|diagnos[ei]|fix this)\\b",
    ],
  },
  review: {
    semanticLabel: "code review",
    semanticScore: 70,
    priority: 80,
    scoreDelta: 20,
    hardFloor: "medium",
    patterns: [
      "\\b(review|audit|pull request|diff|vulnerabilit|security review|code review|threat model)\\b",
    ],
  },
  planning: {
    semanticLabel: "technical planning",
    semanticScore: 80,
    priority: 90,
    scoreDelta: 25,
    hardFloor: "medium",
    patterns: [
      "\\b(plan|architecture|design|strategy|proposal|roadmap|specification|migration plan|implementation plan|trade[- ]?offs?)\\b",
    ],
  },
  general: {
    semanticLabel: "general question",
    semanticScore: 45,
    priority: 0,
    scoreDelta: 0,
    patterns: [],
  },
  risk: {
    task: false,
    scoreDelta: 30,
    hardFloor: "high",
    patterns: [
      "\\b(production|security|authentication|authorization|permission|credential|secret|payment|billing|finance|medical|legal|destructive|delete data|data loss|tenant|encryption)\\b",
    ],
  },
  migration: {
    task: false,
    scoreDelta: 25,
    hardFloor: "high",
    patterns: [
      "\\b(migrat(?:e|ion)|schema change|database upgrade|backfill|zero downtime|rollout|rollback|compatibility)\\b",
    ],
  },
  multi_step: {
    task: false,
    scoreDelta: 10,
    patterns: [
      "\\b(first|then|after that|finally|step \\d+|end[- ]to[- ]end|across (?:the )?codebase|multiple files?)\\b",
    ],
  },
};

const CLASS_ID_PATTERN = /^[a-z0-9_-]+$/;

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
}

export function compileTaskClasses(taskClasses = DEFAULT_TASK_CLASSES) {
  if (!taskClasses || typeof taskClasses !== "object" || Array.isArray(taskClasses)) {
    throw new Error("routing.taskClasses must be an object");
  }

  const compiled = [];
  const labels = [];
  const canonicalLabels = {};
  const semanticScores = {};

  for (const [id, definition] of Object.entries(taskClasses)) {
    if (!CLASS_ID_PATTERN.test(id)) {
      throw new Error(`routing.taskClasses.${id} must use lowercase letters, numbers, "_" or "-"`);
    }
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      throw new Error(`routing.taskClasses.${id} must be an object`);
    }

    const isTask = definition.task !== false;
    const patterns = definition.patterns ?? [];
    if (!Array.isArray(patterns)) throw new Error(`routing.taskClasses.${id}.patterns must be an array`);

    const scoreDelta = definition.scoreDelta ?? 0;
    const priority = definition.priority ?? 0;
    assertFiniteNumber(scoreDelta, `routing.taskClasses.${id}.scoreDelta`);
    assertFiniteNumber(priority, `routing.taskClasses.${id}.priority`);

    const hardFloor = definition.hardFloor ?? null;
    if (hardFloor !== null && hardFloor !== "medium" && hardFloor !== "high") {
      throw new Error(`routing.taskClasses.${id}.hardFloor must be medium or high`);
    }

    const semanticLabel = definition.semanticLabel ?? null;
    if (isTask && (typeof semanticLabel !== "string" || !semanticLabel.trim())) {
      throw new Error(`routing.taskClasses.${id}.semanticLabel must be a non-empty string`);
    }

    const regexes = patterns.map((pattern, index) => {
      if (typeof pattern !== "string" || !pattern) {
        throw new Error(`routing.taskClasses.${id}.patterns.${index} must be a non-empty regex string`);
      }
      try {
        return new RegExp(pattern, "i");
      } catch (error) {
        throw new Error(`routing.taskClasses.${id}.patterns.${index} is invalid: ${error.message}`);
      }
    });

    if (isTask) {
      const label = semanticLabel.trim();
      if (canonicalLabels[label]) {
        throw new Error(`routing.taskClasses.${id}.semanticLabel duplicates ${canonicalLabels[label]}`);
      }
      labels.push(label);
      canonicalLabels[label] = id;
      semanticScores[id] = definition.semanticScore ?? 45;
      assertFiniteNumber(semanticScores[id], `routing.taskClasses.${id}.semanticScore`);
    }

    compiled.push({
      id,
      isTask,
      semanticLabel: semanticLabel?.trim() || null,
      patterns: regexes,
      scoreDelta,
      priority,
      hardFloor,
    });
  }

  const general = compiled.find((item) => item.id === "general" && item.isTask);
  if (!general) throw new Error("routing.taskClasses.general is required");

  return {
    classes: compiled,
    taskClasses: compiled.filter((item) => item.isTask).sort((a, b) => b.priority - a.priority),
    labels,
    canonicalLabels,
    semanticScores,
  };
}

export const DEFAULT_COMPILED_TASK_CLASSES = compileTaskClasses(DEFAULT_TASK_CLASSES);
