// Voice adapter: speech-to-text and text-to-speech.
//
// PWA: uses the Web Speech API (Chrome on Android; recognition needs an
// internet connection there because Chrome sends audio to Google's speech
// service).
// Android app: the WebView has no Web Speech API, so this uses the app's own
// "Speech" plugin (android/…/SpeechPlugin.java: Android's recognizer, with
// live partial words; works offline when the phone has Google's offline
// speech pack) and the phone's text-to-speech engine
// (@capacitor-community/text-to-speech). Nothing outside this file needs to
// know which.

import { registerPlugin, type PermissionState, type PluginListenerHandle } from "@capacitor/core";
import { isNative, lazy } from "./native";

const ttsPlugin = lazy(() => import("@capacitor-community/text-to-speech"));

type SpeechEvent = { id: number; text?: string; error?: string; level?: number };
interface SpeechPluginApi {
  available(): Promise<{ available: boolean }>;
  checkPermissions(): Promise<{ microphone: PermissionState }>;
  requestPermissions(): Promise<{ microphone: PermissionState }>;
  start(o: { language: string; preferOffline?: boolean }): Promise<{ id: number }>;
  stop(): Promise<void>;
  abort(): Promise<void>;
  addListener(event: "partial" | "final" | "error" | "end" | "level", cb: (d: SpeechEvent) => void): Promise<PluginListenerHandle>;
}
/** The app-local Android plugin (never awaited or returned from a promise: it's a proxy). */
const Speech = registerPlugin<SpeechPluginApi>("Speech");

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => SR) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechInputSupported(): boolean {
  return typeof window !== "undefined" && (isNative() || recognitionCtor() !== null);
}

export function speechOutputSupported(): boolean {
  return typeof window !== "undefined" && (isNative() || "speechSynthesis" in window);
}

export type VoiceError = "not-allowed" | "no-speech" | "network" | "unsupported" | "other";

export interface ListenHandlers {
  onPartial?(text: string): void;
  onFinal(text: string): void;
  onEnd?(): void;
  onError?(err: VoiceError): void;
  /** Microphone loudness, 0–1, several times a second (Android app only). */
  onLevel?(level: number): void;
}

/** After words were heard, this much silence ends the sentence and sends it. */
export const PAUSE_TO_SEND_MS = 1200;

/** Calls stop() once the speaker pauses: restarted by every new partial result. */
function pauseWatcher(stop: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    heard() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(stop, PAUSE_TO_SEND_MS);
    },
    clear() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export interface ListenSession {
  stop(): void;
  abort(): void;
}

const LANGS = ["en-PH", "en-US"];

export function startListening(h: ListenHandlers, langIndex = 0): ListenSession | null {
  if (isNative()) return startListeningNative(h);
  const Ctor = recognitionCtor();
  if (!Ctor) {
    h.onError?.("unsupported");
    return null;
  }
  const rec = new Ctor();
  rec.lang = LANGS[langIndex] ?? "en-US";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = "";
  let lastHeard = "";
  let delivered = false;
  let retried = false;
  const pause = pauseWatcher(() => {
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  });
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0]!.transcript;
      else interim += r[0]!.transcript;
    }
    lastHeard = (finalText + " " + interim).trim();
    h.onPartial?.(lastHeard);
    if (lastHeard) pause.heard();
  };
  rec.onerror = (e) => {
    if (e.error === "language-not-supported" && langIndex + 1 < LANGS.length) {
      retried = true;
      startListening(h, langIndex + 1);
      return;
    }
    const map: Record<string, VoiceError> = { "not-allowed": "not-allowed", "service-not-allowed": "not-allowed", "no-speech": "no-speech", network: "network", aborted: "other" };
    if (e.error !== "aborted") h.onError?.(map[e.error] ?? "other");
  };
  rec.onend = () => {
    pause.clear();
    if (retried) return;
    // Stopped after a pause: use what was heard even if it never became "final".
    const text = (finalText.trim() || (aborted ? "" : lastHeard)).trim();
    if (!delivered && text) {
      delivered = true;
      h.onFinal(text);
    }
    h.onEnd?.();
  };
  let aborted = false;
  try {
    rec.start();
  } catch {
    h.onError?.("other");
    return null;
  }
  return {
    stop: () => rec.stop(),
    abort: () => {
      aborted = true;
      pause.clear();
      rec.abort();
    },
  };
}

/** The session that native speech events are delivered to (one at a time). */
type NativeEv = "partial" | "final" | "error" | "end" | "level";
let nativeActive: ((event: NativeEv, d: SpeechEvent) => void) | null = null;
const nativeEvents = lazy(async () => {
  for (const ev of ["partial", "final", "error", "end", "level"] as const) await Speech.addListener(ev, (d) => nativeActive?.(ev, d));
  return true;
});

