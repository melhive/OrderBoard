import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadAppData, loadChat, requestPersistentStorage, saveChat } from "./data/db";
import { useAgent, type ChatMessage } from "./agent/agentStore";
import { flushPersistence, useApp } from "./store/appStore";
import { isNative } from "./platform/native";
import "./styles.css";

const rootEl = document.getElementById("root")!;
const root = createRoot(rootEl);

function Boot({ error }: { error: string }) {
  return (
    <div className="boot">
      <img src="./app-icon-192.png" alt="" />
      <div className="boot-error">{error}</div>
    </div>
  );
}

/** Fades out the startup logo from index.html once the app has painted. */
function hideSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.classList.add("hide");
      setTimeout(() => el.remove(), 300);
    }),
  );
}

async function start() {
  try {
    const [{ data, source }, chat] = await Promise.all([loadAppData(), loadChat<ChatMessage>()]);
    useApp.getState().init(data);
    useAgent.getState().hydrate(chat);
    persistChat();
    if (source === "legacy") {
      useApp.getState().showToast({ text: "Your tables, menu and sales were carried over from the previous version.", tone: "success" });
    }
  } catch (e) {
    console.error(e);
    root.render(
      <Boot error="Order Board couldn’t open its storage on this device. If you’re in a private/incognito window, open it in a normal window instead. Your data has not been changed." />,
    );
    hideSplash();
    return;
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  hideSplash();
  void requestPersistentStorage();
}

/** Saves the Ask Agent conversation shortly after it changes. */
function persistChat() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  useAgent.subscribe((s, prev) => {
    if (s.messages === prev.messages) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void saveChat(useAgent.getState().messages).catch(() => {}), 400);
  });
}

// Write pending changes before the app is backgrounded or closed.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPersistence();
});
window.addEventListener("pagehide", flushPersistence);
// Android app: Capacitor fires "pause" when the app goes to the background.
document.addEventListener("pause", flushPersistence);

void start();

// Offline support + automatic updates (only when served over http(s), not in
// dev, and not in the Android app, which already has every file built in and
// updates by installing a new APK).
if (import.meta.env.PROD && "serviceWorker" in navigator && !isNative()) {
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
