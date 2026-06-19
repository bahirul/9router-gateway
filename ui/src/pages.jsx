import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Empty,
  Field,
  Icon,
  Input,
  PageHeader,
  Select,
  Toggle,
} from "./components";

const COLORS = ["#E56A4A", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#64748B"];
const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };
const NO_DATA_COLOR = "#CBD5E1";
const TASK_CLASS_COLOR = "#3B82F6";
const COMPLEXITY_COLORS = {
  low: "#10B981",
  medium: "#F59E0B",
  high: "#EF4444",
};

const OVERVIEW_RANGES = [
  { value: "3h", label: "3h" },
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

function startOfTodayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function rangeParams(range) {
  const now = new Date();
  if (range === "today") return { from: startOfTodayIso(), to: now.toISOString() };
  const hours = range === "3h" ? 3 : range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
  return { from: new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
}

function startOfHour(date) {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  return next;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function timelineBucketKey(timestamp, range) {
  const date = new Date(timestamp);
  return (["3h", "today", "24h"].includes(range) ? startOfHour(date) : startOfDay(date)).toISOString();
}

function timelineStep(range) {
  return ["3h", "today", "24h"].includes(range) ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function normalizeTimeline(analytics, range) {
  if (!analytics?.from || !analytics?.to) return analytics?.timeline || [];
  const step = timelineStep(range);
  const start = timelineBucketKey(analytics.from, range);
  const end = timelineBucketKey(analytics.to, range);
  const counts = new Map();
  for (const item of analytics.timeline || []) {
    const key = timelineBucketKey(item.timestamp, range);
    counts.set(key, (counts.get(key) || 0) + item.requests);
  }
  const timeline = [];
  for (let cursor = new Date(start); cursor <= new Date(end); cursor = new Date(cursor.getTime() + step)) {
    const timestamp = cursor.toISOString();
    timeline.push({ timestamp, requests: counts.get(timestamp) || 0 });
  }
  return timeline;
}

function formatTimelineTick(value, range) {
  const date = new Date(value);
  if (["3h", "today", "24h"].includes(range)) return date.toLocaleTimeString([], { hour: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function requestVolumeSubtitle(range) {
  if (range === "3h") return "Hourly routed prompts over the last 3 hours";
  if (range === "today") return "Hourly routed prompts today";
  if (range === "24h") return "Hourly routed prompts over the last 24 hours";
  return `Daily routed prompts over the last ${range}`;
}

function Loading() {
  return <div className="grid min-h-56 place-items-center text-text-muted"><Icon className="animate-spin text-3xl">progress_activity</Icon></div>;
}

function ErrorBox({ error }) {
  return error ? <div className="mb-4 rounded-[10px] border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div> : null;
}

function shortRequestId(value) {
  return String(value || "").slice(0, 12) || "—";
}

function copyText(value) {
  navigator.clipboard?.writeText(String(value || "")).catch(() => {});
}

function reviewFeedbackForSuggestion(suggestion, minConfidence) {
  if (suggestion?.verdict === "correct") {
    return { rating: 5, expectedTarget: null, note: suggestion.rationale ? `Model reviewed this decision as correct: ${suggestion.rationale}` : "Model reviewed this decision as correct." };
  }
  if (suggestion?.verdict === "incorrect") {
    return {
      rating: 3,
      expectedTarget: null,
      note: suggestion.rationale
        ? `Model suggested a correction below confidence threshold (${suggestion.confidence} < ${minConfidence}): ${suggestion.rationale}`
        : `Model suggested a correction below confidence threshold (${suggestion.confidence} < ${minConfidence}).`,
    };
  }
  return { rating: 3, expectedTarget: null, note: suggestion?.rationale || "Model was uncertain about this decision." };
}

function Metric({ label, value, hint, icon, tone = "primary" }) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    info: "bg-info/10 text-info",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <Card className="min-w-0">
      <div className="flex items-start justify-between">
        <div><p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p>{hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}</div>
        <div className={`grid size-10 place-items-center rounded-[10px] ${tones[tone]}`}><Icon>{icon}</Icon></div>
      </div>
    </Card>
  );
}

function objectChart(data = {}) {
  return Object.entries(data).map(([name, value]) => ({ name, value }));
}

export function OverviewPage() {
  const [status, setStatus] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState("3h");
  const timeline = useMemo(() => normalizeTimeline(analytics, range), [analytics, range]);
  const hasTimelineData = timeline.some((item) => Number(item.requests) > 0);
  const targetData = objectChart(analytics?.byTarget);
  const hasTargetData = targetData.some((item) => Number(item.value) > 0);
  const targetChartData = hasTargetData ? targetData : [{ name: "No data yet", value: 1 }];

  async function load(selectedRange = range) {
    try {
      const params = new URLSearchParams(rangeParams(selectedRange));
      const [nextStatus, nextAnalytics] = await Promise.all([
        api("/api/admin/status"),
        api(`/api/admin/analytics?${params.toString()}`),
      ]);
      setStatus(nextStatus);
      setAnalytics(nextAnalytics);
      setError("");
    } catch (failure) { setError(failure.message); }
  }

  useEffect(() => {
    load(range);
    const timer = setInterval(() => load(range), 60000);
    return () => clearInterval(timer);
  }, [range]);

  function selectRange(value) {
    setRange(value);
  }

  if (!status || !analytics) return <Loading />;
  return (
    <>
      <PageHeader
        title="Overview"
        description={range === "today" ? "Live routing health and today’s prompt decisions." : `Live routing health and the last ${range} of prompt decisions.`}
        action={(
          <div className="flex flex-wrap gap-2 rounded-[12px] border border-border-subtle bg-surface-2 p-1">
            {OVERVIEW_RANGES.map((item) => (
              <Button
                key={item.value}
                variant={range === item.value ? "primary" : "ghost"}
                className="min-h-8 px-3 py-1.5 text-xs"
                onClick={() => selectRange(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        )}
      />
      <ErrorBox error={error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Requests" value={analytics.total.toLocaleString()} hint={`${analytics.completed} completed`} icon="route" />
        <Metric label="Success rate" value={`${(analytics.successRate * 100).toFixed(1)}%`} hint="Completed upstream requests" icon="check_circle" tone="success" />
        <Metric label="P95 latency" value={`${analytics.p95LatencyMs.toLocaleString()} ms`} hint="End-to-end proxy latency" icon="speed" tone="info" />
        <Metric label="Tokens" value={analytics.tokenTotal.toLocaleString()} hint={`${status.affinityEntries} active affinities`} icon="data_usage" tone="warning" />
      </div>
      <div className="mb-6 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card title="Request volume" subtitle={requestVolumeSubtitle(range)}>
          <div className="h-72">
            {hasTimelineData ? (
              <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
                <AreaChart data={timeline} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs><linearGradient id="routeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#E56A4A" stopOpacity={0.35}/><stop offset="95%" stopColor="#E56A4A" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
                  <XAxis dataKey="timestamp" tickFormatter={(value) => formatTimelineTick(value, range)} stroke="var(--color-text-muted)" fontSize={11} />
                  <YAxis width={40} stroke="var(--color-text-muted)" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "var(--color-surface)", borderColor: "var(--color-border)", borderRadius: 10 }} labelFormatter={(value) => new Date(value).toLocaleString()} />
                  <Area type="monotone" dataKey="requests" stroke="#E56A4A" fill="url(#routeFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center rounded-[12px] border border-dashed border-border-subtle text-sm text-text-muted">No data yet</div>
            )}
          </div>
        </Card>
        <Card title="Targets" subtitle="Predicted routing tier">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
              <PieChart>
                <Pie data={targetChartData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={hasTargetData ? 3 : 0} isAnimationActive={hasTargetData}>
                  {targetChartData.map((entry, index) => <Cell key={entry.name} fill={hasTargetData ? COLORS[index % COLORS.length] : NO_DATA_COLOR} />)}
                </Pie>
                {!hasTargetData && <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="var(--color-text-muted)" fontSize="12">No data yet</text>}
                {hasTargetData && <Tooltip contentStyle={{ background: "var(--color-surface)", borderColor: "var(--color-border)", borderRadius: 10 }} />}
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Runtime health">
          <div className="space-y-3 text-sm">
            <HealthRow label="9Router catalog" good={status.catalog.ready} value={status.catalog.ready ? `${status.catalog.models} models` : status.catalog.error || "Unavailable"} />
            <HealthRow label="Classifier" good={status.classifier.state === "ready" || status.classifier.state === "disabled"} value={status.classifier.state} />
            <HealthRow label="Decision storage" good={status.storage.ready} value={status.storage.ready ? "SQLite ready" : status.storage.error || "Degraded"} />
          </div>
        </Card>
        <Distribution title="Task classes" data={analytics.byTask} />
        <Distribution title="Complexity" data={analytics.byComplexity} />
      </div>
    </>
  );
}

function HealthRow({ label, good, value }) {
  return <div className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 text-text-muted">{label}</span><div className="flex min-w-0 items-center gap-2"><span className={`size-2 shrink-0 rounded-full ${good ? "bg-success" : "bg-danger"}`} /><span className="min-w-0 max-w-48 truncate">{value}</span></div></div>;
}

function Distribution({ title, data }) {
  const chartData = objectChart(data);
  const hasData = chartData.some((item) => Number(item.value) > 0);
  const barFill = title === "Task classes" ? TASK_CLASS_COLOR : null;
  return (
    <Card title={title}>
      <div className="h-44">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={80} stroke="var(--color-text-muted)" fontSize={11} />
              <Tooltip contentStyle={{ background: "var(--color-surface)", borderColor: "var(--color-border)", borderRadius: 10 }} />
              <Bar dataKey="value" fill={barFill || "#E56A4A"} radius={[0, 6, 6, 0]}>
                {!barFill && chartData.map((entry) => (
                  <Cell key={entry.name} fill={COMPLEXITY_COLORS[entry.name] || "#E56A4A"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center rounded-[12px] border border-dashed border-border-subtle text-sm text-text-muted">No data yet</div>
        )}
      </div>
    </Card>
  );
}

function setNested(object, path, value) {
  const copy = structuredClone(object);
  const parts = path.split(".");
  let cursor = copy;
  for (const part of parts.slice(0, -1)) cursor = cursor[part];
  cursor[parts.at(-1)] = value;
  return copy;
}

export function RoutingPage() {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      const [value, catalogState] = await Promise.all([
        api("/api/admin/config"),
        api("/api/admin/catalog"),
      ]);
      setState(value);
      setForm(value.config);
      setCatalog(catalogState.models || []);
      setError("");
    } catch (failure) { setError(failure.message); }
  }
  useEffect(() => { load(); }, []);
  if (!state || !form) return <Loading />;

  function field(path, value) { setForm((current) => setNested(current, path, value)); setSaved(false); }
  async function save() {
    try {
      const result = await api("/api/admin/config", {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: state.revision,
          patch: {
            upstream: {
              requestTimeoutMs: form.upstream.requestTimeoutMs,
              strictModelValidation: form.upstream.strictModelValidation,
            },
            routing: {
              targets: form.routing.targets,
              thresholds: form.routing.thresholds,
              ambiguityMargin: form.routing.ambiguityMargin,
              profiles: form.routing.profiles,
              shadowMode: form.routing.shadowMode,
              shadowTarget: form.routing.shadowTarget,
            },
            affinity: form.affinity,
            logging: {
              rawPrompts: form.logging.rawPrompts,
              retentionDays: form.logging.retentionDays,
            },
          },
        }),
      });
      setState(result);
      setForm(result.config);
      setSaved(true);
      setError("");
    } catch (failure) { setError(failure.message); }
  }

  return (
    <>
      <PageHeader title="Routing" description="Hot-applied policy settings for new prompt requests." action={<div className="flex items-center gap-3">{saved && <Badge tone="success">Saved</Badge>}<Button onClick={save}><Icon>save</Icon>Apply changes</Button></div>} />
      <ErrorBox error={error} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Upstream behavior" subtitle="Request handling and 9Router catalog validation.">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label="Request timeout (ms)" value={form.upstream.requestTimeoutMs} onChange={(value) => field("upstream.requestTimeoutMs", value)} />
            <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-bg p-3"><div className="min-w-0"><p className="text-sm font-medium">Strict model validation</p><p className="text-xs text-text-muted">Fail closed when a target is missing from the 9Router catalog.</p></div><div className="shrink-0"><Toggle checked={form.upstream.strictModelValidation} onChange={(value) => field("upstream.strictModelValidation", value)} /></div></div>
          </div>
        </Card>
        <Card title="Target mapping" subtitle="Each tier points to an existing 9Router combo or model.">
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(form.routing.targets).map(([key, value]) => (
              <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
                <Input list="catalog-targets" value={value} onChange={(event) => field(`routing.targets.${key}`, event.target.value)} />
              </Field>
            ))}
            <datalist id="catalog-targets">{catalog.map((model) => <option key={model} value={model} />)}</datalist>
          </div>
        </Card>
        <Card title="Complexity thresholds" subtitle="Scores below medium use small; scores at or above high use large.">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField label="Medium" value={form.routing.thresholds.medium} onChange={(value) => field("routing.thresholds.medium", value)} />
            <NumberField label="High" value={form.routing.thresholds.high} onChange={(value) => field("routing.thresholds.high", value)} />
            <NumberField label="Ambiguity margin" value={form.routing.ambiguityMargin} onChange={(value) => field("routing.ambiguityMargin", value)} />
          </div>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-success" style={{ width: `${form.routing.thresholds.medium}%` }} /><div className="relative -mt-3 ml-auto h-3 bg-danger" style={{ width: `${100 - form.routing.thresholds.high}%` }} /></div>
          <div className="mt-2 flex justify-between text-xs text-text-muted"><span>Low</span><span>Medium</span><span>High</span></div>
        </Card>
        <Card title="Virtual model profiles" subtitle="Bias uncertain prompts without bypassing safety floors.">
          <div className="space-y-4">
            {Object.entries(form.routing.profiles).map(([name, profile]) => (
              <div key={name} className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,7.5rem)] items-center gap-4">
                <div className="min-w-0"><p className="font-medium">{name}</p><p className="text-xs text-text-muted">{name === "auto-fast" ? "Favor cheaper tiers" : name === "auto-quality" ? "Favor stronger tiers" : "Balanced default"}</p></div>
                <Input type="number" value={profile.scoreBias} onChange={(event) => field(`routing.profiles.${name}.scoreBias`, Number(event.target.value))} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Shadow mode" subtitle="Record predictions while dispatching every virtual request to one target.">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">Enable shadow mode</p><p className="text-xs text-text-muted">Useful for policy calibration before active routing.</p></div><div className="shrink-0"><Toggle checked={form.routing.shadowMode} onChange={(value) => field("routing.shadowMode", value)} /></div></div>
          <div className="mt-4"><Field label="Shadow dispatch target"><Input list="catalog-targets" value={form.routing.shadowTarget} onChange={(event) => field("routing.shadowTarget", event.target.value)} /></Field></div>
        </Card>
        <Card title="Affinity and retention" subtitle="Conversation stability and local decision history.">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label="Affinity TTL (minutes)" value={Math.round(form.affinity.ttlMs / 60000)} onChange={(value) => field("affinity.ttlMs", value * 60000)} />
            <NumberField label="Maximum affinities" value={form.affinity.maxEntries} onChange={(value) => field("affinity.maxEntries", value)} />
            <NumberField label="History retention (days)" value={form.logging.retentionDays} onChange={(value) => field("logging.retentionDays", value)} />
            <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-bg p-3"><div className="min-w-0"><p className="text-sm font-medium">Store prompt/request context</p><p className="text-xs text-danger">Privacy-sensitive; enables richer feedback review.</p></div><div className="shrink-0"><Toggle checked={form.logging.rawPrompts} onChange={(value) => field("logging.rawPrompts", value)} /></div></div>
          </div>
        </Card>
      </div>
    </>
  );
}

export function TaskClassifierPage() {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [classDialog, setClassDialog] = useState(null);
  const [classIdDraft, setClassIdDraft] = useState("");
  const [deleteDialog, setDeleteDialog] = useState(null);

  async function load() {
    try {
      const value = await api("/api/admin/config");
      setState(value);
      setForm(value.config);
      setError("");
    } catch (failure) { setError(failure.message); }
  }
  useEffect(() => { load(); }, []);
  if (!state || !form) return <Loading />;

  function field(path, value) { setForm((current) => setNested(current, path, value)); setSaved(false); }
  function setTaskClasses(taskClasses) { field("routing.taskClasses", taskClasses); }
  function normalizeTaskClassId(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, "_"); }
  function taskClassDraftError() {
    const id = normalizeTaskClassId(classIdDraft);
    if (!id) return "Task class id is required";
    if (form.routing.taskClasses?.[id]) return `Task class ${id} already exists`;
    return "";
  }
  function updateTaskClass(id, patch) {
    setTaskClasses({
      ...(form.routing.taskClasses || {}),
      [id]: { ...(form.routing.taskClasses?.[id] || {}), ...patch },
    });
  }
  function openClassDialog(source = null) {
    setClassDialog({ source });
    setClassIdDraft(source ? `${source}_copy` : "custom");
    setError("");
  }
  function closeClassDialog() {
    setClassDialog(null);
    setClassIdDraft("");
  }
  function confirmClassDialog() {
    const id = normalizeTaskClassId(classIdDraft);
    if (!id || form.routing.taskClasses?.[id]) return;
    const source = classDialog?.source;
    const base = source && form.routing.taskClasses?.[source]
      ? structuredClone(form.routing.taskClasses[source])
      : { task: true, semanticLabel: id.replace(/[-_]/g, " "), semanticScore: 45, priority: 0, scoreDelta: 0, patterns: [] };
    setTaskClasses({ ...(form.routing.taskClasses || {}), [id]: base });
    closeClassDialog();
    setError("");
  }
  function openDeleteDialog(id) {
    if (id === "general") return;
    setDeleteDialog({ id });
  }
  function closeDeleteDialog() { setDeleteDialog(null); }
  function confirmDeleteDialog() {
    const id = deleteDialog?.id;
    if (id === "general") return;
    const next = { ...(form.routing.taskClasses || {}) };
    delete next[id];
    setTaskClasses(next);
    closeDeleteDialog();
  }
  async function save() {
    try {
      const result = await api("/api/admin/config", {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: state.revision,
          patch: {
            routing: { taskClasses: form.routing.taskClasses },
            classifier: {
              enabled: form.classifier.enabled,
              timeoutMs: form.classifier.timeoutMs,
              minimumConfidence: form.classifier.minimumConfidence,
              localFilesOnly: form.classifier.localFilesOnly,
            },
          },
        }),
      });
      setState(result);
      setForm(result.config);
      setSaved(true);
      setError("");
    } catch (failure) { setError(failure.message); }
  }

  return (
    <>
      <PageHeader title="Task Classifier" description="Dashboard-managed classifier labels, regex signals, scoring, and semantic model settings." action={<div className="flex items-center gap-3">{saved && <Badge tone="success">Saved</Badge>}<Button onClick={save}><Icon>save</Icon>Apply changes</Button></div>} />
      <ErrorBox error={error} />
      <Dialog
        open={Boolean(classDialog)}
        title={classDialog?.source ? "Duplicate task class" : "Add task class"}
        description="Use lowercase letters, numbers, underscores, or hyphens. Spaces are converted to underscores."
        confirmLabel={classDialog?.source ? "Duplicate" : "Add class"}
        confirmDisabled={Boolean(taskClassDraftError())}
        onCancel={closeClassDialog}
        onConfirm={confirmClassDialog}
      >
        <Field label="Task class id">
          <Input autoFocus value={classIdDraft} onChange={(event) => setClassIdDraft(event.target.value)} />
        </Field>
        {taskClassDraftError() && <p className="mt-2 text-sm text-danger">{taskClassDraftError()}</p>}
        {!taskClassDraftError() && <p className="mt-2 text-sm text-text-muted">Will be saved as <code className="rounded bg-bg px-1 py-0.5 font-mono text-text-main">{normalizeTaskClassId(classIdDraft)}</code>.</p>}
      </Dialog>
      <Dialog
        open={Boolean(deleteDialog)}
        title="Delete task class?"
        description={`Remove ${deleteDialog?.id || "this task class"} from the classifier editor. This is not persisted until you apply changes.`}
        confirmLabel="Delete"
        destructive
        onCancel={closeDeleteDialog}
        onConfirm={confirmDeleteDialog}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Semantic classifier" subtitle={`${form.classifier.model} at ${(form.classifier.revision || "unknown").slice(0, 8)}`}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">Use semantic classification</p>
              <p className="text-xs text-text-muted">Only for prompts near a decision boundary.</p>
            </div>
            <div className="shrink-0"><Toggle checked={form.classifier.enabled} onChange={(value) => field("classifier.enabled", value)} /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label="Timeout (ms)" value={form.classifier.timeoutMs} onChange={(value) => field("classifier.timeoutMs", value)} />
            <NumberField label="Minimum confidence" step="0.01" value={form.classifier.minimumConfidence} onChange={(value) => field("classifier.minimumConfidence", value)} />
            <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-bg p-3 sm:col-span-2"><div className="min-w-0"><p className="text-sm font-medium">Use local model files only</p><p className="text-xs text-text-muted">Require cached classifier files instead of downloading missing model assets.</p></div><div className="shrink-0"><Toggle checked={form.classifier.localFilesOnly} onChange={(value) => field("classifier.localFilesOnly", value)} /></div></div>
          </div>
        </Card>
        <Card
          title="Task classes"
          subtitle="Classifier labels, regex signals, scoring, and hard floors."
          className="xl:col-span-2"
          action={<Button variant="secondary" onClick={() => openClassDialog()}><Icon>add</Icon>Add class</Button>}
        >
          <div className="space-y-4">
            {Object.entries(form.routing.taskClasses || {}).map(([id, taskClass]) => {
              const isGeneral = id === "general";
              return (
                <div key={id} className="rounded-[12px] border border-border bg-bg p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{id}</p>
                      <p className="text-xs text-text-muted">{taskClass.task === false ? "Signal-only class" : "Reported task class"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" className="min-h-8 px-2 py-1 text-xs" onClick={() => openClassDialog(id)}>Duplicate</Button>
                      <Button variant="ghost" className="min-h-8 px-2 py-1 text-xs text-danger hover:text-danger" disabled={isGeneral} onClick={() => openDeleteDialog(id)}>Delete</Button>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border-subtle bg-surface p-3"><div className="min-w-0"><p className="text-sm font-medium">Report as task</p><p className="text-xs text-text-muted">Disable for scoring-only signals.</p></div><div className="shrink-0"><Toggle checked={taskClass.task !== false} disabled={isGeneral} onChange={(value) => updateTaskClass(id, { task: value })} /></div></div>
                    <NumberField label="Semantic score" value={taskClass.semanticScore ?? 45} onChange={(value) => updateTaskClass(id, { semanticScore: value })} />
                    <NumberField label="Priority" value={taskClass.priority ?? 0} onChange={(value) => updateTaskClass(id, { priority: value })} />
                    <NumberField label="Score delta" value={taskClass.scoreDelta ?? 0} onChange={(value) => updateTaskClass(id, { scoreDelta: value })} />
                    <Field label="Semantic label">
                      <Input value={taskClass.semanticLabel || ""} disabled={taskClass.task === false} onChange={(event) => updateTaskClass(id, { semanticLabel: event.target.value })} />
                    </Field>
                    <Field label="Hard floor">
                      <Select value={taskClass.hardFloor || ""} onChange={(event) => updateTaskClass(id, { hardFloor: event.target.value || null })}>
                        <option value="">None</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </Select>
                    </Field>
                    <Field label="Regex patterns" hint="One JavaScript regex per line.">
                      <textarea className="min-h-28 w-full rounded-[10px] border border-border bg-bg px-3 py-2 text-sm text-text-main outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 sm:col-span-2" value={(taskClass.patterns || []).join("\n")} onChange={(event) => updateTaskClass(id, { patterns: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} />
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}

function NumberField({ label, value, onChange, step = "1", disabled = false, hint = null }) {
  return <Field label={label} hint={hint}><Input type="number" step={step} disabled={disabled} value={value} onChange={(event) => onChange(Number(event.target.value))} /></Field>;
}

export function DecisionsPage() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ target: "", task: "", complexity: "", status: "", mode: "" });
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchOptions, setBatchOptions] = useState({ judgeModel: "", minConfidence: 0.7 });
  const [batchProgress, setBatchProgress] = useState(null);
  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString(), [filters]);

  async function load(cursor = "") {
    try {
      const value = await api(`/api/admin/decisions?limit=50&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      setData((current) => cursor ? { ...value, items: [...(current?.items || []), ...value.items] } : value);
      setError("");
    } catch (failure) { setError(failure.message); }
  }
  useEffect(() => { load(); }, [query]);
  useEffect(() => { api("/api/admin/catalog").then((value) => setCatalog(value.models || [])).catch(() => {}); }, []);
  if (!data) return <Loading />;

  async function openDecision(id) {
    try { setSelected(await api(`/api/admin/decisions/${encodeURIComponent(id)}`)); }
    catch (failure) { setError(failure.message); }
  }

  function updateDecisionRow(updated) {
    setData((current) => current ? {
      ...current,
      items: current.items.map((item) => item.requestId === updated.requestId ? updated : item),
    } : current);
  }

  function updateDecision(updated) {
    setSelected(updated);
    updateDecisionRow(updated);
  }

  async function fetchReviewQueue() {
    const items = [];
    let cursor = "";
    do {
      const value = await api(`/api/admin/decisions?limit=100&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      items.push(...(value.items || []).filter((item) => !item.reviewed));
      cursor = value.nextCursor || "";
    } while (cursor);
    return items;
  }

  async function markReviewedFromSuggestion(requestId, suggestion) {
    const feedback = reviewFeedbackForSuggestion(suggestion, Number(batchOptions.minConfidence) || 0.7);
    return api(`/api/admin/decisions/${encodeURIComponent(requestId)}/feedback`, {
      method: "PUT",
      body: JSON.stringify({ ...feedback, createPromptCorrection: false }),
    });
  }

  async function runBatchReview() {
    setError("");
    setBatchProgress({ loading: true, current: 0, total: 0, reviewed: 0, corrected: 0, correct: 0, uncertain: 0, skipped: 0, failed: 0, currentId: "", done: false });
    try {
      const queue = await fetchReviewQueue();
      setBatchProgress((progress) => ({ ...progress, loading: false, total: queue.length }));
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        setBatchProgress((progress) => ({ ...progress, current: index, currentId: item.requestId }));
        try {
          const review = await api(`/api/admin/decisions/${encodeURIComponent(item.requestId)}/review`, {
            method: "POST",
            body: JSON.stringify({
              judgeModel: batchOptions.judgeModel || undefined,
              minConfidence: Number(batchOptions.minConfidence) || 0.7,
            }),
          });
          if (!review.eligible) {
            setBatchProgress((progress) => ({ ...progress, skipped: progress.skipped + 1 }));
          } else if (review.suggestion?.applyDefault) {
            const result = await api(`/api/admin/decisions/${encodeURIComponent(item.requestId)}/review/apply`, {
              method: "POST",
              body: JSON.stringify({
                expectedRevision: review.configRevision,
                suggestion: review.suggestion,
                minConfidence: Number(batchOptions.minConfidence) || 0.7,
                enablePromptCorrection: true,
              }),
            });
            updateDecisionRow(result.decision);
            setBatchProgress((progress) => ({ ...progress, reviewed: progress.reviewed + 1, corrected: progress.corrected + 1 }));
          } else {
            const updated = await markReviewedFromSuggestion(item.requestId, review.suggestion);
            updateDecisionRow(updated);
            setBatchProgress((progress) => ({
              ...progress,
              reviewed: progress.reviewed + 1,
              correct: progress.correct + (review.suggestion?.verdict === "correct" ? 1 : 0),
              uncertain: progress.uncertain + (review.suggestion?.verdict === "uncertain" ? 1 : 0),
            }));
          }
        } catch (failure) {
          setBatchProgress((progress) => ({ ...progress, failed: progress.failed + 1 }));
        }
        setBatchProgress((progress) => ({ ...progress, current: index + 1 }));
      }
      setBatchProgress((progress) => ({ ...progress, currentId: "", done: true }));
      await load();
    } catch (failure) {
      setError(failure.message);
      setBatchProgress(null);
      setBatchOpen(false);
    }
  }

  return (
    <>
      <PageHeader title="Decisions" description="Queryable routing history, upstream outcomes, tokens, and operator feedback." action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => load()}><Icon>refresh</Icon>Refresh</Button><Button onClick={() => setBatchOpen(true)}><Icon>rate_review</Icon>Review all</Button></div>} />
      <ErrorBox error={error} />
      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Filter label="Target" value={filters.target} values={["small","medium","planning","large","vision"]} onChange={(value) => setFilters({ ...filters, target: value })} />
          <Filter label="Task" value={filters.task} values={["quick","coding","debugging","planning","review","research","general"]} onChange={(value) => setFilters({ ...filters, task: value })} />
          <Filter label="Complexity" value={filters.complexity} values={["low","medium","high"]} onChange={(value) => setFilters({ ...filters, complexity: value })} />
          <Filter label="Mode" value={filters.mode} values={["active","shadow"]} onChange={(value) => setFilters({ ...filters, mode: value })} />
          <Field label="Status"><Input placeholder="e.g. 200" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} /></Field>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {data.items.length === 0 ? <Empty title="No decisions found" description="Send a request through auto, auto-fast, or auto-quality." /> : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-muted"><tr>{["Request","Reviewed","Task","Complexity","Target","Score","Outcome","Latency",""].map((header) => <th key={header} className="px-4 py-3 font-semibold">{header}</th>)}</tr></thead>
              <tbody>{data.items.map((item) => (
                <tr key={item.requestId} className="border-t border-border-subtle hover:bg-surface-2/50">
                  <td className="px-4 py-3 whitespace-nowrap"><div className="font-medium">{new Date(item.timestamp).toLocaleString()}</div><button type="button" className="mt-1 font-mono text-xs text-text-muted hover:text-primary" title="Copy request ID" onClick={() => copyText(item.requestId)}>{shortRequestId(item.requestId)}</button></td>
                  <td className="px-4 py-3"><Badge tone={item.reviewed ? "success" : "neutral"}>{item.reviewed ? "Reviewed" : "Needs review"}</Badge></td>
                  <td className="px-4 py-3"><Badge tone="info">{item.task}</Badge></td>
                  <td className="px-4 py-3"><Badge tone={item.complexity === "high" ? "danger" : item.complexity === "medium" ? "warning" : "success"}>{item.complexity}</Badge></td>
                  <td className="px-4 py-3 font-medium">{item.targetKey}</td>
                  <td className="px-4 py-3">{item.score}</td>
                  <td className="px-4 py-3"><Badge tone={item.status >= 200 && item.status < 400 ? "success" : item.status ? "danger" : "neutral"}>{item.status || "pending"}</Badge></td>
                  <td className="px-4 py-3">{item.latencyMs != null ? `${item.latencyMs} ms` : "—"}</td>
                  <td className="px-4 py-3"><Button variant="ghost" onClick={() => openDecision(item.requestId)}><Icon>open_in_new</Icon></Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {data.nextCursor && <div className="mt-4 text-center"><Button variant="secondary" onClick={() => load(data.nextCursor)}>Load more</Button></div>}
      </Card>
      {selected && <DecisionDrawer item={selected} onClose={() => setSelected(null)} onUpdate={updateDecision} />}
      <Dialog
        open={batchOpen}
        title="Review all matching decisions?"
        description="Reviews every unreviewed decision matching the current filters, one at a time, using the selected model. Correct and uncertain verdicts are saved as feedback so decisions become reviewed."
        confirmLabel={batchProgress ? (batchProgress.done ? "Done" : "Reviewing...") : "Start review"}
        confirmDisabled={Boolean(batchProgress && !batchProgress.done)}
        showCancel={!batchProgress || batchProgress.done}
        onCancel={() => {
          if (batchProgress && !batchProgress.done) return;
          setBatchOpen(false);
          setBatchProgress(null);
        }}
        onConfirm={() => batchProgress?.done ? (setBatchOpen(false), setBatchProgress(null)) : runBatchReview()}
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Judge model"><Select disabled={Boolean(batchProgress && !batchProgress.done)} value={batchOptions.judgeModel} onChange={(event) => setBatchOptions({ ...batchOptions, judgeModel: event.target.value })}><option value="">Default smart-small</option>{catalog.map((model) => <option key={model}>{model}</option>)}</Select></Field>
            <Field label="Min confidence"><Input disabled={Boolean(batchProgress && !batchProgress.done)} type="number" step="0.05" min="0" max="1" value={batchOptions.minConfidence} onChange={(event) => setBatchOptions({ ...batchOptions, minConfidence: event.target.value })} /></Field>
          </div>
          <p className="text-xs text-text-muted">Scope: all unreviewed decisions matching current filters. Missing prompt/request context is skipped.</p>
          {batchProgress && <div className="rounded-[10px] border border-border bg-bg p-3 text-sm">
            <div className="flex items-center justify-between gap-3"><span className="font-medium">Progress</span><span>{batchProgress.current} / {batchProgress.total}</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full bg-primary transition-all" style={{ width: `${batchProgress.total ? Math.round((batchProgress.current / batchProgress.total) * 100) : 0}%` }} /></div>
            {batchProgress.currentId && <p className="mt-2 break-all text-xs text-text-muted">Current: {batchProgress.currentId}</p>}
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-muted">
              <Badge tone="success">Reviewed {batchProgress.reviewed}</Badge>
              <Badge tone="success">Correct {batchProgress.correct}</Badge>
              <Badge tone="primary">Corrected {batchProgress.corrected}</Badge>
              <Badge tone="warning">Uncertain {batchProgress.uncertain}</Badge>
              <Badge tone="neutral">Skipped {batchProgress.skipped}</Badge>
              <Badge tone={batchProgress.failed ? "danger" : "neutral"}>Failed {batchProgress.failed}</Badge>
            </div>
          </div>}
        </div>
      </Dialog>
    </>
  );
}

function Filter({ label, value, values, onChange }) {
  return <Field label={label}><Select value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{values.map((item) => <option key={item}>{item}</option>)}</Select></Field>;
}

function DecisionDrawer({ item, onClose, onUpdate }) {
  const [rating, setRating] = useState(item.feedback?.rating || 0);
  const [expectedTarget, setExpectedTarget] = useState(item.feedback?.expectedTarget || "");
  const [note, setNote] = useState(item.feedback?.note || "");
  const [createPromptCorrection, setCreatePromptCorrection] = useState(false);
  const [promptCorrectionTouched, setPromptCorrectionTouched] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [review, setReview] = useState(null);
  const [reviewOptions, setReviewOptions] = useState({ judgeModel: "", minConfidence: 0.7 });
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const hasFeedback = Boolean(item.feedback);
  useEffect(() => { api("/api/admin/catalog").then((value) => setCatalog(value.models || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (!expectedTarget) {
      setCreatePromptCorrection(false);
      return;
    }
    if (!promptCorrectionTouched) setCreatePromptCorrection(rating === 1 || rating === 2);
  }, [rating, expectedTarget, promptCorrectionTouched]);
  async function saveFeedback() {
    const updated = await api(`/api/admin/decisions/${encodeURIComponent(item.requestId)}/feedback`, {
      method: "PUT",
      body: JSON.stringify({ rating, expectedTarget: expectedTarget || null, note: note || null, createPromptCorrection }),
    });
    onUpdate(updated);
  }
  async function resetFeedback() {
    const updated = await api(`/api/admin/decisions/${encodeURIComponent(item.requestId)}/feedback`, {
      method: "DELETE",
    });
    setRating(0);
    setExpectedTarget("");
    setNote("");
    setCreatePromptCorrection(false);
    setPromptCorrectionTouched(false);
    onUpdate(updated);
  }
  async function reviewDecision() {
    setReviewLoading(true); setReviewError("");
    try {
      const value = await api(`/api/admin/decisions/${encodeURIComponent(item.requestId)}/review`, {
        method: "POST",
        body: JSON.stringify({
          judgeModel: reviewOptions.judgeModel || undefined,
          minConfidence: Number(reviewOptions.minConfidence) || 0.7,
        }),
      });
      setReview(value);
    } catch (failure) { setReviewError(failure.message); }
    finally { setReviewLoading(false); }
  }
  async function applyReview() {
    if (!review?.suggestion) return;
    setReviewLoading(true); setReviewError("");
    try {
      const value = await api(`/api/admin/decisions/${encodeURIComponent(item.requestId)}/review/apply`, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: review.configRevision,
          suggestion: review.suggestion,
          minConfidence: Number(reviewOptions.minConfidence) || 0.7,
          enablePromptCorrection: true,
        }),
      });
      setRating(value.decision.feedback?.rating || 0);
      setExpectedTarget(value.decision.feedback?.expectedTarget || "");
      setNote(value.decision.feedback?.note || "");
      setReview({ ...review, applyResult: value });
      onUpdate(value.decision);
    } catch (failure) { setReviewError(failure.message); }
    finally { setReviewLoading(false); }
  }
  return (
    <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose}>
      <aside className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto bg-surface p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-lg font-semibold">Decision details</h2><code className="block break-all text-xs text-text-muted">{item.requestId}</code></div><Button variant="ghost" className="shrink-0" onClick={onClose}><Icon>close</Icon></Button></div>
        {item.prompt && <div className="mb-4 rounded-[10px] border border-danger/20 bg-danger/5 p-3"><p className="mb-1 text-xs font-semibold uppercase text-danger">Raw prompt stored</p><p className="whitespace-pre-wrap text-sm">{item.prompt}</p></div>}
        {item.request && <div className="mb-4 rounded-[10px] border border-warning/20 bg-warning/5 p-3"><p className="mb-1 text-xs font-semibold uppercase text-warning">Request context stored{item.request.truncated ? " (truncated)" : ""}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{typeof item.request.body === "string" ? item.request.body : JSON.stringify(item.request.body, null, 2)}</pre></div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["Predicted target", item.target],
            ["Task", item.task],
            ["Complexity", item.complexity],
            ["Score", item.score],
            ["Confidence", item.confidence],
            ["Mode", item.mode],
            ["Status", item.status || "pending"],
            ["Latency", item.latencyMs != null ? `${item.latencyMs} ms` : "—"],
            ["Request IP", item.clientIp || "—"],
            ["User agent", item.userAgent || item.client || "—"],
            ["Reviewed", item.reviewed ? "yes" : "no"],
            ["Estimated input", `${item.estimatedTokens || 0} tokens`],
            ["Actual tokens", item.tokens?.totalTokens ?? "—"],
            ["Classifier", item.classifierUsed ? "used" : "rules only"],
            ["Affinity", item.affinityHeld ? "held stronger tier" : "not held"],
          ].map(([label, value]) => <div key={label} className="rounded-[10px] bg-bg p-3"><p className="text-xs text-text-muted">{label}</p><p className="mt-1 font-medium">{String(value)}</p></div>)}
        </div>
        <Card title="Signals" className="mt-5"><div className="flex flex-wrap gap-2">{(item.reasons || []).length ? item.reasons.map((reason) => <Badge key={reason} tone="primary">{reason}</Badge>) : <span className="text-sm text-text-muted">No keyword signals.</span>}</div></Card>
        <Card title="Operator feedback" className="mt-5">
          <div className="space-y-4">
            <div className="rounded-[10px] border border-border-subtle bg-bg p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Judge model"><Select value={reviewOptions.judgeModel} onChange={(event) => setReviewOptions({ ...reviewOptions, judgeModel: event.target.value })}><option value="">Default smart-small</option>{catalog.map((model) => <option key={model}>{model}</option>)}</Select></Field>
                <Field label="Min confidence"><Input type="number" step="0.05" min="0" max="1" value={reviewOptions.minConfidence} onChange={(event) => setReviewOptions({ ...reviewOptions, minConfidence: event.target.value })} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3"><Button variant="secondary" onClick={reviewDecision} disabled={reviewLoading}><Icon>rate_review</Icon>{reviewLoading ? "Reviewing..." : "Review with model"}</Button>{reviewError && <span className="text-xs text-danger">{reviewError}</span>}</div>
              <p className="mt-2 text-xs text-text-muted">Reviews only this decision and sends stored prompt/request context to the selected upstream judge model.</p>
              {review && <div className="mt-3 rounded-[10px] border border-border bg-surface p-3 text-sm">
                {!review.eligible ? <p className="text-warning">Skipped: {review.skipReason}</p> : <>
                  <p>Verdict: <strong>{review.suggestion?.verdict}</strong>{review.suggestion?.expectedTargetKey ? <> · suggested <strong>{review.suggestion.expectedTargetKey}</strong></> : null}</p>
                  <p className="mt-1 text-xs text-text-muted">Confidence {review.suggestion?.confidence} · {review.suggestion?.rationale || "No rationale"}</p>
                  {review.applyResult ? <p className="mt-2 text-xs text-success">Applied feedback and prompt correction.</p> : <Button className="mt-3" disabled={!review.suggestion?.applyDefault || reviewLoading} onClick={applyReview}><Icon>done_all</Icon>Apply suggestion</Button>}
                </>}
              </div>}
            </div>
            <Field label="Rating"><div className="flex gap-1">{[1,2,3,4,5].map((value) => <button key={value} className={`text-2xl ${value <= rating ? "text-warning" : "text-surface-3"}`} onClick={() => setRating(value)}>★</button>)}</div></Field>
            <Field label="Expected target"><Select value={expectedTarget} onChange={(event) => setExpectedTarget(event.target.value)}><option value="">No correction</option>{["smart-small","smart-medium","smart-planning","smart-large","smart-vision"].map((value) => <option key={value}>{value}</option>)}</Select></Field>
            <label className={`flex items-start gap-3 rounded-[10px] border border-border-subtle bg-bg p-3 text-sm ${expectedTarget ? "" : "opacity-60"}`}>
              <input type="checkbox" className="mt-1" checked={createPromptCorrection} disabled={!expectedTarget} onChange={(event) => { setPromptCorrectionTouched(true); setCreatePromptCorrection(event.target.checked); }} />
              <span><span className="font-medium">Create routing correction from this feedback</span><span className="mt-1 block text-xs text-text-muted">Future requests with the same prompt hash can use the selected expected target.</span></span>
            </label>
            <Field label="Note"><textarea className="min-h-24 w-full rounded-[10px] border border-border bg-bg p-3 text-sm outline-none focus:border-primary" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
            <div className="flex gap-3">
              <Button disabled={!rating} onClick={saveFeedback}>Save feedback</Button>
              <Button variant="secondary" disabled={!hasFeedback} onClick={resetFeedback}>Reset feedback</Button>
            </div>
          </div>
        </Card>
      </aside>
    </div>
  );
}

export function PlaygroundPage() {
  const [format, setFormat] = useState("chat");
  const [model, setModel] = useState("auto");
  const [prompt, setPrompt] = useState("Plan a zero downtime database migration with rollback.");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true); setError("");
    const request = format === "responses"
      ? { model, input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }] }
      : { model, messages: [{ role: "user", content: prompt }] };
    const path = format === "anthropic" ? "/v1/messages" : format === "responses" ? "/v1/responses" : "/v1/chat/completions";
    try { setResult(await api("/api/admin/explain", { method: "POST", body: JSON.stringify({ path, request }) })); }
    catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }

  return (
    <>
      <PageHeader title="Playground" description="Explain a route without dispatching or mutating conversation affinity." action={<Button onClick={run} disabled={loading}><Icon>play_arrow</Icon>{loading ? "Classifying..." : "Explain route"}</Button>} />
      <ErrorBox error={error} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Request">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="API format"><Select value={format} onChange={(event) => setFormat(event.target.value)}><option value="chat">OpenAI Chat</option><option value="responses">OpenAI Responses</option><option value="anthropic">Anthropic Messages</option></Select></Field>
            <Field label="Virtual model"><Select value={model} onChange={(event) => setModel(event.target.value)}><option>auto</option><option>auto-fast</option><option>auto-quality</option></Select></Field>
          </div>
          <Field label="Prompt"><textarea className="mt-4 min-h-72 w-full rounded-[10px] border border-border bg-bg p-3 text-sm leading-6 outline-none focus:border-primary" value={prompt} onChange={(event) => setPrompt(event.target.value)} /></Field>
        </Card>
        <Card title="Decision explanation" subtitle="Deterministic features plus accepted semantic evidence.">
          {!result ? <Empty icon="science" title="No result yet" description="Enter a prompt and explain its route." /> : result.passthrough ? <Empty title="Passthrough request" description="Only virtual models invoke smart routing." /> : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Result label="Predicted target" value={result.decision.target} />
                <Result label="Dispatch target" value={result.decision.dispatchTarget} />
                <Result label="Task" value={result.decision.task} />
                <Result label="Complexity" value={result.decision.complexity} />
                <Result label="Final score" value={result.decision.score} />
                <Result label="Confidence" value={result.decision.confidence} />
                <Result label="Rule score" value={result.decision.ruleScore} />
                <Result label="Semantic class" value={result.decision.semanticLabel || "not used"} />
              </div>
              <div><p className="mb-2 text-sm font-medium">Signals</p><div className="flex flex-wrap gap-2">{result.decision.reasons.length ? result.decision.reasons.map((reason) => <Badge key={reason} tone="primary">{reason}</Badge>) : <Badge>none</Badge>}</div></div>
              <div><p className="mb-2 text-sm font-medium">Extracted features</p><pre className="max-h-60 overflow-auto rounded-[10px] bg-bg p-3 text-xs text-text-muted">{JSON.stringify(result.features, null, 2)}</pre></div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Result({ label, value }) {
  return <div className="rounded-[10px] bg-bg p-3"><p className="text-xs text-text-muted">{label}</p><p className="mt-1 font-semibold">{String(value)}</p></div>;
}

const API_KEY_EXPIRY_CHOICES = [
  { value: "never", label: "Never" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

function expiryFromChoice(choice) {
  if (choice === "never") return null;
  const days = Number(choice.slice(0, -1));
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function formatApiKeyDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function apiKeyQuotaText(key) {
  if (!key.quotaPeriod || !key.quotaLimit) return "Unlimited requests";
  const label = key.quotaPeriod === "day" ? "today" : "this month";
  return `${key.quotaUsed || 0} / ${key.quotaLimit} ${label}`;
}

function apiKeyModelLimitText(key) {
  return key.forcedModel ? `Model limited to ${key.forcedModel}` : "All models allowed";
}

function apiKeyQuotaDraft(key) {
  return {
    quotaPeriod: key.quotaPeriod || "none",
    quotaLimit: key.quotaLimit || 100,
    forcedModel: key.forcedModel || "",
  };
}

function ModelLimitInput({ value, onChange, models }) {
  const [open, setOpen] = useState(false);
  const query = String(value || "").trim().toLowerCase();
  const options = models.filter((model) => !query || model.toLowerCase().includes(query));
  function choose(model) {
    onChange(model);
    setOpen(false);
  }
  return (
    <div className="relative">
      <Input
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
        placeholder="No model limit"
      />
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-56 overflow-y-auto rounded-[10px] border border-border bg-surface p-1 shadow-2xl">
          <button type="button" className="block w-full rounded-[8px] px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-2" onMouseDown={(event) => { event.preventDefault(); choose(""); }}>
            No model limit
          </button>
          {options.length ? options.map((model) => (
            <button key={model} type="button" className="block w-full rounded-[8px] px-3 py-2 text-left text-sm text-text-main hover:bg-surface-2" onMouseDown={(event) => { event.preventDefault(); choose(model); }}>
              {model}
            </button>
          )) : (
            <div className="px-3 py-2 text-sm text-text-muted">No catalog match. Custom value is allowed.</div>
          )}
        </div>
      )}
    </div>
  );
}

export function ApiKeysPage() {
  const [config, setConfig] = useState(null);
  const [apiKeys, setApiKeys] = useState([]);
  const [catalogModels, setCatalogModels] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [toggleSaving, setToggleSaving] = useState(false);
  const [keySaving, setKeySaving] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyExpiry, setKeyExpiry] = useState("never");
  const [keyQuotaPeriod, setKeyQuotaPeriod] = useState("none");
  const [keyQuotaLimit, setKeyQuotaLimit] = useState(100);
  const [keyForcedModel, setKeyForcedModel] = useState("");
  const [createdKey, setCreatedKey] = useState(null);
  const [revealedKeys, setRevealedKeys] = useState({});
  const [quotaDrafts, setQuotaDrafts] = useState({});

  function applyKeys(items) {
    setApiKeys(items);
    setQuotaDrafts(Object.fromEntries(items.map((item) => [item.id, apiKeyQuotaDraft(item)])));
  }

  async function load() {
    try {
      const [nextConfig, nextKeys, nextCatalog] = await Promise.all([
        api("/api/admin/config"),
        api("/api/admin/api-keys"),
        api("/api/admin/catalog"),
      ]);
      setConfig(nextConfig);
      applyKeys(nextKeys.items || []);
      setCatalogModels(nextCatalog.models || []);
      setError("");
    } catch (failure) {
      setError(failure.message);
    }
  }

  useEffect(() => { load(); }, []);
  if (!config) return <Loading />;

  const authEnabled = Boolean(config.config?.security?.apiKeyAuthEnabled);

  async function updateApiKeyAuth(enabled) {
    const previous = config;
    setToggleSaving(true);
    setError("");
    setConfig((current) => ({
      ...current,
      config: {
        ...current.config,
        security: { ...current.config?.security, apiKeyAuthEnabled: enabled },
      },
    }));
    try {
      const result = await api("/api/admin/config", {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: previous.revision,
          patch: { security: { apiKeyAuthEnabled: enabled } },
        }),
      });
      setConfig(result);
      setMessage(`API key requirement ${enabled ? "enabled" : "disabled"}`);
    } catch (failure) {
      setConfig(previous);
      setError(failure.message);
    } finally {
      setToggleSaving(false);
    }
  }

  async function createApiKey() {
    setCreateSaving(true);
    setError("");
    try {
      const result = await api("/api/admin/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: keyName.trim(),
          expiresAt: expiryFromChoice(keyExpiry),
          quotaPeriod: keyQuotaPeriod === "none" ? null : keyQuotaPeriod,
          quotaLimit: keyQuotaPeriod === "none" ? null : keyQuotaLimit,
          forcedModel: keyForcedModel.trim() || null,
        }),
      });
      setCreateOpen(false);
      setCreatedKey(result);
      setKeyName("");
      setKeyExpiry("never");
      setKeyQuotaPeriod("none");
      setKeyQuotaLimit(100);
      setKeyForcedModel("");
      setMessage(`API key created: ${result.name}`);
      const nextKeys = await api("/api/admin/api-keys");
      applyKeys(nextKeys.items || []);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setCreateSaving(false);
    }
  }

  async function setKeyActive(key, active) {
    const previous = apiKeys;
    setKeySaving(key.id);
    setError("");
    setApiKeys((items) => items.map((item) => (
      item.id === key.id
        ? { ...item, active, status: active ? (item.status === "expired" ? "expired" : "active") : "inactive" }
        : item
    )));
    try {
      const result = await api(`/api/admin/api-keys/${encodeURIComponent(key.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      setApiKeys((items) => items.map((item) => item.id === key.id ? result : item));
      setMessage(`${key.name} ${active ? "enabled" : "disabled"}`);
    } catch (failure) {
      setApiKeys(previous);
      setError(failure.message);
    } finally {
      setKeySaving(null);
    }
  }

  async function updateKeyQuota(key) {
    const draft = quotaDrafts[key.id] || apiKeyQuotaDraft(key);
    const previous = apiKeys;
    setKeySaving(key.id);
    setError("");
    try {
      const result = await api(`/api/admin/api-keys/${encodeURIComponent(key.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          quotaPeriod: draft.quotaPeriod === "none" ? null : draft.quotaPeriod,
          quotaLimit: draft.quotaPeriod === "none" ? null : Number(draft.quotaLimit),
          forcedModel: String(draft.forcedModel || "").trim() || null,
        }),
      });
      setApiKeys((items) => items.map((item) => item.id === key.id ? result : item));
      setQuotaDrafts((current) => ({ ...current, [key.id]: apiKeyQuotaDraft(result) }));
      setMessage(`${key.name} limits updated`);
    } catch (failure) {
      setApiKeys(previous);
      setError(failure.message);
    } finally {
      setKeySaving(null);
    }
  }

  function deleteApiKey(key) {
    setDialog({
      title: `Delete ${key.name}?`,
      description: "This permanently deletes the API key and cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
      action: async () => {
        await api(`/api/admin/api-keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
        setApiKeys((items) => items.filter((item) => item.id !== key.id));
        setMessage(`API key deleted: ${key.name}`);
      },
    });
  }

  async function copyCreatedSecret() {
    try {
      await navigator.clipboard.writeText(createdKey.secret);
      setMessage("API key copied");
    } catch {
      setError("Unable to copy the API key");
    }
  }

  async function copyApiKey(key) {
    if (!key.secret) return;
    try {
      await navigator.clipboard.writeText(key.secret);
      setMessage(`${key.name} copied`);
    } catch {
      setError("Unable to copy the API key");
    }
  }

  async function confirmDialog() {
    const current = dialog;
    setDialog(null);
    try {
      await current.action();
    } catch (failure) {
      setError(failure.message);
    }
  }

  return (
    <>
      <PageHeader
        title={<span className="inline-flex items-center gap-3"><Icon className="text-primary">key</Icon>API Keys</span>}
        action={<Button className="px-5" onClick={() => setCreateOpen(true)}><Icon>add</Icon>Create Key</Button>}
      />
      <ErrorBox error={error} />
      {message && <div className="mb-4 rounded-[10px] bg-success/10 px-4 py-3 text-sm text-success">{message}</div>}
      <Dialog open={Boolean(dialog)} title={dialog?.title} description={dialog?.description} confirmLabel={dialog?.confirmLabel} destructive={dialog?.destructive} onCancel={() => setDialog(null)} onConfirm={confirmDialog} />
      <Dialog
        open={createOpen}
        title="Create API key"
        description="Choose a name and expiration for the new key."
        confirmLabel={createSaving ? "Creating..." : "Create key"}
        confirmDisabled={createSaving || !keyName.trim()}
        onCancel={() => setCreateOpen(false)}
        onConfirm={createApiKey}
      >
        <div className="space-y-4">
          <Field label="Key name">
            <Input autoFocus value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Key name" />
          </Field>
          <Field label="Expiration">
            <Select value={keyExpiry} onChange={(event) => setKeyExpiry(event.target.value)}>
              {API_KEY_EXPIRY_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </Select>
          </Field>
          <Field label="Model limit" hint="Optional. All requests with this key dispatch to this model.">
            <ModelLimitInput value={keyForcedModel} onChange={setKeyForcedModel} models={catalogModels} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Request quota">
              <Select value={keyQuotaPeriod} onChange={(event) => setKeyQuotaPeriod(event.target.value)}>
                <option value="none">Unlimited</option>
                <option value="day">Daily limit</option>
                <option value="month">Monthly limit</option>
              </Select>
            </Field>
            {keyQuotaPeriod !== "none" && (
              <NumberField label="Limit" value={keyQuotaLimit} onChange={setKeyQuotaLimit} />
            )}
          </div>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(createdKey)}
        title="API key created"
        description="The key can also be shown and copied from the API Keys list."
        confirmLabel="Done"
        showCancel={false}
        onCancel={() => setCreatedKey(null)}
        onConfirm={() => setCreatedKey(null)}
      >
        <div className="flex items-center gap-2 rounded-[10px] border border-border bg-bg p-2">
          <code className="min-w-0 flex-1 break-all px-1 text-xs text-text-main">{createdKey?.secret}</code>
          <Button variant="ghost" className="shrink-0 px-2" onClick={copyCreatedSecret} aria-label="Copy API key"><Icon>content_copy</Icon></Button>
        </div>
      </Dialog>
      <div>
        <section className="border-b border-border-subtle pb-7">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-medium">Require API key</p>
              <p className="mt-1 text-sm text-text-muted">Requests without a valid key will be rejected.</p>
            </div>
            <div className="shrink-0"><Toggle checked={authEnabled} disabled={toggleSaving} onChange={updateApiKeyAuth} /></div>
          </div>
        </section>
        <section>
          {apiKeys.length ? apiKeys.map((key) => (
            <div key={key.id} className="flex flex-col gap-4 border-b border-border-subtle py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
              <div className="min-w-0">
                <p className="font-medium">{key.name}</p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
                  <code className="max-w-full break-all">{revealedKeys[key.id] && key.secret ? key.secret : key.displayPrefix}</code>
                  {!key.secret && <span className="text-warning">Secret unavailable</span>}
                  <span>Created {formatApiKeyDate(key.createdAt)}</span>
                  {key.expiresAt && <span>{key.status === "expired" ? "Expired" : "Expires"} {formatApiKeyDate(key.expiresAt)}</span>}
                  {key.status === "inactive" && <span className="text-warning">Disabled</span>}
                  {key.status === "limited" && <span className="text-warning">Quota reached</span>}
                  <span>{apiKeyQuotaText(key)}</span>
                  <span>{apiKeyModelLimitText(key)}</span>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_auto]">
                  <Select
                    value={(quotaDrafts[key.id] || apiKeyQuotaDraft(key)).quotaPeriod}
                    onChange={(event) => setQuotaDrafts((current) => ({
                      ...current,
                      [key.id]: { ...(current[key.id] || apiKeyQuotaDraft(key)), quotaPeriod: event.target.value },
                    }))}
                  >
                    <option value="none">Unlimited</option>
                    <option value="day">Daily limit</option>
                    <option value="month">Monthly limit</option>
                  </Select>
                  {(quotaDrafts[key.id] || apiKeyQuotaDraft(key)).quotaPeriod !== "none" && (
                    <Input
                      type="number"
                      min="1"
                      value={(quotaDrafts[key.id] || apiKeyQuotaDraft(key)).quotaLimit}
                      onChange={(event) => setQuotaDrafts((current) => ({
                        ...current,
                        [key.id]: { ...(current[key.id] || apiKeyQuotaDraft(key)), quotaLimit: Number(event.target.value) },
                      }))}
                    />
                  )}
                  {(quotaDrafts[key.id] || apiKeyQuotaDraft(key)).quotaPeriod === "none" && <div className="hidden lg:block" />}
                  <ModelLimitInput
                    value={(quotaDrafts[key.id] || apiKeyQuotaDraft(key)).forcedModel}
                    onChange={(model) => setQuotaDrafts((current) => ({
                      ...current,
                      [key.id]: { ...(current[key.id] || apiKeyQuotaDraft(key)), forcedModel: model },
                    }))}
                    models={catalogModels}
                  />
                  <Button variant="secondary" disabled={keySaving === key.id} onClick={() => updateKeyQuota(key)}>Save limits</Button>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                <Button
                  variant="ghost"
                  className="size-9 px-0"
                  disabled={!key.secret}
                  onClick={() => setRevealedKeys((current) => ({ ...current, [key.id]: !current[key.id] }))}
                  aria-label={`${revealedKeys[key.id] ? "Hide" : "Show"} ${key.name}`}
                >
                  <Icon>{revealedKeys[key.id] ? "visibility_off" : "visibility"}</Icon>
                </Button>
                <Button
                  variant="ghost"
                  className="size-9 px-0"
                  disabled={!key.secret}
                  onClick={() => copyApiKey(key)}
                  aria-label={`Copy ${key.name}`}
                >
                  <Icon>content_copy</Icon>
                </Button>
                <Toggle checked={key.active} disabled={keySaving === key.id} onChange={(active) => setKeyActive(key, active)} />
                <Button variant="ghost" className="size-9 px-0 text-danger hover:text-danger" onClick={() => deleteApiKey(key)} aria-label={`Delete ${key.name}`}>
                  <Icon>delete</Icon>
                </Button>
              </div>
            </div>
          )) : (
            <Empty icon="key" title="No API keys" description="Create a key to authenticate client requests." />
          )}
        </section>
      </div>
    </>
  );
}

export function SystemPage() {
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [endpointExample, setEndpointExample] = useState(null);
  const [endpointCopyMessage, setEndpointCopyMessage] = useState("");
  const [databaseResetOpen, setDatabaseResetOpen] = useState(false);
  const [databaseResetPassword, setDatabaseResetPassword] = useState("");
  const [databaseResetError, setDatabaseResetError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  async function load() {
    try {
      const [nextStatus, nextConfig] = await Promise.all([api("/api/admin/status"), api("/api/admin/config")]);
      setStatus(nextStatus); setConfig(nextConfig); setError("");
    } catch (failure) { setError(failure.message); }
  }
  useEffect(() => { load(); }, []);
  if (!status || !config) return <Loading />;
  async function refreshCatalog() {
    try { const result = await api("/api/admin/catalog/refresh", { method: "POST" }); setMessage(`Catalog refreshed: ${result.models} models`); await load(); }
    catch (failure) { setError(failure.message); }
  }
  async function resetOverrides() {
    setDialog({
      title: "Reset runtime overrides?",
      description: "Return all dashboard-managed settings to file and environment values.",
      confirmLabel: "Reset",
      destructive: true,
      action: async () => {
        await api("/api/admin/config/overrides", { method: "DELETE", body: JSON.stringify({ expectedRevision: config.revision }) });
        setMessage("Runtime overrides reset");
        await load();
      },
    });
  }
  async function resetDecisionHistory() {
    setDialog({
      title: "Purge decision history?",
      description: "Delete all stored decisions and operator feedback. This cannot be undone.",
      confirmLabel: "Purge",
      destructive: true,
      action: async () => {
        await api("/api/admin/decisions", { method: "DELETE" });
        setMessage("Decision history purged");
        await load();
      },
    });
  }
  async function resetPromptCorrections() {
    setDialog({
      title: "Reset reviewed prompt data?",
      description: "Clear stored raw prompts and request context for reviewed decisions, and disable learned routing corrections. Decision history and feedback stay available.",
      confirmLabel: "Reset reviewed prompt data",
      destructive: true,
      action: async () => {
        const result = await api("/api/admin/prompt-corrections", { method: "DELETE" });
        setMessage(`Reviewed prompt data reset (${result.cleared || 0} contexts cleared, ${result.deactivated} corrections disabled)`);
        await load();
      },
    });
  }
  function openDatabaseReset() {
    setDatabaseResetPassword("");
    setDatabaseResetError("");
    setDatabaseResetOpen(true);
  }
  function closeDatabaseReset() {
    setDatabaseResetOpen(false);
    setDatabaseResetPassword("");
    setDatabaseResetError("");
  }
  async function resetDatabase() {
    try {
      await api("/api/admin/database", {
        method: "DELETE",
        body: JSON.stringify({ password: databaseResetPassword }),
      });
      closeDatabaseReset();
      setMessage("Database reset complete");
      await load();
    } catch (failure) { setDatabaseResetError(failure.message); }
  }
  async function confirmDialog() {
    const current = dialog;
    setDialog(null);
    try {
      await current.action();
    } catch (failure) { setError(failure.message); }
  }
  function copy(value) { navigator.clipboard.writeText(value); setMessage("Copied to clipboard"); }
  function openEndpointExample(example) { setEndpointCopyMessage(""); setEndpointExample(example); }
  function closeEndpointExample() { setEndpointCopyMessage(""); setEndpointExample(null); }
  async function copyEndpointExample() {
    try {
      await navigator.clipboard.writeText(endpointExampleBody);
      setEndpointCopyMessage("Copied to clipboard");
    } catch (failure) { setEndpointCopyMessage(failure.message || "Copy failed"); }
  }
  const anthropicMessagesUrl = `${status.proxyBaseUrl}/messages`;
  const gatewayRootUrl = status.proxyBaseUrl.replace(/\/v1\/?$/, "");
  const endpointExamples = {
    openai: {
      title: "Codex CLI config",
      description: "Minimal ~/.codex/config.toml + ~/.codex/auth.json for this gateway.",
      language: "toml + json",
      sections: [
        {
          label: "~/.codex/config.toml",
          language: "toml",
          body: `# 9Router Configuration for Codex CLI\nmodel = "auto"\nmodel_provider = "smartrouter"\n\n[model_providers.smartrouter]\nname = "smartrouter"\nbase_url = "${status.proxyBaseUrl}"\nwire_api = "responses"`,
        },
        {
          label: "~/.codex/auth.json",
          language: "json",
          body: JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "<your API key>" }, null, 2),
        },
      ],
    },
    anthropic: {
      title: "Claude Code settings.json",
      description: "Minimal settings.json gateway config for Claude Code.",
      language: "json",
      body: JSON.stringify({
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        model: "auto",
        env: {
          ANTHROPIC_BASE_URL: gatewayRootUrl,
          ANTHROPIC_AUTH_TOKEN: "<your API key>",
          ANTHROPIC_CUSTOM_MODEL_OPTION: "auto",
          ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: "9Router auto",
        },
      }, null, 2),
    },
  };
  const endpointExampleBody = endpointExample?.sections
    ? endpointExample.sections.map((section) => `${section.label}\n${section.body}`).join("\n\n")
    : endpointExample?.body || "";
  async function updatePassword() {
    if (!currentPassword) {
      setError("Current password is required");
      return;
    }
    if (!password) {
      setError("Password cannot be empty");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Passwords do not match");
      return;
    }
    try {
      await api("/api/admin/security/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword, password }),
      });
      setCurrentPassword("");
      setPassword("");
      setPasswordConfirm("");
      setMessage("Admin password updated");
      setError("");
    } catch (failure) {
      setError(failure.message);
    }
  }

  return (
    <>
      <PageHeader title="System" description="Runtime health, effective configuration sources, and maintenance controls." action={<Button variant="secondary" onClick={load}><Icon>refresh</Icon>Refresh</Button>} />
      <ErrorBox error={error} />
      {message && <div className="mb-4 rounded-[10px] bg-success/10 px-4 py-3 text-sm text-success">{message}</div>}
      <Dialog open={Boolean(dialog)} title={dialog?.title} description={dialog?.description} confirmLabel={dialog?.confirmLabel} destructive={dialog?.destructive} onCancel={() => setDialog(null)} onConfirm={confirmDialog} />
      <Dialog
        open={databaseResetOpen}
        title="Reset database?"
        description="This deletes decisions, feedback, API keys, quotas, and dashboard settings. Your current admin password is preserved."
        confirmLabel="Reset database"
        destructive
        confirmDisabled={!databaseResetPassword}
        onCancel={closeDatabaseReset}
        onConfirm={resetDatabase}
      >
        <Field label="Current admin password">
          <Input type="password" autoFocus value={databaseResetPassword} onChange={(event) => { setDatabaseResetPassword(event.target.value); setDatabaseResetError(""); }} placeholder="Enter admin password" />
        </Field>
        {databaseResetError && <p className="mt-2 text-sm text-danger">{databaseResetError}</p>}
      </Dialog>
      <Dialog open={Boolean(endpointExample)} title={endpointExample?.title} description={endpointExample?.description} confirmLabel="Done" showCancel={false} onCancel={closeEndpointExample} onConfirm={closeEndpointExample}>
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{endpointExample?.language}</p>
              <div className="flex items-center gap-2">
                {endpointCopyMessage && <span className="text-xs text-success">{endpointCopyMessage}</span>}
                <Button variant="secondary" className="min-h-8 px-2 py-1 text-xs" onClick={copyEndpointExample}><Icon>content_copy</Icon>Copy</Button>
              </div>
            </div>
            {endpointExample?.sections ? (
              <div className="space-y-3">
                {endpointExample.sections.map((section) => (
                  <div key={section.label}>
                    <p className="mb-1 text-xs font-medium text-text-muted">{section.label}</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-border-subtle bg-bg px-3 py-2 text-xs text-text-main">{section.body}</pre>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-border-subtle bg-bg px-3 py-2 text-xs text-text-main">{endpointExample?.body}</pre>
            )}
          </div>
          <p className="text-xs text-text-muted">Create an API key on the API Keys page if API-key enforcement is enabled, then use it for the placeholder token or env key.</p>
        </div>
      </Dialog>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Service status">
          <div className="space-y-3">
            <HealthRow label="Version" good value={status.version || "Unknown"} />
            <HealthRow label="Router readiness" good={status.ready} value={status.ready ? "Ready" : "Not ready"} />
            <HealthRow label="9Router catalog" good={status.catalog.ready} value={`${status.catalog.models} models`} />
            <HealthRow label="Classifier" good={status.classifier.state !== "degraded"} value={status.classifier.state} />
            <HealthRow label="SQLite storage" good={status.storage.ready} value={status.storage.ready ? "Ready" : status.storage.error || "Degraded"} />
            <HealthRow label="Buffered events" good={status.storage.bufferedEvents === 0} value={status.storage.bufferedEvents} />
            <HealthRow label="Uptime" good value={`${Math.floor(status.uptimeSeconds / 60)} minutes`} />
          </div>
        </Card>
        <Card title="Client endpoints" subtitle="Use these as the OpenAI-compatible and Anthropic base URLs.">
          <div className="space-y-3">
            <div>
              <p className="mb-2 text-text-muted">OpenAI-compatible base URL</p>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row"><Input readOnly value={status.proxyBaseUrl} /><div className="flex gap-2 sm:shrink-0"><Button variant="secondary" className="shrink-0" onClick={() => copy(status.proxyBaseUrl)}><Icon>content_copy</Icon></Button><Button variant="secondary" className="shrink-0" onClick={() => openEndpointExample(endpointExamples.openai)}>Example</Button></div></div>
            </div>
            <div>
              <p className="mb-2 text-text-muted">Anthropic Messages endpoint</p>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row"><Input readOnly value={anthropicMessagesUrl} /><div className="flex gap-2 sm:shrink-0"><Button variant="secondary" className="shrink-0" onClick={() => copy(anthropicMessagesUrl)}><Icon>content_copy</Icon></Button><Button variant="secondary" className="shrink-0" onClick={() => openEndpointExample(endpointExamples.anthropic)}>Example</Button></div></div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">{["auto","auto-fast","auto-quality"].map((model) => <Badge key={model} tone="primary">{model}</Badge>)}</div>
        </Card>
        <Card title="Configuration sources" subtitle={`Revision ${config.revision}`}>
          <div className="space-y-3 text-sm">
            <div><p className="text-text-muted">Runtime override store</p><code className="break-all text-xs">{config.runtimeStore || config.runtimePath || "In-memory test configuration"}</code></div>
            <div><p className="mb-2 text-text-muted">Editable configuration</p><p>Dashboard settings are stored in SQLite and are not locked by environment variables.</p></div>
            <div><p className="mb-2 text-text-muted">Active dashboard overrides</p><pre className="max-h-44 w-full max-w-full min-w-0 overflow-auto whitespace-pre-wrap break-words rounded bg-bg p-3 text-xs">{JSON.stringify(config.overrides, null, 2)}</pre></div>
          </div>
        </Card>
        <Card title="Maintenance">
          <div className="space-y-4">
            <div className="space-y-3 border-b border-border-subtle pb-4">
              <div>
                <p className="font-medium">Update admin password</p>
                <p className="text-xs text-text-muted">Changes apply immediately and default to `smart9router` on first run.</p>
              </div>
              <div className="grid gap-3">
                <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" />
                <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" />
                <Input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="Confirm new password" />
              </div>
              <Button onClick={updatePassword}>Update password</Button>
            </div>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">Refresh model catalog</p><p className="text-xs text-text-muted">Re-check target models and combos in 9Router.</p></div><Button variant="secondary" className="shrink-0" onClick={refreshCatalog}>Refresh</Button></div>
            <div className="flex items-start justify-between gap-3 border-t border-border-subtle pt-4"><div className="min-w-0"><p className="font-medium">Reset reviewed prompt data</p><p className="text-xs text-text-muted">Clear stored raw prompts and request context for reviewed decisions, and disable learned routing corrections.</p></div><Button variant="danger" className="shrink-0" onClick={resetPromptCorrections}>Reset reviewed prompt data</Button></div>
            <div className="flex items-start justify-between gap-3 border-t border-border-subtle pt-4"><div className="min-w-0"><p className="font-medium">Purge decision history</p><p className="text-xs text-text-muted">Delete stored decisions and operator feedback from the database.</p></div><Button variant="danger" className="shrink-0" onClick={resetDecisionHistory}>Purge</Button></div>
            <div className="flex items-start justify-between gap-3 border-t border-border-subtle pt-4"><div className="min-w-0"><p className="font-medium">Reset runtime overrides</p><p className="text-xs text-text-muted">Return to config.yaml and environment values immediately.</p></div><Button variant="danger" className="shrink-0" onClick={resetOverrides}>Reset</Button></div>
            <div className="flex items-start justify-between gap-3 border-t border-border-subtle pt-4"><div className="min-w-0"><p className="font-medium">Reset database</p><p className="text-xs text-text-muted">Delete SQLite decisions, API keys, quotas, and dashboard settings. Admin password is preserved.</p></div><Button variant="danger" className="shrink-0" onClick={openDatabaseReset}>Reset</Button></div>
          </div>
        </Card>
      </div>
    </>
  );
}
