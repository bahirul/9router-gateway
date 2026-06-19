import crypto from "node:crypto";
import { extractFeatures } from "./features.js";
import { extractSessionId, normalizeRequest } from "./request-normalizer.js";
import { isAmbiguous, makeDecision } from "./policy.js";
import { compileTaskClasses } from "./task-classes.js";

export class RouterEngine {
  constructor({ config, classifier, affinity, catalog, metrics, logStore, decisionStore = null }) {
    this.setConfig(config);
    this.classifier = classifier;
    this.affinity = affinity;
    this.catalog = catalog;
    this.metrics = metrics;
    this.logStore = logStore;
    this.decisionStore = decisionStore;
  }

  setConfig(config) {
    this.config = config;
    this.taskClasses = compileTaskClasses(config.routing.taskClasses);
  }

  isVirtualModel(model) {
    return Boolean(this.config.routing.profiles[model]);
  }

  async decide({ pathname, body, headers = {}, explainOnly = false, forcedModel = null, clientIp = null }) {
    const normalized = normalizeRequest(pathname, body);
    if (!this.isVirtualModel(normalized.model)) {
      return { passthrough: true, normalized };
    }

    const features = extractFeatures(normalized, this.config.routing.thresholds, this.taskClasses);
    const semanticCandidate = isAmbiguous(features, this.config.routing)
      ? await this.classifier.classify(features.text, this.taskClasses)
      : null;
    const semantic = semanticCandidate
      && semanticCandidate.confidence >= this.config.classifier.minimumConfidence
      ? semanticCandidate
      : null;
    if (semanticCandidate && !semantic) {
      this.metrics.increment("smart_router_classifier_rejected_total", { reason: "low_confidence" });
    }
    let decision = makeDecision({
      requestedModel: normalized.model,
      normalized,
      features,
      semantic,
      routingConfig: this.config.routing,
      taskClasses: this.taskClasses,
    });
    const sessionId = extractSessionId(body, normalized, headers);
    decision = this.affinity.apply(sessionId, decision, Date.now(), !explainOnly);

    const forcedDispatch = forcedModel ? String(forcedModel).trim() : null;
    if (forcedDispatch) decision = { ...decision, mode: "key_shadow", keyForcedModel: forcedDispatch };

    if (!forcedDispatch && !this.config.routing.shadowMode) {
      const correction = this.decisionStore?.getPromptCorrection(normalized.promptHash);
      if (correction) {
        decision = {
          ...decision,
          configuredTarget: decision.target,
          correctionSourceRequestId: correction.sourceRequestId,
          correctionRunId: correction.correctionRunId,
          correctionConfidence: correction.confidence,
          correctionRationale: correction.rationale,
          targetKey: correction.expectedTargetKey,
          target: correction.expectedTarget,
          mode: "feedback_corrected",
        };
      }
    }

    const fallback = forcedDispatch ? null : this.config.routing.targets.medium;
    const dispatchCandidate = forcedDispatch || (this.config.routing.shadowMode
      ? this.config.routing.shadowTarget
      : decision.target);
    const validatedTarget = this.catalog.resolve(dispatchCandidate, fallback);
    if (validatedTarget) {
      decision = {
        ...decision,
        configuredTarget: decision.target,
        dispatchTarget: validatedTarget,
        catalogFallback: validatedTarget !== dispatchCandidate,
      };
    } else if (this.config.upstream.strictModelValidation) {
      const error = this.catalog.lastError
        ? `9Router model catalog unavailable: ${this.catalog.lastError.message}`
        : forcedDispatch
          ? `Forced model ${dispatchCandidate} does not exist in 9Router`
          : `Neither ${dispatchCandidate} nor fallback ${fallback} exists in 9Router`;
      return { error, status: 503, normalized, features, decision };
    } else {
      decision = { ...decision, dispatchTarget: dispatchCandidate, catalogFallback: false };
    }

    const requestId = crypto.randomUUID();
    this.metrics.increment("smart_router_decisions_total", {
      target: decision.targetKey,
      task: decision.task,
      complexity: decision.complexity,
      mode: decision.mode,
    });

    if (!explainOnly) {
      this.logStore.decision({
        requestId,
        sessionId,
        normalized,
        body,
        features,
        decision,
        clientIp,
        userAgent: headers["user-agent"] || "unknown",
        client: headers["user-agent"] || "unknown",
      });
    }

    return {
      passthrough: false,
      requestId,
      sessionId,
      normalized,
      features,
      decision,
    };
  }
}
