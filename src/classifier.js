const CANDIDATES = {
  quick: "quick transformation",
  coding: "software coding",
  debugging: "software debugging",
  planning: "technical planning",
  review: "code review",
  research: "technical research",
  general: "general question",
};

const LABELS = Object.values(CANDIDATES);
const CANONICAL_LABELS = Object.fromEntries(
  Object.entries(CANDIDATES).map(([canonical, candidate]) => [candidate, canonical]),
);

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`classifier timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class SemanticClassifier {
  constructor(config, metrics, logger = console) {
    this.config = config;
    this.metrics = metrics;
    this.logger = logger;
    this.pipelinePromise = null;
    this.lastError = null;
  }

  async load() {
    if (!this.config.enabled) return null;
    if (!this.pipelinePromise) {
      this.pipelinePromise = import("@huggingface/transformers")
        .then(async ({ env, pipeline }) => {
          env.cacheDir = this.config.cacheDir;
          env.allowRemoteModels = !this.config.localFilesOnly;
          const classifier = await pipeline(
            "zero-shot-classification",
            this.config.model,
            {
              revision: this.config.revision,
              dtype: "q8",
            },
          );
          this.lastError = null;
          return classifier;
        })
        .catch((error) => {
          this.lastError = error;
          this.pipelinePromise = null;
          this.logger.warn(`[classifier] unavailable: ${error.message}`);
          return null;
        });
    }
    return this.pipelinePromise;
  }

  warm() {
    if (!this.config.enabled) return;
    this.load().catch(() => {});
  }

  async classify(text) {
    const started = performance.now();
    try {
      const classifier = await withTimeout(this.load(), this.config.timeoutMs);
      if (!classifier) return null;
      const clipped = text.slice(-12000);
      const result = await withTimeout(
        classifier(clipped, LABELS, {
          hypothesis_template: "This user request requires {}.",
          multi_label: false,
        }),
        this.config.timeoutMs,
      );
      const scores = Object.fromEntries(
        result.labels.map((label, index) => [CANONICAL_LABELS[label] || label, result.scores[index]]),
      );
      const rawLabel = result.labels[0];
      const label = CANONICAL_LABELS[rawLabel] || rawLabel;
      this.metrics.observeClassifier(performance.now() - started, "success");
      return { label, rawLabel, confidence: scores[label], scores };
    } catch (error) {
      this.lastError = error;
      this.metrics.observeClassifier(performance.now() - started, "fallback");
      return null;
    }
  }
}

export { CANDIDATES, LABELS };
