import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api, setCsrfToken, setUnauthorizedHandler } from "./api";
import { Button, Icon, Input, Layout } from "./components";
import {
  ApiKeysPage,
  DecisionsPage,
  OverviewPage,
  PlaygroundPage,
  RoutingPage,
  SystemPage,
  TaskClassifierPage,
} from "./pages";

function Login({ notice, onLogin }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const session = await api("/api/admin/session", {
        method: "POST",
        skipUnauthorized: true,
        body: JSON.stringify({ password }),
      });
      setCsrfToken(session.csrfToken);
      onLogin(session);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4">
      <div className="w-full max-w-md rounded-[18px] border border-border-subtle bg-surface p-7 shadow-[0_18px_60px_-20px_rgba(0,0,0,.25)]">
        <div className="mb-7 flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-[13px] bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-warm">
            <Icon className="text-2xl">route</Icon>
          </div>
          <div>
            <h1 className="text-xl font-semibold">9Router Gateway</h1>
            <p className="text-sm text-text-muted">Routing control plane</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block">
            <div className="relative w-full">
              <Input
                type={showPassword ? "text" : "password"}
                autoFocus
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                className="pr-12"
              />
              <Button
                type="button"
                variant="ghost"
                className="absolute inset-y-0 right-1 my-auto flex size-8 items-center justify-center rounded-[8px] px-0"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <Icon>{showPassword ? "visibility_off" : "visibility"}</Icon>
              </Button>
            </div>
          </label>
          {notice && <div className="rounded-[10px] bg-warning/10 px-3 py-2 text-sm text-warning">{notice}</div>}
          {error && <div className="rounded-[10px] bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
          <Button className="w-full" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</Button>
        </form>
        <p className="mt-5 text-center text-xs leading-5 text-text-muted">Default password is <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-text-main">smart9router</code>.</p>
      </div>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [loginNotice, setLoginNotice] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("smart-router-theme") || "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("smart-router-theme", theme);
  }, [theme]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken("");
      setLoginNotice("Session expired. Sign in again.");
      setSession(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    api("/api/admin/session", { skipUnauthorized: true })
      .then((value) => {
        if (value.authenticated) setCsrfToken(value.csrfToken);
        setSession(value.authenticated ? value : null);
      })
      .catch(() => setSession(null));
  }, []);

  async function logout() {
    try { await api("/api/admin/session", { method: "DELETE", skipUnauthorized: true }); } catch {}
    setCsrfToken("");
    setLoginNotice("");
    setSession(null);
  }

  function login(value) {
    setLoginNotice("");
    setSession(value);
  }

  if (session === undefined) {
    return <div className="grid min-h-screen place-items-center bg-bg text-text-muted"><Icon className="animate-spin text-3xl">progress_activity</Icon></div>;
  }
  if (!session) return <Login notice={loginNotice} onLogin={login} />;

  return (
    <BrowserRouter>
      <Layout onLogout={logout} theme={theme} setTheme={setTheme}>
        <Routes>
          <Route path="/dashboard" element={<OverviewPage />} />
          <Route path="/dashboard/routing" element={<RoutingPage />} />
          <Route path="/dashboard/task-classifier" element={<TaskClassifierPage />} />
          <Route path="/dashboard/decisions" element={<DecisionsPage />} />
          <Route path="/dashboard/playground" element={<PlaygroundPage />} />
          <Route path="/dashboard/api-keys" element={<ApiKeysPage />} />
          <Route path="/dashboard/system" element={<SystemPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