/**
 * Android's recognizer with live captions: onPartial gets the words so far
 * while the person talks, onFinal the finished sentence. If it stops on an
 * error after hearing something (some phones do when you tap stop), the last
 * words heard are used as the sentence.
 */
function startListeningNative(h: ListenHandlers, language = "en-PH"): ListenSession {
  let finished = false;
  let cancelled = false;
  let sessionId: number | undefined;
  let heard = "";
  let finalText = "";
  let err: VoiceError | undefined;
  let safety: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    pause.clear();
    if (safety) clearTimeout(safety);
    if (nativeActive === onEvent) nativeActive = null;
    if (!cancelled) {
      const text = (finalText || heard).trim();
      if (text) h.onFinal(text);
      else h.onError?.(err ?? "no-speech");
    }
    h.onEnd?.();
  };
  const onEvent = (event: NativeEv, d: SpeechEvent) => {
    if (finished || (sessionId !== undefined && d.id !== sessionId)) return;
    if (event === "level") h.onLevel?.(d.level ?? 0);
    else if (event === "partial" && d.text) {
      heard = d.text;
      h.onPartial?.(d.text);
      pause.heard();
    } else if (event === "final") finalText = d.text ?? "";
    else if (event === "error") {
      // en-PH missing on this phone (often offline): try English (US) once.
      if (d.error === "language" && language !== "en-US" && !heard) {
        nativeActive = null;
        finished = true;
        const next = startListeningNative(h, "en-US");
        replace = next;
        return;
      }
      err = nativeVoiceError(d.error ?? "other");
    } else if (event === "end") finish();
  };
  let replace: ListenSession | null = null;
  // Android usually ends by itself on silence; this makes sure it never waits long.
  const stopNow = () => {
    void Speech.stop().catch(() => {});
    if (!safety) safety = setTimeout(finish, 2500);
  };
  const pause = pauseWatcher(stopNow);
  void (async () => {
    try {
      await nativeEvents();
      if (!(await Speech.available()).available) {
        err = "unsupported";
        return finish();
      }
      let perm = await Speech.checkPermissions();
      if (perm.microphone !== "granted") perm = await Speech.requestPermissions();
      if (perm.microphone !== "granted") {
        err = "not-allowed";
        return finish();
      }
      if (cancelled || finished) return finish();
      nativeActive = onEvent;
      const r = await Speech.start({ language, preferOffline: navigator.onLine === false });
      sessionId = r.id;
    } catch (e) {
      err = nativeVoiceError(String((e as Error)?.message ?? e));
      finish();
    }
  })();
  return {
    stop: () => {
      if (replace) return replace.stop();
      stopNow();
    },
    abort: () => {
      if (replace) return replace.abort();
      cancelled = true;
      void Speech.abort().catch(() => {});
      finish();
    },
  };
}

/** Maps the Speech plugin's error names (see SpeechPlugin.java) to ours. */
export function nativeVoiceError(message: string): VoiceError {
  const m = message.toLowerCase();
  if (m.includes("not-allowed") || m.includes("permission")) return "not-allowed";
  if (m.includes("no-speech") || m.includes("no match")) return "no-speech";
  if (m.includes("network") || m.includes("server")) return "network";
  if (m.includes("unsupported") || m.includes("not available")) return "unsupported";
  return "other";
}

let preferredVoice: SpeechSynthesisVoice | null = null;
let filipinoVoice: SpeechSynthesisVoice | null | undefined;
function pickVoice(tagalog: boolean): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (tagalog) {
    if (filipinoVoice === undefined || (filipinoVoice === null && voices.length)) {
      filipinoVoice = voices.find((v) => /^(fil|tl)(-|_|$)/i.test(v.lang)) ?? null;
    }
    if (filipinoVoice) return filipinoVoice;
  }
  if (preferredVoice) return preferredVoice;
  preferredVoice =
    voices.find((v) => v.lang === "en-PH") ??
    voices.find((v) => v.lang.startsWith("en") && /female|samantha|google/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null;
  return preferredVoice;
}

