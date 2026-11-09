// Haptic feedback: navigator.vibrate in Android Chrome / PWA,
// @capacitor/haptics in the Android app (the WebView ignores vibrate()).

import { isNative, lazy } from "./native";

const hapticsPlugin = lazy(() => import("@capacitor/haptics"));

let enabled = true;

export function setHapticsEnabled(v: boolean) {
  enabled = v;
}

type Kind = "tap" | "success" | "warning";
const PATTERNS: Record<Kind, number | number[]> = { tap: 8, success: [12, 40, 18], warning: [30, 60, 30] };

function vibrate(kind: Kind) {
  if (!enabled) return;
  if (isNative()) {
    void hapticsPlugin()
      .then(({ Haptics, ImpactStyle, NotificationType }) =>
        kind === "tap"
          ? Haptics.impact({ style: ImpactStyle.Light })
          : Haptics.notification({ type: kind === "success" ? NotificationType.Success : NotificationType.Warning }),
      )
      .catch(() => {});
    return;
  }
  try {
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    /* unsupported */
  }
}

export const haptic = {
  tap: () => vibrate("tap"),
  success: () => vibrate("success"),
  warning: () => vibrate("warning"),
};
