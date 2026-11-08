// Haptic feedback. navigator.vibrate works in Android Chrome / PWA; in
// Capacitor swap for @capacitor/haptics.

let enabled = true;

export function setHapticsEnabled(v: boolean) {
  enabled = v;
}

function vibrate(pattern: number | number[]) {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

export const haptic = {
  tap: () => vibrate(8),
  success: () => vibrate([12, 40, 18]),
  warning: () => vibrate([30, 60, 30]),
};
