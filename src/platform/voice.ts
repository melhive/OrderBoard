// Voice adapter: speech-to-text and text-to-speech.
//
// PWA: uses the Web Speech API (Chrome on Android; recognition needs an
// internet connection there because Chrome sends audio to Google's speech
// service). In a Capacitor build, Android's WebView does NOT provide
// SpeechRecognition — replace startListening() with
// @capacitor-community/speech-recognition and speak() with
// @capacitor-community/text-to-speech. Nothing outside this file changes.

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
  return typeof window !== "undefined" && recognitionCtor() !== null;
}

export function speechOutputSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
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

let preferredVoice: SpeechSynthesisVoice | null = null;
function pickVoice(): SpeechSynthesisVoice | null {
  if (preferredVoice) return preferredVoice;
  const voices = window.speechSynthesis?.getVoices() ?? [];
  preferredVoice =
    voices.find((v) => v.lang === "en-PH") ??
    voices.find((v) => v.lang.startsWith("en") && /female|samantha|google/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null;
  return preferredVoice;
}

export function speak(text: string, onEnd?: () => void) {
  if (!speechOutputSupported()) {
    onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/₱\s?([\d,]+)/g, "$1 pesos").replace(/×/g, " "));
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? "en-US";
  u.rate = 1.05;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  synth.speak(u);
}

export function stopSpeaking() {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}
