import { useEffect, useState } from "react";
import { isNative } from "../platform/native";
import { useApp } from "../store/appStore";

/** Applies the theme preference to <html data-theme> and the status-bar colour. */
export function useTheme() {
  const pref = useApp((s) => s.data.settings.theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const resolved = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    // Remembered for the startup screen in index.html (no flash of the wrong theme).
    try {
      localStorage.setItem("ob-theme", resolved);
    } catch {
      /* storage blocked: the startup screen just uses dark */
    }
    const color = resolved === "light" ? "#f5f3f0" : "#121110";
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
    if (isNative()) {
      // Status/navigation bar icons: light icons on the dark theme, dark on light.
      void import("@capacitor/core")
        .then(({ SystemBars, SystemBarsStyle }) => SystemBars.setStyle({ style: resolved === "light" ? SystemBarsStyle.Light : SystemBarsStyle.Dark }))
        .catch(() => {});
    }
  }, [resolved]);
  return resolved;
}

/**
 * Android back button / browser back: closes the dialog, agent panel or bill
 * sheet first, then goes back a screen. At the root screen it lets the
 * system handle back (which leaves the app).
 *
 * Works by keeping one extra "guard" history entry while there is something
 * to go back to; a back press pops the guard and we translate it into an
 * in-app back. In the Android app, Capacitor reports the back button
 * directly instead.
 */
export function useBackButton() {
  useEffect(() => {
    if (isNative()) {
      let remove: (() => void) | null = null;
      let disposed = false;
      void import("@capacitor/app").then(async ({ App }) => {
        const handle = await App.addListener("backButton", () => {
          const s = useApp.getState();
          if (s.canGoBack()) s.back();
          // At the main screen, behave like other Android apps: go to the
          // home screen but keep running (and keep the open tables).
          else void App.minimizeApp();
        });
        if (disposed) void handle.remove();
        else remove = () => void handle.remove();
      });
      return () => {
        disposed = true;
        remove?.();
      };
    }
    let armed = false;
    let ignoreNext = false;
    const sync = () => {
      if (ignoreNext) return;
      const can = useApp.getState().canGoBack();
      if (can && !armed) {
        history.pushState({ orderBoard: true }, "");
        armed = true;
      } else if (!can && armed) {
        // Closed via an on-screen button: drop the now-useless guard entry
        // so a single back press at the root exits.
        armed = false;
        ignoreNext = true;
        history.back();
      }
    };
    const onPop = () => {
      if (ignoreNext) {
        ignoreNext = false;
        sync();
        return;
      }
      armed = false;
      const s = useApp.getState();
      if (s.canGoBack()) s.back();
      sync();
    };
    window.addEventListener("popstate", onPop);
    const unsub = useApp.subscribe(sync);
    sync();
    return () => {
      window.removeEventListener("popstate", onPop);
      unsub();
    };
  }, []);
}

/** Re-renders periodically so "Today" rolls over at the business-day cutoff. */
export function useMinuteTick() {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), 60_000);
    const vis = () => document.visibilityState === "visible" && setN((n) => n + 1);
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
}
