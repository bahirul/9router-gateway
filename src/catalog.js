export class ModelCatalog {
  constructor(config, metrics, fetchImpl = fetch) {
    this.config = config;
    this.metrics = metrics;
    this.fetchImpl = fetchImpl;
    this.models = new Set();
    this.ready = false;
    this.lastError = null;
    this.timer = null;
  }

  async refresh() {
    try {
      const headers = { Accept: "application/json" };
      if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
      const response = await this.fetchImpl(`${this.config.baseUrl}/v1/models`, {
        headers,
        signal: AbortSignal.timeout(Math.min(this.config.requestTimeoutMs, 10000)),
      });
      if (!response.ok) throw new Error(`model catalog returned ${response.status}`);
      const payload = await response.json();
      this.models = new Set((payload.data || payload.models || []).map((model) => model.id).filter(Boolean));
      this.ready = true;
      this.lastError = null;
      this.metrics.increment("smart_router_catalog_refresh_total", { result: "success" });
    } catch (error) {
      this.ready = false;
      this.lastError = error;
      this.metrics.increment("smart_router_catalog_refresh_total", { result: "failure" });
    }
    return this.ready;
  }

  start() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.config.catalogRefreshMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  resolve(target, fallback) {
    if (this.models.has(target)) return target;
    if (fallback && this.models.has(fallback)) return fallback;
    return null;
  }
}
