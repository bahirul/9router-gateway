const DEFAULT_RULES = [
  {
    id: "prompt-injection-ignore-instructions",
    category: "prompt_injection",
    severity: "high",
    pattern: "\\b(ignore|bypass|override|forget)\\b.{0,80}\\b(previous|prior|system|developer|safety|instructions?)\\b",
    enabled: true,
  },
  {
    id: "prompt-injection-reveal-system",
    category: "prompt_injection",
    severity: "high",
    pattern: "\\b(reveal|print|show|dump|exfiltrate)\\b.{0,80}\\b(system prompt|developer message|hidden instructions?)\\b",
    enabled: true,
  },
  {
    id: "dangerous-action-destructive-command",
    category: "dangerous_action",
    severity: "high",
    pattern: "\\b(rm\\s+-rf\\s+/|format\\s+[a-z]:|drop\\s+database|delete\\s+all\\s+(files|data|records))\\b",
    enabled: true,
  },
  {
    id: "security-credential-theft",
    category: "security",
    severity: "high",
    pattern: "\\b(steal|exfiltrate|dump|harvest)\\b.{0,80}\\b(api keys?|passwords?|tokens?|secrets?|credentials?)\\b",
    enabled: true,
  },
];

const SEVERITY_ORDER = { low: 1, medium: 2, high: 3, critical: 4 };
const DEFAULT_LIMITS = { maxRules: 100, maxPatternLength: 512 };

function enabledCategories(categories = {}) {
  return {
    security: categories.security !== false,
    dangerous_action: categories.dangerous_action !== false,
    prompt_injection: categories.prompt_injection !== false,
  };
}

export function defaultGuardrailRules() {
  return structuredClone(DEFAULT_RULES);
}

export function mergeGuardrailConfig(globalConfig = {}, override = null) {
  if (!override) return structuredClone(globalConfig || {});
  return {
    ...(globalConfig || {}),
    ...override,
    categories: {
      ...(globalConfig?.categories || {}),
      ...(override.categories || {}),
    },
    ruleOverrides: {
      ...(globalConfig?.ruleOverrides || {}),
      ...(override.ruleOverrides || {}),
    },
  };
}

export function validateGuardrailsConfig(config = {}, path = "security.guardrails") {
  if (typeof config.enabled !== "boolean") throw new Error(`${path}.enabled must be a boolean`);
  if (config.action !== "block" && config.action !== "monitor") throw new Error(`${path}.action must be block or monitor`);
  if (!SEVERITY_ORDER[config.severityThreshold]) throw new Error(`${path}.severityThreshold is invalid`);
  const categories = enabledCategories(config.categories);
  for (const [category, enabled] of Object.entries(categories)) {
    if (typeof enabled !== "boolean") throw new Error(`${path}.categories.${category} must be a boolean`);
  }
  if (config.ruleOverrides && typeof config.ruleOverrides !== "object") throw new Error(`${path}.ruleOverrides must be an object`);
  if (!Array.isArray(config.rules)) throw new Error(`${path}.rules must be an array`);
  const maxRules = Number(config.maxRules ?? DEFAULT_LIMITS.maxRules);
  const maxPatternLength = Number(config.maxPatternLength ?? DEFAULT_LIMITS.maxPatternLength);
  if (!Number.isSafeInteger(maxRules) || maxRules <= 0) throw new Error(`${path}.maxRules must be a positive integer`);
  if (!Number.isSafeInteger(maxPatternLength) || maxPatternLength <= 0) throw new Error(`${path}.maxPatternLength must be a positive integer`);
  if (config.rules.length > maxRules) throw new Error(`${path}.rules must contain at most ${maxRules} rules`);
  for (const [index, rule] of config.rules.entries()) {
    const rulePath = `${path}.rules.${index}`;
    if (!rule || typeof rule !== "object") throw new Error(`${rulePath} must be an object`);
    if (!rule.id || typeof rule.id !== "string") throw new Error(`${rulePath}.id must be a non-empty string`);
    if (!categories[rule.category]) {
      if (!Object.hasOwn(categories, rule.category)) throw new Error(`${rulePath}.category is invalid`);
    }
    if (!SEVERITY_ORDER[rule.severity]) throw new Error(`${rulePath}.severity is invalid`);
    if (typeof rule.pattern !== "string" || !rule.pattern.trim()) throw new Error(`${rulePath}.pattern must be a non-empty string`);
    if (rule.pattern.length > maxPatternLength) throw new Error(`${rulePath}.pattern exceeds ${maxPatternLength} characters`);
    if (hasUnsafeRegexConstruct(rule.pattern)) throw new Error(`${rulePath}.pattern uses unsafe regex constructs`);
    try {
      new RegExp(rule.pattern, "iu");
    } catch {
      throw new Error(`${rulePath}.pattern is invalid`);
    }
    if (typeof rule.enabled !== "boolean") throw new Error(`${rulePath}.enabled must be a boolean`);
  }
  return config;
}

function hasUnsafeRegexConstruct(pattern) {
  return /\\[1-9]/.test(pattern)
    || /\(\?<([=!]|[A-Za-z])/.test(pattern)
    || /\((?:\?:)?[^)]*[+*][^)]*\)[+*{]/.test(pattern)
    || /\([^)]*\{\d+,?\d*\}[^)]*\)[+*{]/.test(pattern);
}

export function evaluateGuardrails(config = {}, normalized) {
  const started = performance.now();
  const effective = validateGuardrailsConfig(config);
  if (!effective.enabled) {
    return { allowed: true, action: effective.action, categories: [], severity: null, reasons: [], matchedRules: [], latencyMs: 0 };
  }
  const categories = enabledCategories(effective.categories);
  const threshold = SEVERITY_ORDER[effective.severityThreshold] || SEVERITY_ORDER.high;
  const text = String(normalized.guardrailText || normalized.allText || "").slice(0, effective.maxTextBytes || 32768);
  const matches = [];
  for (const rule of effective.rules) {
    const enabled = effective.ruleOverrides?.[rule.id] ?? rule.enabled;
    if (!enabled || !categories[rule.category] || SEVERITY_ORDER[rule.severity] < threshold) continue;
    if (new RegExp(rule.pattern, "iu").test(text)) matches.push(rule);
  }
  const severity = matches.reduce((current, rule) => {
    if (!current || SEVERITY_ORDER[rule.severity] > SEVERITY_ORDER[current]) return rule.severity;
    return current;
  }, null);
  const blocked = matches.length > 0 && effective.action === "block";
  return {
    allowed: !blocked,
    action: effective.action,
    categories: [...new Set(matches.map((rule) => rule.category))],
    severity,
    reasons: matches.map((rule) => `Matched guardrail rule ${rule.id}`),
    matchedRules: matches.map((rule) => rule.id),
    latencyMs: Math.round((performance.now() - started) * 1000) / 1000,
  };
}
