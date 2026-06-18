import { NavLink } from "react-router-dom";

export function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`rounded-[14px] border border-border-subtle bg-surface shadow-soft ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            {title && <h2 className="font-semibold text-text-main">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Button({ children, variant = "primary", className = "", ...props }) {
  const variants = {
    primary: "bg-primary text-white hover:bg-primary-hover",
    secondary: "border border-border bg-surface-2 text-text-main hover:border-primary/50",
    ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main",
    danger: "bg-danger text-white hover:opacity-90",
  };
  return (
    <button
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-[10px] px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Icon({ children, className = "" }) {
  return <span className={`material-symbols-outlined text-[19px] ${className}`}>{children}</span>;
}

export function Badge({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-surface-2 text-text-muted",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-danger/10 text-danger",
    info: "bg-info/10 text-info",
    primary: "bg-primary/10 text-primary",
  };
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Field({ label, hint, children }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium text-text-main">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

export function Input(props) {
  const { className = "", ...rest } = props;
  return <input className={`min-w-0 max-w-full w-full rounded-[10px] border border-border bg-bg px-3 py-2 text-sm text-text-main outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 ${className}`.trim()} {...rest} />;
}

export function Select(props) {
  const { className = "", ...rest } = props;
  return (
    <span className="relative block min-w-0 max-w-full w-full">
      <select className={`min-w-0 max-w-full w-full appearance-none rounded-[10px] border border-border bg-bg py-2 pl-3 pr-10 text-sm text-text-main outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 ${className}`.trim()} {...rest} />
      <Icon className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">keyboard_arrow_down</Icon>
    </span>
  );
}

export function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-primary" : "bg-surface-3"} disabled:opacity-50`}
      aria-pressed={checked}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function Dialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  confirmDisabled = false,
  showCancel = true,
  children,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-[18px] border border-border-subtle bg-surface p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          {description && <p className="text-sm text-text-muted">{description}</p>}
        </div>
        {children && <div className="mt-5">{children}</div>}
        <div className="mt-6 flex justify-end gap-3">
          {showCancel && <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>}
          <Button variant={destructive ? "danger" : "primary"} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

const NAV = [
  ["/dashboard", "Overview", "dashboard"],
  ["/dashboard/routing", "Routing", "route"],
  ["/dashboard/decisions", "Decisions", "receipt_long"],
  ["/dashboard/playground", "Playground", "science"],
  ["/dashboard/api-keys", "API Keys", "key"],
  ["/dashboard/system", "System", "settings"],
];

export function Layout({ children, onLogout, theme, setTheme }) {
  return (
    <div className="min-h-screen bg-bg text-text-main">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-border-subtle bg-sidebar/90 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="grid size-10 place-items-center rounded-[11px] bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-warm">
            <Icon>route</Icon>
          </div>
          <div>
            <h1 className="font-semibold">9Router Gateway</h1>
            <p className="text-xs text-text-muted">Routing control plane</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(([to, label, icon]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/dashboard"}
              className={({ isActive }) => `flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition ${isActive ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-surface-2 hover:text-text-main"}`}
            >
              <Icon>{icon}</Icon>{label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-border-subtle p-3">
          <Button variant="ghost" className="w-full justify-start" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            <Icon>{theme === "dark" ? "light_mode" : "dark_mode"}</Icon>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </Button>
          <Button variant="ghost" className="w-full justify-start" onClick={onLogout}>
            <Icon>logout</Icon>Log out
          </Button>
        </div>
      </aside>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border-subtle bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2 font-semibold"><Icon className="text-primary">route</Icon>9Router Gateway</div>
        <div className="flex gap-1">
          <Button variant="ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><Icon>{theme === "dark" ? "light_mode" : "dark_mode"}</Icon></Button>
          <Button variant="ghost" onClick={onLogout}><Icon>logout</Icon></Button>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-border-subtle bg-surface/95 p-2 backdrop-blur lg:hidden">
        {NAV.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === "/dashboard"} className={({ isActive }) => `flex min-w-12 flex-1 flex-col items-center gap-0.5 text-[10px] ${isActive ? "text-primary" : "text-text-muted"}`}>
            <Icon>{icon}</Icon>{label}
          </NavLink>
        ))}
      </nav>
      <main className="mx-auto max-w-[1500px] px-4 py-6 pb-24 lg:ml-64 lg:px-8 lg:pb-8">{children}</main>
    </div>
  );
}

export function PageHeader({ title, description, action }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Empty({ icon = "inbox", title, description }) {
  return (
    <div className="grid min-h-48 place-items-center text-center">
      <div><Icon className="text-4xl text-text-subtle">{icon}</Icon><h3 className="mt-2 font-medium">{title}</h3><p className="mt-1 text-sm text-text-muted">{description}</p></div>
    </div>
  );
}
