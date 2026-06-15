function escapeLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function labels(values) {
  const entries = Object.entries(values);
  if (!entries.length) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

export class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.counters = new Map();
    this.classifierLatency = { count: 0, sumMs: 0 };
  }

  increment(name, labelValues = {}, amount = 1) {
    const key = `${name}${labels(labelValues)}`;
    this.counters.set(key, (this.counters.get(key) || 0) + amount);
  }

  observeClassifier(ms, result) {
    this.increment("smart_router_classifier_total", { result });
    this.classifierLatency.count += 1;
    this.classifierLatency.sumMs += ms;
  }

  render({ affinitySize = 0, catalogReady = false } = {}) {
    const lines = [
      "# HELP smart_router_uptime_seconds Process uptime.",
      "# TYPE smart_router_uptime_seconds gauge",
      `smart_router_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`,
      "# HELP smart_router_affinity_entries Active conversation affinity entries.",
      "# TYPE smart_router_affinity_entries gauge",
      `smart_router_affinity_entries ${affinitySize}`,
      "# HELP smart_router_catalog_ready Whether the upstream model catalog is ready.",
      "# TYPE smart_router_catalog_ready gauge",
      `smart_router_catalog_ready ${catalogReady ? 1 : 0}`,
    ];
    for (const [key, value] of [...this.counters.entries()].sort()) {
      lines.push(`${key} ${value}`);
    }
    lines.push(`smart_router_classifier_duration_ms_count ${this.classifierLatency.count}`);
    lines.push(`smart_router_classifier_duration_ms_sum ${this.classifierLatency.sumMs.toFixed(3)}`);
    return `${lines.join("\n")}\n`;
  }
}
