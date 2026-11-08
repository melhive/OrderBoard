import { motion } from "motion/react";
import { useApp, type LegalDoc } from "../store/appStore";
import { APP_VERSION, CHANGELOG } from "../data/changelog";
import { CONTACT_EMAIL, LEGAL_EFFECTIVE, LEGAL_VERSION, PRIVACY, PUBLISHER, TERMS } from "../legal/content";
import { TopBar } from "../ui/components";
import { IconCash, IconCheck, IconChevron, IconDoc, IconShield, IconSparkle, IconWifiOff, LogoMark } from "../ui/Icons";

export function ChangelogScreen() {
  return (
    <div className="screen">
      <TopBar back="Settings" title="What’s new" />
      <main className="screen-body">
        {CHANGELOG.map((e, i) => (
          <div key={e.version} className="card cl-entry">
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
  { Icon: IconWifiOff, tone: "green", text: "Works fully offline — no account and no internet needed to take orders." },
  { Icon: IconCash, tone: "gold", text: "Bills per table, split bills, Cash/GCash/Maya, utang, expenses and profit — daily to monthly." },
  { Icon: IconSparkle, tone: "red", text: "Ask Agent: type, say or talk hands-free in English or Taglish — it knows every part of the app." },
  { Icon: IconShield, tone: "blue", text: "Your data stays on this phone. No ads, analytics or tracking." },
] as const;

function FeatureList() {
  return (
    <ul className="feature-list">
      {FEATURES.map(({ Icon, tone, text }) => (
        <li key={text}>
          <span className={`sico ${tone}`}>
            <Icon />
          </span>
          {text}
        </li>
      ))}
    </ul>
  );
}

export function AboutScreen() {
  const { push } = useApp.getState();
  return (
    <div className="screen">
      <TopBar back="Settings" title="About" />
      <main className="screen-body">
        <div className="about-hero">
          <LogoMark size={88} />
          <h2>Order Board</h2>
          <div className="v">{APP_VERSION} · Offline order taking for food stalls</div>
        </div>
        <div className="card">
          <FeatureList />
        </div>
        <div className="section-title">Legal &amp; contact</div>
        <div className="group">
          <button className="srow" onClick={() => push({ name: "legal", doc: "privacy" })}>
            <span className="sico gray"><IconShield /></span>
            <span className="smain"><b>Privacy Policy</b></span>
            <span className="strail"><IconChevron /></span>
          </button>
          <button className="srow" onClick={() => push({ name: "legal", doc: "terms" })}>
            <span className="sico gray"><IconDoc /></span>
            <span className="smain"><b>Terms of Use</b></span>
            <span className="strail"><IconChevron /></span>
          </button>
          <div className="srow">
            <span className="smain">
              <b>Contact</b>
              <span>{CONTACT_EMAIL}</span>
            </span>
          </div>
        </div>
        <p className="hint center" style={{ marginTop: 20 }}>
          © {new Date().getFullYear()} {PUBLISHER}
        </p>
      </main>
    </div>
  );
}

export function LegalScreen({ doc }: { doc: LegalDoc }) {
  const sections = doc === "privacy" ? PRIVACY : TERMS;
  const title = doc === "privacy" ? "Privacy Policy" : "Terms of Use";
  return (
    <div className="screen">
      <TopBar back="Back" title={title} sub={`Effective ${LEGAL_EFFECTIVE}`} />
      <main className="screen-body legal">
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
    <motion.div className="gate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <motion.div className="gate-inner" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.05, type: "spring", stiffness: 300, damping: 30 }}>
        <LogoMark size={72} />
        <h1 id="gate-title">{returning ? "Order Board has been updated" : "Welcome to Order Board"}</h1>
        <p className="lead">
          {returning
            ? "A cleaner design and a smarter Ask Agent that understands English and Taglish. Your tables, menu and sales are all here."
            : "Take orders by table, keep running bills, settle with cash and change, and see what sold — all offline, right on this phone."}
        </p>
        <div className="card">
          <FeatureList />
        </div>
        <div className="spacer" />
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
