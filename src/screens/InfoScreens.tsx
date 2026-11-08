import { motion } from "motion/react";
import { useApp, type LegalDoc } from "../store/appStore";
import { APP_VERSION, CHANGELOG } from "../data/changelog";
import { CONTACT_EMAIL, LEGAL_EFFECTIVE, LEGAL_VERSION, PRIVACY, PUBLISHER, TERMS } from "../legal/content";
import { BackButton, TopBar } from "../ui/components";
import { IconCash, IconCheck, IconMic, IconShield, IconWifiOff } from "../ui/Icons";

const ICON = "./icon-192.png";

export function ChangelogScreen() {
  return (
    <div className="screen no-nav">
      <TopBar title="What’s New">
        <BackButton label="Settings" />
      </TopBar>
      <main className="screen-body">
        {CHANGELOG.map((e, i) => (
          <div key={e.version} className="cl-entry">
            <div className="cl-version">
              {e.version} {i === 0 && <span className="badge">Current</span>}
            </div>
            <ul className="cl-list">
              {e.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ))}
      </main>
    </div>
  );
}

const FEATURES = [
  { Icon: IconWifiOff, text: "Works fully offline once installed — no account, no internet needed to take orders." },
  { Icon: IconCash, text: "Running bills per table, split checks, cash and change, and daily, weekly and monthly sales." },
  { Icon: IconMic, text: "Ask Agent: type or say orders and questions in plain language." },
  { Icon: IconShield, text: "Your data stays on this phone. No ads, analytics or tracking." },
];

export function AboutScreen() {
  const { push } = useApp.getState();
  return (
    <div className="screen no-nav">
      <TopBar title="About">
        <BackButton label="Settings" />
      </TopBar>
      <main className="screen-body">
        <div className="about-hero">
          <img src={ICON} alt="" />
          <h2>Order Board</h2>
          <div className="v">{APP_VERSION} · offline order taking for street food stalls</div>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <ul className="feature-list">
            {FEATURES.map(({ Icon, text }) => (
              <li key={text}>
                <Icon /> {text}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <button className="set-link" onClick={() => push({ name: "legal", doc: "privacy" })}>
            Privacy Policy
          </button>
          <button className="set-link" onClick={() => push({ name: "legal", doc: "terms" })}>
            Terms of Use
          </button>
          <div className="set-row">
            <span className="set-label">Contact</span>
            <span className="set-value">{CONTACT_EMAIL}</span>
          </div>
        </div>
        <p className="hint center">© {new Date().getFullYear()} {PUBLISHER}</p>
      </main>
    </div>
  );
}

export function LegalScreen({ doc }: { doc: LegalDoc }) {
  const sections = doc === "privacy" ? PRIVACY : TERMS;
  const title = doc === "privacy" ? "Privacy Policy" : "Terms of Use";
  const depth = useApp((s) => s.stack.length);
  return (
    <div className="screen no-nav">
      <TopBar title={title}>
        <BackButton label={depth > 1 ? "Back" : "Tables"} />
      </TopBar>
      <main className="screen-body legal">
        <div className="eff">Effective {LEGAL_EFFECTIVE}</div>
        {sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}

/** First launch (and after the legal text changes): short intro + accept. */
export function WelcomeGate() {
  const { updateSettings, push } = useApp.getState();
  const returning = useApp((s) => s.data.settings.acceptedLegalVersion !== null || s.data.history.length > 0);
  return (
    <motion.div className="gate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <motion.div className="gate-inner" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.05, type: "spring", stiffness: 260, damping: 28 }}>
        <img src={ICON} alt="" />
        <h1 id="gate-title">{returning ? "Order Board has been updated" : "Welcome to Order Board"}</h1>
        <p className="lead">
          {returning
            ? "A fresh new design and Ask Agent — type or say orders like “2 pares with egg for table 3”. All your tables, menu and sales came along."
            : "Take orders table by table, keep running bills, settle with cash and change, and see what sold — all offline, right on this phone."}
        </p>
        <div className="card">
          <ul className="feature-list">
            {FEATURES.map(({ Icon, text }) => (
              <li key={text}>
                <Icon /> {text}
              </li>
            ))}
          </ul>
        </div>
        <div className="links">
          <button onClick={() => push({ name: "legal", doc: "privacy" })}>Privacy Policy</button>
          <button onClick={() => push({ name: "legal", doc: "terms" })}>Terms of Use</button>
        </div>
        <button className="btn btn-primary btn-full" onClick={() => updateSettings({ acceptedLegalVersion: LEGAL_VERSION })}>
          <IconCheck /> Agree and continue
        </button>
        <p className="fine">By continuing you agree to the Terms of Use and acknowledge the Privacy Policy.</p>
      </motion.div>
    </motion.div>
  );
}
