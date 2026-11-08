import type { ReactNode } from "react";
import { useApp } from "../store/appStore";
import type { ThemePref } from "../data/types";
import { APP_VERSION } from "../data/changelog";
import { looksLikeAppData, normalizeAppData } from "../data/migrate";
import { computeCutoffMinutes, formatMinutesAsTime } from "../lib/businessDay";
import { pickTextFile } from "../platform/files";
import { speechInputSupported, speechOutputSupported } from "../platform/voice";
import { exportAllData } from "../store/exports";
import { Segmented, Switch, TopBar } from "../ui/components";
import {
  IconBook,
  IconCheck,
  IconChevron,
  IconClock,
  IconDoc,
  IconDownload,
  IconInfo,
  IconMic,
  IconPalette,
  IconRepeat,
  IconShield,
  IconStar,
  IconStore,
  IconUpload,
  IconVibrate,
  IconVolume,
  LogoMark,
} from "../ui/Icons";

export async function importBackupFlow() {
  const text = await pickTextFile("application/json,.json");
  if (text === null) return;
  const { openDialog } = useApp.getState();
  try {
    const parsed: unknown = JSON.parse(text);
    if (!looksLikeAppData(parsed)) throw new Error("not a backup");
    openDialog({ type: "confirm-restore-backup", pending: normalizeAppData(parsed) });
  } catch {
    openDialog({ type: "import-error" });
  }
}

type Tone = "red" | "gold" | "green" | "blue" | "purple" | "gray";

function Row({ icon, tone, title, sub, trail, onClick }: { icon: ReactNode; tone: Tone; title: string; sub?: ReactNode; trail?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className={`sico ${tone}`}>{icon}</span>
      <span className="smain">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </span>
      {trail !== undefined ? trail : onClick ? <span className="strail"><IconChevron /></span> : null}
    </>
  );
  return onClick ? (
    <button className="srow" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="srow">{body}</div>
  );
}

function Block({ icon, tone, title, sub, children }: { icon: ReactNode; tone: Tone; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="sblock">
      <div className="sblock-head">
        <span className={`sico ${tone}`}>{icon}</span>
        <span className="smain">
          <b>{title}</b>
          {sub && <span>{sub}</span>}
        </span>
      </div>
      {children}
    </div>
  );
}

export function SettingsScreen() {
  const settings = useApp((s) => s.data.settings);
  const menuCount = useApp((s) => s.data.menu.reduce((n, c) => n + c.items.length, 0));
  const { updateSettings, push } = useApp.getState();
  const voiceIn = speechInputSupported();
  const voiceOut = speechOutputSupported();
  const agent = settings.agent;
  const setAgent = (patch: Partial<typeof agent>) => updateSettings({ agent: { ...agent, ...patch } });

  return (
    <div className="screen">
      <TopBar back="Tables" title="Settings" />
      <main className="screen-body">
        <div className="section-title">Business</div>
        <div className="group">
          <Block icon={<IconStore />} tone="red" title="Business name" sub="Shown in the app and as the letterhead on reports">
            <input
              id="biz-name"
              className="field"
              type="text"
              maxLength={40}
              placeholder="e.g. Kuya Rommel’s Pares House"
              aria-label="Business name"
              value={settings.businessName}
              onChange={(e) => updateSettings({ businessName: e.target.value.slice(0, 40) })}
            />
          </Block>
          <Block
            icon={<IconClock />}
            tone="gold"
            title="Working hours"
            sub={<>Sales after midnight count toward the same shift. The day rolls over at {formatMinutesAsTime(computeCutoffMinutes(settings))}.</>}
          >
            <div className="time-row">
              <div>
                <label className="field-label" htmlFor="work-start">Opens</label>
                <input id="work-start" className="field" type="time" value={settings.workStart} onChange={(e) => e.target.value && updateSettings({ workStart: e.target.value })} />
              </div>
              <div>
                <label className="field-label" htmlFor="work-end">Closes</label>
                <input id="work-end" className="field" type="time" value={settings.workEnd} onChange={(e) => e.target.value && updateSettings({ workEnd: e.target.value })} />
              </div>
            </div>
          </Block>
          <Row icon={<IconBook />} tone="green" title="Menu" sub={`${menuCount} items · prices, categories, nicknames`} onClick={() => push({ name: "menu" })} />
        </div>

        <div className="section-title">Appearance</div>
        <div className="group">
          <Block icon={<IconPalette />} tone="purple" title="Theme">
            <Segmented<ThemePref>
              id="theme"
              value={settings.theme}
              onChange={(theme) => updateSettings({ theme })}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "system", label: "Auto" },
              ]}
            />
          </Block>
          <Row
            icon={<IconVibrate />}
            tone="gray"
            title="Vibration"
            sub="Short buzz when adding items and paying"
            trail={<Switch label="Vibration" on={settings.haptics} onChange={(haptics) => updateSettings({ haptics })} />}
          />
        </div>

        <div className="section-title">Ask Agent</div>
        <div className="group">
          <Row
            icon={<IconCheck />}
            tone="blue"
            title="Confirm before adding"
            sub="Off: items are added right away with Undo. Unclear orders always ask."
            trail={<Switch label="Confirm before adding" on={agent.confirmAdds} onChange={(confirmAdds) => setAgent({ confirmAdds })} />}
          />
          <Row
            icon={<IconVolume />}
            tone="blue"
            title="Spoken replies"
            sub={voiceOut ? "Read replies aloud after you speak" : "Not supported on this device"}
            trail={<Switch label="Spoken replies" on={agent.voiceReplies && voiceOut} onChange={(voiceReplies) => setAgent({ voiceReplies })} />}
          />
          <Row
            icon={voiceIn ? <IconRepeat /> : <IconMic />}
            tone="blue"
            title="Hands-free"
            sub={voiceIn ? "Keep listening after each spoken reply" : "Voice input isn’t supported in this browser"}
            trail={<Switch label="Hands-free" on={agent.handsFree && voiceIn} onChange={(handsFree) => setAgent({ handsFree })} />}
          />
        </div>

        <div className="section-title">Data &amp; backup</div>
        <div className="group">
          <Row icon={<IconDownload />} tone="green" title="Export all data" sub="Save a full backup file — keep it off this phone" onClick={() => void exportAllData()} />
          <Row icon={<IconUpload />} tone="gold" title="Import backup" sub="Replace everything with a backup file" onClick={() => void importBackupFlow()} />
        </div>

        <div className="section-title">About</div>
        <div className="group">
          <Row icon={<IconStar />} tone="gold" title="What’s new" sub={`Version ${APP_VERSION}`} onClick={() => push({ name: "changelog" })} />
          <Row icon={<IconInfo />} tone="gray" title="About Order Board" onClick={() => push({ name: "about" })} />
          <Row icon={<IconShield />} tone="gray" title="Privacy Policy" onClick={() => push({ name: "legal", doc: "privacy" })} />
          <Row icon={<IconDoc />} tone="gray" title="Terms of Use" onClick={() => push({ name: "legal", doc: "terms" })} />
        </div>

        <div className="settings-foot">
          <LogoMark size={36} />
          <span>Order Board {APP_VERSION} · Works offline · Data stays on this device</span>
        </div>
      </main>
    </div>
  );
}
