// Voice adapter: speech-to-text and text-to-speech.
//
// PWA: uses the Web Speech API (Chrome on Android; recognition needs an
// internet connection there because Chrome sends audio to Google's speech
// service).
// Android app: the WebView has no Web Speech API, so this uses Android's own
// recognizer (@capacitor-community/speech-recognition; works offline when the
// phone has Google's offline speech pack) and the phone's text-to-speech
// engine (@capacitor-community/text-to-speech). Nothing outside this file
// needs to know which.

import { isNative, lazy } from "./native";

// Wrapped in an object: a Capacitor plugin is a proxy that answers every
// property, including "then", so it must never be a promise's result.
const recognizerPlugin = lazy(() => import("@capacitor-community/speech-recognition").then((m) => ({ SR: m.SpeechRecognition })));
const ttsPlugin = lazy(() => import("@capacitor-community/text-to-speech"));

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
  let delivered = false;
  let retried = false;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0]!.transcript;
      else interim += r[0]!.transcript;
    }
    h.onPartial?.((finalText + " " + interim).trim());
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
    if (retried) return;
    if (!delivered && finalText.trim()) {
      delivered = true;
      h.onFinal(finalText.trim());
    }
    h.onEnd?.();
  };
  try {
    rec.start();
  } catch {
    h.onError?.("other");
    return null;
  }
  return { stop: () => rec.stop(), abort: () => rec.abort() };
}

/** Android's recognizer: one utterance, final text only (no live preview). */
function startListeningNative(h: ListenHandlers): ListenSession {
  let finished = false;
  let cancelled = false;
  const finish = (text?: string, err?: VoiceError) => {
    if (finished) return;
    finished = true;
    if (!cancelled) {
      if (err) h.onError?.(err);
      else if (text) h.onFinal(text);
    }
    h.onEnd?.();
  };
  void (async () => {
    try {
      const { SR } = await recognizerPlugin();
      if (!(await SR.available()).available) return finish(undefined, "unsupported");
      let perm = await SR.checkPermissions();
      if (perm.speechRecognition !== "granted") perm = await SR.requestPermissions();
      if (perm.speechRecognition !== "granted") return finish(undefined, "not-allowed");
      if (cancelled) return finish();
      // Google's offline packs are per language; English (US) is the one most
      // phones have, so use it when there's no connection.
      const language = navigator.onLine === false ? "en-US" : "en-PH";
      const r = await SR.start({ language, maxResults: 1, partialResults: false, popup: false });
      const text = r?.matches?.[0]?.trim();
      finish(text || undefined, text ? undefined : "no-speech");
    } catch (e) {
      finish(undefined, nativeVoiceError(String((e as Error)?.message ?? e)));
    }
  })();
  const stop = () => void recognizerPlugin().then(({ SR }) => SR.stop()).catch(() => {});
  return {
    stop,
    abort: () => {
      cancelled = true;
      stop();
      finish();
    },
  };
}

/** Maps the plugin's error messages (see its SpeechRecognition.java) to ours. */
export function nativeVoiceError(message: string): VoiceError {
  const m = message.toLowerCase();
  if (m.includes("permission")) return "not-allowed";
  if (m.includes("no speech") || m.includes("no match") || m.includes("didn't understand")) return "no-speech";
  if (m.includes("network") || m.includes("server")) return "network";
  if (m.includes("not available")) return "unsupported";
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

export function speak(text: string, onEnd?: () => void, opts: { tagalog?: boolean } = {}) {
  if (isNative()) return speakNative(text, onEnd, opts);
  if (!speechOutputSupported()) {
    onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(forSpeech(text));
  const v = pickVoice(!!opts.tagalog);
  if (v) u.voice = v;
  u.lang = v?.lang ?? "en-US";
  u.rate = 1.05;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onEnd?.();
  };
  u.onend = finish;
  u.onerror = finish;
  synth.speak(u);
  // Some Android voices never fire onend; don't let the conversation stall.
  setTimeout(finish, 2500 + forSpeech(text).length * 90);
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

function speakNative(text: string, onEnd: (() => void) | undefined, opts: { tagalog?: boolean }) {
  const said = forSpeech(text);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onEnd?.();
  };
  void (async () => {
    try {
      const { TextToSpeech, QueueStrategy } = await ttsPlugin();
      const lang = opts.tagalog && (await nativeLangSupported("fil-PH")) ? "fil-PH" : (await nativeLangSupported("en-PH")) ? "en-PH" : "en-US";
      await TextToSpeech.speak({ text: said, lang, rate: 1.0, queueStrategy: QueueStrategy.Flush });
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
