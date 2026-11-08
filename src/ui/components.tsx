import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { currentRoute, useApp } from "../store/appStore";
import { haptic } from "../platform/haptics";
import { IconBack, IconChart, IconTables } from "./Icons";

export function TopBar({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">{children}</div>
      {title && <h1 className="page-title">{title}</h1>}
    </header>
  );
}

export function BackButton({ label }: { label: string }) {
  const back = useApp((s) => s.back);
  return (
    <button className="back-btn" onClick={() => back()} aria-label={`Back to ${label}`}>
      <IconBack /> {label}
    </button>
  );
}

export function BottomNav() {
  const route = useApp((s) => currentRoute(s).name);
  const goTab = useApp((s) => s.goTab);
  const tabs = [
    { name: "tables" as const, label: "Tables", Icon: IconTables },
    { name: "summary" as const, label: "Summary", Icon: IconChart },
  ];
  return (
    <nav className="bottomnav" aria-label="Main">
      <div className="bottomnav-inner">
        {tabs.map(({ name, label, Icon }) => {
          const active = route === name;
          return (
            <button
              key={name}
              className={`navbtn${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                haptic.tap();
                goTab(name);
              }}
            >
              {active && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
              <Icon />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`switch${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, id }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; id: string }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? "active" : ""} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.i layoutId={`seg-${id}`} className="seg-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ToastHost() {
  const toast = useApp((s) => s.toast);
  const dismiss = useApp((s) => s.dismissToast);
  const high = useApp((s) => currentRoute(s).name === "order" || s.stack.length > 1);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, toast.action ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast, dismiss]);
  return (
    <div className={`toast-wrap${high ? " high" : ""}`} aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={`toast ${toast.tone ?? ""}`}
            role="status"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            <span className="t-text">{toast.text}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.run();
                  dismiss();
                }}
              >
                {toast.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