/** Text as it should be read aloud: pesos spelled out, symbols dropped. */
export function forSpeech(text: string): string {
  return text
    .replace(/₱\s?([\d,]+)/g, "$1 pesos")
    .replace(/(\d+)×/g, "$1 ")
    .replace(/×/g, " ")
    .replace(/w\//g, "with ")
    .replace(/&/g, " and ")
    .replace(/[“”"]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/—/g, ", ");
}

export interface SpeakOptions {
  tagalog?: boolean;
  /** How far through the reply the voice is, 0–1 (for live captions). */
  onProgress?: (fraction: number) => void;
}

/** Roughly how fast the phone voices talk at our rate, for the caption estimate. */
const CHARS_PER_SEC = 13.5;

/**
 * Reports speaking progress: the engine's own word events when it sends them,
 * otherwise an estimate from elapsed time (never past 95% until it's done).
 */
function progressTracker(said: string, onProgress?: (f: number) => void) {
  const len = Math.max(1, said.length);
  let last = 0;
  let real = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const emit = (f: number) => {
    const v = Math.min(1, f);
    if (v <= last) return;
    last = v;
    onProgress?.(v);
  };
  return {
    start() {
      if (!onProgress || timer) return;
      const t0 = Date.now();
      timer = setInterval(() => {
        if (!real) emit(Math.min(0.95, (((Date.now() - t0) / 1000) * CHARS_PER_SEC) / len));
      }, 120);
    },
    word(endChar: number) {
      real = true;
      emit(endChar / len);
    },
    done() {
      if (timer) clearInterval(timer);
      emit(1);
    },
  };
}

export function speak(text: string, onEnd?: () => void, opts: SpeakOptions = {}) {
  if (isNative()) return speakNative(text, onEnd, opts);
  if (!speechOutputSupported()) {
    opts.onProgress?.(1);
    onEnd?.();
    return;
  }
  const said = forSpeech(text);
  const synth = window.speechSynthesis;
  let u: SpeechSynthesisUtterance;
  try {
    synth.cancel();
    u = new SpeechSynthesisUtterance(said);
  } catch {
    opts.onProgress?.(1);
    onEnd?.();
    return;
  }
  const v = pickVoice(!!opts.tagalog);
  if (v) u.voice = v;
  u.lang = v?.lang ?? "en-US";
  u.rate = 0.95; // a touch slower than normal: easier to follow at a noisy stall
  const progress = progressTracker(said, opts.onProgress);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    progress.done();
    onEnd?.();
  };
  u.onstart = () => progress.start();
  u.onboundary = (e) => progress.word(e.charIndex + (e.charLength || 0));
  u.onend = finish;
  u.onerror = finish;
  try {
    synth.speak(u);
  } catch {
    // A broken TTS engine must not take the screen down; just move on.
    finish();
    return;
  }
  // Some Android voices never fire onend; don't let the conversation stall.
  setTimeout(finish, 2500 + said.length * 90);
}

export function stopSpeaking() {
  if (isNative()) {
    void ttsPlugin().then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => {});
    return;
  }
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}

const nativeLangCache = new Map<string, Promise<boolean>>();
function nativeLangSupported(lang: string): Promise<boolean> {
  let p = nativeLangCache.get(lang);
  if (!p) {
    p = ttsPlugin()
      .then(({ TextToSpeech }) => TextToSpeech.isLanguageSupported({ lang }))
      .then((r) => r.supported)
      .catch(() => false);
    nativeLangCache.set(lang, p);
  }
  return p;
}

/** Word-progress events from the TTS plugin go to whichever reply is speaking. */
let nativeRange: ((endChar: number) => void) | null = null;
const nativeRangeEvents = lazy(async () => {
  const { TextToSpeech } = await ttsPlugin();
  await TextToSpeech.addListener("onRangeStart", (info) => nativeRange?.(info.end));
  return true;
});

function speakNative(text: string, onEnd: (() => void) | undefined, opts: SpeakOptions) {
  const said = forSpeech(text);
  const progress = progressTracker(said, opts.onProgress);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (nativeRange === onRange) nativeRange = null;
    progress.done();
    onEnd?.();
  };
  const onRange = (end: number) => progress.word(end);
  void (async () => {
    try {
      const { TextToSpeech, QueueStrategy } = await ttsPlugin();
      const lang = opts.tagalog && (await nativeLangSupported("fil-PH")) ? "fil-PH" : (await nativeLangSupported("en-PH")) ? "en-PH" : "en-US";
      if (opts.onProgress) await nativeRangeEvents().catch(() => false);
      if (done) return;
      nativeRange = onRange;
      progress.start();
      // A touch slower than normal: easier to follow at a noisy stall.
      await TextToSpeech.speak({ text: said, lang, rate: 0.9, queueStrategy: QueueStrategy.Flush });
    } catch {
      /* no TTS engine, or stopped */
    }
    finish();
  })();
  // Never let the conversation stall if the engine doesn't report back.
  setTimeout(finish, 4000 + said.length * 90);
}

/** Keeps the screen on during Talk mode (where supported). Returns a release function. */
export async function keepScreenOn(): Promise<() => void> {
  if (isNative()) {
    try {
      const { KeepAwake } = await import("@capacitor-community/keep-awake");
      await KeepAwake.keepAwake();
      return () => void KeepAwake.allowSleep().catch(() => {});
    } catch {
      return () => {};
    }
  }
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    const lock = await nav.wakeLock?.request("screen");
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}
