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

function Loading() {
  return <div className="grid min-h-56 place-items-center text-text-muted"><Icon className="animate-spin text-3xl">progress_activity</Icon></div>;
}

function ErrorBox({ error }) {
  return error ? <div className="mb-4 rounded-[10px] border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div> : null;
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

  async function load() {
    try {
      const [nextStatus, nextAnalytics] = await Promise.all([
        api("/api/admin/status"),
        api("/api/admin/analytics"),
      ]);
      setStatus(nextStatus);
      setAnalytics(nextAnalytics);
      setError("");
    } catch (failure) { setError(failure.message); }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  if (!status || !analytics) return <Loading />;
  return (
    <>
      <PageHeader title="Overview" description="Live routing health and the last 24 hours of prompt decisions." action={<Button variant="secondary" onClick={load}><Icon>refresh</Icon>Refresh</Button>} />
      <ErrorBox error={error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Requests" value={analytics.total.toLocaleString()} hint={`${analytics.completed} completed`} icon="route" />
        <Metric label="Success rate" value={`${(analytics.successRate * 100).toFixed(1)}%`} hint="Completed upstream requests" icon="check_circle" tone="success" />
        <Metric label="P95 latency" value={`${analytics.p95LatencyMs.toLocaleString()} ms`} hint="End-to-end proxy latency" icon="speed" tone="info" />
        <Metric label="Tokens" value={analytics.tokenTotal.toLocaleString()} hint={`${status.affinityEntries} active affinities`} icon="data_usage" tone="warning" />
      </div>
      <div className="mb-6 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card title="Request volume" subtitle="Hourly routed prompts">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics.timeline}>
                <defs><linearGradient id="routeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#E56A4A" stopOpacity={0.35}/><stop offset="95%" stopColor="#E56A4A" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
                <XAxis dataKey="timestamp" tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: "2-digit" })} stroke="var(--color-text-muted)" fontSize={11} />
                <YAxis stroke="var(--color-text-muted)" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--color-surface)", borderColor: "var(--color-border)", borderRadius: 10 }} labelFormatter={(value) => new Date(value).toLocaleString()} />
                <Area type="monotone" dataKey="requests" stroke="#E56A4A" fill="url(#routeFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Targets" subtitle="Predicted routing tier">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={objectChart(analytics.byTarget)} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={3}>
                  {objectChart(analytics.byTarget).map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--color-surface)", borderColor: "var(--color-border)", borderRadius: 10 }} />
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
  return <div className="flex items-center justify-between gap-3"><span className="text-text-muted">{label}</span><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${good ? "bg-success" : "bg-danger"}`} /><span className="max-w-48 truncate">{value}</span></div></div>;
}

function Distribution({ title, data }) {
  return (
    <Card title={title}>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={objectChart(data)} layout="vertical" margin={{ left: 8 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={80} stroke="var(--color-text-muted)" fontSize={11} />
            <Tooltip contentStyle={{ background: "var(--color-surface)", borderColor: "var(--color-border)", borderRadius: 10 }} />
            <Bar dataKey="value" fill="#E56A4A" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
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
  function locked(path) { return Boolean(state.locked[path]); }

  async function save() {
    try {
      const result = await api("/api/admin/config", {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: state.revision,
          patch: {
            routing: form.routing,
            classifier: {
              enabled: form.classifier.enabled,
              timeoutMs: form.classifier.timeoutMs,
              minimumConfidence: form.classifier.minimumConfidence,
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
        <Card title="Target mapping" subtitle="Each tier points to an existing 9Router combo or model.">
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(form.routing.targets).map(([key, value]) => (
              <Field key={key} label={key[0].toUpperCase() + key.slice(1)} hint={locked(`routing.targets.${key}`) ? `Locked by ${state.locked[`routing.targets.${key}`]}` : null}>
                <Input list="catalog-targets" disabled={locked(`routing.targets.${key}`)} value={value} onChange={(event) => field(`routing.targets.${key}`, event.target.value)} />
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
              <div key={name} className="grid grid-cols-[1fr_120px] items-center gap-4">
                <div><p className="font-medium">{name}</p><p className="text-xs text-text-muted">{name === "auto-fast" ? "Favor cheaper tiers" : name === "auto-quality" ? "Favor stronger tiers" : "Balanced default"}</p></div>
                <Input type="number" value={profile.scoreBias} onChange={(event) => field(`routing.profiles.${name}.scoreBias`, Number(event.target.value))} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Shadow mode" subtitle="Record predictions while dispatching every virtual request to one target.">
          <div className="flex items-center justify-between"><div><p className="font-medium">Enable shadow mode</p><p className="text-xs text-text-muted">Useful for policy calibration before active routing.</p></div><Toggle checked={form.routing.shadowMode} onChange={(value) => field("routing.shadowMode", value)} /></div>
          <div className="mt-4"><Field label="Shadow dispatch target"><Input list="catalog-targets" value={form.routing.shadowTarget} onChange={(event) => field("routing.shadowTarget", event.target.value)} /></Field></div>
        </Card>
        <Card title="Semantic classifier" subtitle={`${form.classifier.model} at ${form.classifier.revision.slice(0, 8)}`}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">Use semantic classification</p>
              <p className="text-xs text-text-muted">Only for prompts near a decision boundary.</p>
              {locked("classifier.enabled") && <p className="mt-1 text-xs text-warning">Locked by {state.locked["classifier.enabled"]}</p>}
            </div>
            <Toggle checked={form.classifier.enabled} disabled={locked("classifier.enabled")} onChange={(value) => field("classifier.enabled", value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label="Timeout (ms)" value={form.classifier.timeoutMs} onChange={(value) => field("classifier.timeoutMs", value)} />
            <NumberField label="Minimum confidence" step="0.01" disabled={locked("classifier.minimumConfidence")} hint={locked("classifier.minimumConfidence") ? `Locked by ${state.locked["classifier.minimumConfidence"]}` : null} value={form.classifier.minimumConfidence} onChange={(value) => field("classifier.minimumConfidence", value)} />
          </div>
        </Card>
        <Card title="Affinity and retention" subtitle="Conversation stability and local decision history.">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label="Affinity TTL (minutes)" value={Math.round(form.affinity.ttlMs / 60000)} onChange={(value) => field("affinity.ttlMs", value * 60000)} />
            <NumberField label="Maximum affinities" value={form.affinity.maxEntries} onChange={(value) => field("affinity.maxEntries", value)} />
            <NumberField label="History retention (days)" value={form.logging.retentionDays} onChange={(value) => field("logging.retentionDays", value)} />
            <div className="flex items-end justify-between rounded-[10px] border border-border bg-bg p-3"><div><p className="text-sm font-medium">Store prompt/request context</p><p className="text-xs text-danger">Privacy-sensitive; enables richer feedback review.</p></div><Toggle checked={form.logging.rawPrompts} disabled={locked("logging.rawPrompts")} onChange={(value) => field("logging.rawPrompts", value)} /></div>
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
  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString(), [filters]);

  async function load(cursor = "") {
    try {
      const value = await api(`/api/admin/decisions?limit=50&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      setData((current) => cursor ? { ...value, items: [...(current?.items || []), ...value.items] } : value);
      setError("");
    } catch (failure) { setError(failure.message); }
  }
  useEffect(() => { load(); }, [query]);
  if (!data) return <Loading />;

  async function openDecision(id) {
    try { setSelected(await api(`/api/admin/decisions/${encodeURIComponent(id)}`)); }
    catch (failure) { setError(failure.message); }
  }

  return (
    <>
      <PageHeader title="Decisions" description="Queryable routing history, upstream outcomes, tokens, and operator feedback." action={<Button variant="secondary" onClick={() => load()}><Icon>refresh</Icon>Refresh</Button>} />
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
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-muted"><tr>{["Time","Task","Complexity","Target","Score","Outcome","Latency",""].map((header) => <th key={header} className="px-4 py-3 font-semibold">{header}</th>)}</tr></thead>
              <tbody>{data.items.map((item) => (
                <tr key={item.requestId} className="border-t border-border-subtle hover:bg-surface-2/50">
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(item.timestamp).toLocaleString()}</td>
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
      {selected && <DecisionDrawer item={selected} onClose={() => setSelected(null)} onUpdate={setSelected} />}
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
  const hasFeedback = Boolean(item.feedback);
  async function saveFeedback() {
    const updated = await api(`/api/admin/decisions/${encodeURIComponent(item.requestId)}/feedback`, {
      method: "PUT",
      body: JSON.stringify({ rating, expectedTarget: expectedTarget || null, note: note || null }),
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
    onUpdate(updated);
  }
  return (
    <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose}>
      <aside className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto bg-surface p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between"><div><h2 className="text-lg font-semibold">Decision details</h2><code className="text-xs text-text-muted">{item.requestId}</code></div><Button variant="ghost" onClick={onClose}><Icon>close</Icon></Button></div>
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
            ["Estimated input", `${item.estimatedTokens || 0} tokens`],
            ["Actual tokens", item.tokens?.totalTokens ?? "—"],
            ["Classifier", item.classifierUsed ? "used" : "rules only"],
            ["Affinity", item.affinityHeld ? "held stronger tier" : "not held"],
          ].map(([label, value]) => <div key={label} className="rounded-[10px] bg-bg p-3"><p className="text-xs text-text-muted">{label}</p><p className="mt-1 font-medium">{String(value)}</p></div>)}
        </div>
        <Card title="Signals" className="mt-5"><div className="flex flex-wrap gap-2">{(item.reasons || []).length ? item.reasons.map((reason) => <Badge key={reason} tone="primary">{reason}</Badge>) : <span className="text-sm text-text-muted">No keyword signals.</span>}</div></Card>
        <Card title="Operator feedback" className="mt-5">
          <div className="space-y-4">
            <Field label="Rating"><div className="flex gap-1">{[1,2,3,4,5].map((value) => <button key={value} className={`text-2xl ${value <= rating ? "text-warning" : "text-surface-3"}`} onClick={() => setRating(value)}>★</button>)}</div></Field>
            <Field label="Expected target"><Select value={expectedTarget} onChange={(event) => setExpectedTarget(event.target.value)}><option value="">No correction</option>{["smart-small","smart-medium","smart-planning","smart-large","smart-vision"].map((value) => <option key={value}>{value}</option>)}</Select></Field>
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

export function ApiKeysPage() {
  const [config, setConfig] = useState(null);
  const [apiKeys, setApiKeys] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [toggleSaving, setToggleSaving] = useState(false);
  const [keySaving, setKeySaving] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyExpiry, setKeyExpiry] = useState("never");
  const [createdKey, setCreatedKey] = useState(null);
  const [revealedKeys, setRevealedKeys] = useState({});

  function applyKeys(items) {
    setApiKeys(items);
  }

  async function load() {
    try {
      const [nextConfig, nextKeys] = await Promise.all([
        api("/api/admin/config"),
        api("/api/admin/api-keys"),
      ]);
      setConfig(nextConfig);
      applyKeys(nextKeys.items || []);
      setError("");
    } catch (failure) {
      setError(failure.message);
    }
  }

  useEffect(() => { load(); }, []);
  if (!config) return <Loading />;

  const authEnabled = Boolean(config.config?.security?.apiKeyAuthEnabled);
  const authLock = config.locked?.["security.apiKeyAuthEnabled"];

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
        body: JSON.stringify({ name: keyName.trim(), expiresAt: expiryFromChoice(keyExpiry) }),
      });
      setCreateOpen(false);
      setCreatedKey(result);
      setKeyName("");
      setKeyExpiry("never");
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
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-lg font-medium">Require API key</p>
              <p className="mt-1 text-sm text-text-muted">Requests without a valid key will be rejected.</p>
              {authLock && <p className="mt-1 text-xs text-warning">Locked by {authLock}</p>}
            </div>
            <Toggle checked={authEnabled} disabled={toggleSaving || Boolean(authLock)} onChange={updateApiKeyAuth} />
          </div>
        </section>
        <section>
          {apiKeys.length ? apiKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between gap-5 border-b border-border-subtle py-6">
              <div className="min-w-0">
                <p className="font-medium">{key.name}</p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
                  <code>{revealedKeys[key.id] && key.secret ? key.secret : key.displayPrefix}</code>
                  {!key.secret && <span className="text-warning">Secret unavailable</span>}
                  <span>Created {formatApiKeyDate(key.createdAt)}</span>
                  {key.expiresAt && <span>{key.status === "expired" ? "Expired" : "Expires"} {formatApiKeyDate(key.expiresAt)}</span>}
                  {key.status === "inactive" && <span className="text-warning">Disabled</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
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
  async function confirmDialog() {
    const current = dialog;
    setDialog(null);
    try {
      await current.action();
    } catch (failure) { setError(failure.message); }
  }
  function copy(value) { navigator.clipboard.writeText(value); setMessage("Copied to clipboard"); }
  const anthropicMessagesUrl = `${status.proxyBaseUrl}/messages`;
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
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Service status">
          <div className="space-y-3">
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
              <div className="flex gap-2"><Input readOnly value={status.proxyBaseUrl} /><Button variant="secondary" onClick={() => copy(status.proxyBaseUrl)}><Icon>content_copy</Icon></Button></div>
            </div>
            <div>
              <p className="mb-2 text-text-muted">Anthropic Messages endpoint</p>
              <div className="flex gap-2"><Input readOnly value={anthropicMessagesUrl} /><Button variant="secondary" onClick={() => copy(anthropicMessagesUrl)}><Icon>content_copy</Icon></Button></div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">{["auto","auto-fast","auto-quality"].map((model) => <Badge key={model} tone="primary">{model}</Badge>)}</div>
        </Card>
        <Card title="Configuration sources" subtitle={`Revision ${config.revision}`}>
          <div className="space-y-3 text-sm">
            <div><p className="text-text-muted">Runtime override file</p><code className="break-all text-xs">{config.runtimePath || "In-memory test configuration"}</code></div>
            <div><p className="mb-2 text-text-muted">Environment-locked fields</p>{Object.keys(config.locked).length ? <div className="space-y-1">{Object.entries(config.locked).map(([field, env]) => <div key={field} className="flex justify-between gap-3 rounded bg-bg px-2 py-1"><code>{field}</code><span className="text-text-muted">{env}</span></div>)}</div> : <p>No editable fields are locked.</p>}</div>
            <div><p className="mb-2 text-text-muted">Active dashboard overrides</p><pre className="max-h-44 overflow-auto rounded bg-bg p-3 text-xs">{JSON.stringify(config.overrides, null, 2)}</pre></div>
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
            <div className="flex items-center justify-between gap-4"><div><p className="font-medium">Refresh model catalog</p><p className="text-xs text-text-muted">Re-check target models and combos in 9Router.</p></div><Button variant="secondary" onClick={refreshCatalog}>Refresh</Button></div>
            <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4"><div><p className="font-medium">Purge decision history</p><p className="text-xs text-text-muted">Delete stored decisions and operator feedback from the database.</p></div><Button variant="danger" onClick={resetDecisionHistory}>Purge</Button></div>
            <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4"><div><p className="font-medium">Reset runtime overrides</p><p className="text-xs text-text-muted">Return to config.yaml and environment values immediately.</p></div><Button variant="danger" onClick={resetOverrides}>Reset</Button></div>
          </div>
        </Card>
      </div>
    </>
  );
}
