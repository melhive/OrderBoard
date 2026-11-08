import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadAppData, requestPersistentStorage } from "./data/db";
import { flushPersistence, useApp } from "./store/appStore";
import "./styles.css";

const rootEl = document.getElementById("root")!;
const root = createRoot(rootEl);

function Boot({ error }: { error?: string }) {
  return (
    <div className="boot">
      <img src="./icon-192.png" alt="" />
      {error ? <div className="boot-error">{error}</div> : <span>Loading…</span>}
    </div>
  );
}

async function start() {
  root.render(<Boot />);
  try {
    const { data, source } = await loadAppData();
    useApp.getState().init(data);
    if (source === "legacy") {
      useApp.getState().showToast({ text: "Your tables, menu and sales were carried over from the previous version.", tone: "success" });
    }
  } catch (e) {
    console.error(e);
    root.render(
      <Boot error="Order Board couldn’t open its storage on this device. If you’re in a private/incognito window, open it in a normal window instead. Your data has not been changed." />,
    );
    return;
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  void requestPersistentStorage();
}

// Write pending changes before the app is backgrounded or closed.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPersistence();
});
window.addEventListener("pagehide", flushPersistence);

void start();

// Offline support + automatic updates (only when served over http(s), not in dev).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  // registerType "autoUpdate": a new version activates and the page reloads
  // itself (pending saves are flushed by the pagehide handler above).
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        // Check for a new version whenever the app comes back to the foreground.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void reg.update().catch(() => {});
        });
      },
    });
  });
  // The pre-v16 hand-written worker cached under "order-board-vNN"; Workbox
  // doesn't know those caches, so remove them.
  void caches
    ?.keys()
    .then((keys) => Promise.all(keys.filter((k) => /^order-board-v\d+$/.test(k)).map((k) => caches.delete(k))))
    .catch(() => {});
}
