import { useApp } from "../store/appStore";
import type { ThemePref } from "../data/types";
import { APP_VERSION } from "../data/changelog";
import { looksLikeAppData, normalizeAppData } from "../data/migrate";
import { computeCutoffMinutes, formatMinutesAsTime } from "../lib/businessDay";
import { pickTextFile } from "../platform/files";
import { speechInputSupported, speechOutputSupported } from "../platform/voice";
import { exportAllData } from "../store/exports";
import { BackButton, Segmented, Switch, TopBar } from "../ui/components";
import { IconChevron } from "../ui/Icons";

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

function Link({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="set-link" onClick={onClick}>
      {label} <IconChevron />
    </button>
  );
}

export function SettingsScreen() {
  const settings = useApp((s) => s.data.settings);
  const { updateSettings, push } = useApp.getState();
  const voiceIn = speechInputSupported();
  const voiceOut = speechOutputSupported();
  const agent = settings.agent;
  const setAgent = (patch: Partial<typeof agent>) => updateSettings({ agent: { ...agent, ...patch } });

  return (
    <div className="screen no-nav">
      <TopBar title="Settings">
        <BackButton label="Tables" />
      </TopBar>
      <main className="screen-body">
        <div className="cat-label">Appearance</div>
        <div className="card">
          <div className="set-row">
            <span className="set-label">Theme</span>
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
          </div>
          <div className="set-row">
            <span className="set-label">
              Vibration
              <small>Short buzz when adding items and on payment</small>
            </span>
            <Switch label="Vibration" on={settings.haptics} onChange={(haptics) => updateSettings({ haptics })} />
          </div>
        </div>

        <div className="cat-label">Business</div>
        <div className="card">
          <label className="field-label" htmlFor="biz-name">
            Business name
          </label>
          <input
            id="biz-name"
            className="field"
            type="text"
            maxLength={40}
            placeholder="e.g. Kuya Rommel’s Pares House"
            value={settings.businessName}
            onChange={(e) => updateSettings({ businessName: e.target.value.slice(0, 40) })}
          />
          <div className="hint">Shown above “Order Board” and as the letterhead on your PDF/CSV reports.</div>
        </div>

        <div className="cat-label">Working hours</div>
        <div className="card">
          <div className="form">
            <div className="row">
              <div>
                <label className="field-label" htmlFor="work-start">
                  Open
                </label>
                <input id="work-start" className="field" type="time" value={settings.workStart} onChange={(e) => e.target.value && updateSettings({ workStart: e.target.value })} />
              </div>
              <div>
                <label className="field-label" htmlFor="work-end">
                  Close
                </label>
                <input id="work-end" className="field" type="time" value={settings.workEnd} onChange={(e) => e.target.value && updateSettings({ workEnd: e.target.value })} />
              </div>
            </div>
          </div>
          <div className="hint">
            Sales are grouped into business days by these hours, so sales after midnight still count toward the same shift. The day rolls over at{" "}
            <b>{formatMinutesAsTime(computeCutoffMinutes(settings))}</b>.
          </div>
        </div>

        <div className="cat-label">Menu</div>
        <div className="card">
          <Link label="Edit menu" onClick={() => push({ name: "menu" })} />
        </div>

        <div className="cat-label">Ask Agent</div>
        <div className="card">
          <div className="set-row">
            <span className="set-label">
              Ask before adding items
              <small>Off: items are added right away with an Undo button. Unclear orders always ask.</small>
            </span>
            <Switch label="Ask before adding items" on={agent.confirmAdds} onChange={(confirmAdds) => setAgent({ confirmAdds })} />
          </div>
          <div className="set-row">
            <span className="set-label">
              Spoken replies
              <small>{voiceOut ? "Read replies aloud after a voice request" : "Not supported on this device"}</small>
            </span>
            <Switch label="Spoken replies" on={agent.voiceReplies && voiceOut} onChange={(voiceReplies) => setAgent({ voiceReplies })} />
          </div>
          <div className="set-row">
            <span className="set-label">
              Hands-free
              <small>{voiceIn ? "Keep listening after each spoken reply" : "Voice input is not supported in this browser"}</small>
            </span>
            <Switch label="Hands-free" on={agent.handsFree && voiceIn} onChange={(handsFree) => setAgent({ handsFree })} />
          </div>
        </div>

        <div className="cat-label">Data</div>
        <div className="card">
          <div className="btn-row">
            <button className="btn btn-leaf" onClick={() => void exportAllData()}>
              Export all data
            </button>
            <button className="btn btn-secondary" onClick={() => void importBackupFlow()}>
              Import backup
            </button>
          </div>
          <div className="hint">Full backup of every table, sale and menu item. Your data lives only on this phone — keep a copy somewhere else.</div>
        </div>

        <div className="cat-label">About</div>
        <div className="card">
          <div className="set-row">
            <span className="set-label">Version</span>
            <span className="set-value">{APP_VERSION}</span>
          </div>
          <Link label="What’s new" onClick={() => push({ name: "changelog" })} />
          <Link label="About Order Board" onClick={() => push({ name: "about" })} />
          <Link label="Privacy Policy" onClick={() => push({ name: "legal", doc: "privacy" })} />
          <Link label="Terms of Use" onClick={() => push({ name: "legal", doc: "terms" })} />
        </div>
      </main>
    </div>
  );
}
