// Is this the Android app (Capacitor) rather than the browser/PWA?
// Native plugins are imported lazily inside native-only branches, so the
// PWA bundle doesn't load them.
import { Capacitor } from "@capacitor/core";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Loads a module once, on first use (for plugins only the app needs). */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= load());
}
