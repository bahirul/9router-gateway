const TARGET_KEYS = new Set(["small", "medium", "planning", "large", "vision"]);

function upstreamHeaders(apiKey) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function textFromChatCompletion(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  if (Array.isArray(payload?.output)) {
    return payload.output.flatMap((item) => item?.content || [])
      .map((part) => part?.text || part?.input_text || part?.output_text || "")
      .filter(Boolean)
      .join("\n");
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part?.text || part?.input_text || part?.output_text || "").join("\n");
  }
  return "";
}

function parseJsonObject(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    const error = new Error(`judge response did not contain JSON: ${cleaned.slice(0, 200) || "empty response"}`);
    error.status = 502;
    throw error;
  }
  return JSON.parse(match[0]);
}

function eligibleContext(decision) {
  if (decision.request?.body) return decision.request.body;
  if (decision.prompt) return { prompt: decision.prompt };
  return null;
}

function predicted(decision) {
  return {
    targetKey: decision.targetKey,
    target: decision.target,
    task: decision.task,
    complexity: decision.complexity,
    score: decision.score,
    confidence: decision.confidence,
    reasons: decision.reasons || [],
  };
}

function reviewPrompt(decision, targets) {
  return [
    {
      role: "system",
      content: `You audit one smart-router decision. Return strict JSON only. Decide if the predicted target is correct. Valid target keys: ${Object.keys(targets).join(", ")}. Use expectedTargetKey only from those keys. Reply shape: {"verdict":"correct|incorrect|uncertain","expectedTargetKey":"small|medium|planning|large|vision|null","confidence":0.0,"rationale":"short reason"}. Prefer uncertain when context is insufficient.`,
    },
    {
      role: "user",
      content: `${JSON.stringify({
        targets,
        record: {
          requestId: decision.requestId,
          requestedModel: decision.requestedModel,
          predicted: predicted(decision),
          request: eligibleContext(decision),
        },
      }, null, 2)}\n\nReturn only the JSON object. Do not include markdown, prose, or code fences.`,
    },
  ];
}

async function fetchJudge(fetchImpl, url, headers, body, timeoutMs) {
  const request = {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  };
  const response = await fetchImpl(url, request);
  if (response.ok || !body.response_format) return response;
  const detail = await response.text().catch(() => "");
  if (![400, 404, 422].includes(response.status) || !/response_format|json/i.test(detail)) {
    return new Response(detail, { status: response.status, headers: { "Content-Type": "text/plain" } });
  }
  const fallbackBody = { ...body };
  delete fallbackBody.response_format;
  return fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(fallbackBody),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function normalizeSuggestion(raw, decision, targets, minConfidence) {
  const verdict = ["correct", "incorrect", "uncertain"].includes(raw?.verdict) ? raw.verdict : "uncertain";
  const expectedTargetKey = TARGET_KEYS.has(raw?.expectedTargetKey) ? raw.expectedTargetKey : null;
  const incorrect = verdict === "incorrect" && expectedTargetKey;
  const confidence = Math.max(0, Math.min(1, Number(raw?.confidence) || 0));
  return {
    verdict: incorrect ? "incorrect" : verdict === "correct" ? "correct" : "uncertain",
    expectedTargetKey: incorrect ? expectedTargetKey : null,
    expectedTarget: incorrect ? targets[expectedTargetKey] : null,
    confidence,
    rationale: typeof raw?.rationale === "string" ? raw.rationale.slice(0, 500) : "",
    applyDefault: incorrect && confidence >= minConfidence,
  };
}

export class DecisionCorrector {
  constructor({ store, catalog, metrics, getConfig, getRevision, fetchImpl = fetch }) {
    this.store = store;
    this.catalog = catalog;
    this.metrics = metrics;
    this.getConfig = getConfig;
    this.getRevision = getRevision;
    this.fetchImpl = fetchImpl;
  }

  defaultJudgeModel() {
    if (this.catalog.ready && this.catalog.models.has("smart-large")) return "smart-large";
    return this.catalog.ready ? [...this.catalog.models][0] || "smart-large" : "smart-large";
  }

  validateJudgeModel(judgeModel) {
    const model = String(judgeModel || this.defaultJudgeModel()).trim();
    if (!model) {
      const error = new Error("judgeModel is required");
      error.status = 400;
      throw error;
    }
    if (this.catalog.ready && !this.catalog.models.has(model)) {
      const error = new Error(`judgeModel not found in 9Router catalog: ${model}`);
      error.status = 400;
      throw error;
    }
    return model;
  }

  async reviewDecision(requestId, { judgeModel, minConfidence = 0.7 } = {}) {
    const decision = this.store.get(requestId);
    if (!decision) {
      const error = new Error("Decision not found");
      error.status = 404;
      throw error;
    }
    if (!eligibleContext(decision)) {
      return {
        requestId,
        eligible: false,
        skipReason: "missing_context",
        predicted: predicted(decision),
      };
    }

    const config = this.getConfig();
    const model = this.validateJudgeModel(judgeModel);
    const response = await fetchJudge(
      this.fetchImpl,
      `${config.upstream.baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
      upstreamHeaders(config.upstream.apiKey),
      {
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: reviewPrompt(decision, config.routing.targets),
      },
      config.upstream.requestTimeoutMs,
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const error = new Error(`judge model returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      error.status = 502;
      throw error;
    }

    const suggestion = normalizeSuggestion(
      parseJsonObject(textFromChatCompletion(await response.json())),
      decision,
      config.routing.targets,
      minConfidence,
    );
    this.metrics.increment("smart_router_correction_items_total", { verdict: suggestion.verdict });
    return {
      requestId,
      eligible: true,
      judgeModel: model,
      configRevision: this.getRevision(),
      predicted: predicted(decision),
      suggestion,
    };
  }

  applyDecisionReview(requestId, { expectedRevision, suggestion, minConfidence = 0.7, enablePromptCorrection = true } = {}) {
    if (expectedRevision !== this.getRevision()) {
      const error = new Error("Configuration changed; rerun review before applying");
      error.status = 409;
      throw error;
    }
    const result = this.store.applyDecisionReview(requestId, suggestion, {
      minConfidence,
      enablePromptCorrection,
    });
    if (!result) {
      const error = new Error("Decision not found");
      error.status = 404;
      throw error;
    }
    this.metrics.increment("smart_router_correction_runs_total", { result: "applied" });
    this.metrics.increment("smart_router_prompt_corrections_total", { result: result.promptCorrection ? "created" : "none" });
    return result;
  }
}
