import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { currentRoute, useApp } from "../store/appStore";
import { haptic } from "../platform/haptics";
import { IconBack, IconChart, IconSparkle, IconTables } from "./Icons";

interface TopBarProps {
  /** Screen title (omit when passing custom children). */
  title?: string;
  sub?: ReactNode;
  /** Shows a back arrow; the label is used for accessibility. */
  back?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export function TopBar({ title, sub, back, actions, children }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        {children ?? (
          <>
            {back && <BackButton label={back} />}
            <div className="topbar-title" style={back ? undefined : { paddingLeft: 10 }}>
              <h1>{title}</h1>
              {sub && <div className="sub">{sub}</div>}
            </div>
            {actions && <div className="topbar-actions">{actions}</div>}
          </>
        )}
      </div>
    </header>
  );
}

export function BackButton({ label }: { label: string }) {
  const back = useApp((s) => s.back);
  return (
    <button className="icon-btn" onClick={() => back()} aria-label={`Back to ${label}`}>
      <IconBack />
    </button>
  );
}

export function BottomNav() {
  const route = useApp((s) => currentRoute(s).name);
  const { goTab, openAsk } = useApp.getState();
  const tab = (name: "tables" | "summary", label: string, Icon: typeof IconTables) => {
    const active = route === name;
    return (
      <button
        className={`navbtn${active ? " active" : ""}`}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          haptic.tap();
          goTab(name);
        }}
      >
        {active && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
        <Icon />
        <span>{label}</span>
      </button>
    );
  };
  return (
    <nav className="bottomnav" aria-label="Main">
      <div className="bottomnav-inner">
        {tab("tables", "Tables", IconTables)}
        <motion.button
          className="nav-ask"
          whileTap={{ scale: 0.95 }}
          aria-label="Ask Agent"
          onClick={() => {
            haptic.tap();
            openAsk();
          }}
        >
          <IconSparkle /> Ask
        </motion.button>
        {tab("summary", "Summary", IconChart)}
      </div>
    </nav>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch${on ? " on" : ""}`}
      onClick={() => {
        haptic.tap();
        onChange(!on);
      }}
    >
      <i />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, id }: { value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void; id: string }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? "active" : ""} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.i layoutId={`seg-${id}`} className="seg-pill" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ToastHost() {
  const toast = useApp((s) => s.toast);
  const dismiss = useApp((s) => s.dismissToast);
  const place = useApp((s) => {
    const r = currentRoute(s).name;
    if (r === "order") return "over-cart";
    if (r === "tables" || r === "summary") return "";
    return "bottom";
  });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, toast.action ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast, dismiss]);
  return (
    <div className={`toast-wrap ${place}`} aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={`toast ${toast.tone ?? ""}`}
            role="status"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 480, damping: 36 }}
          >
            <span className="dot" />
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
