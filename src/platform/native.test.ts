// @vitest-environment jsdom
// Android-app code paths of the platform adapters, with the Capacitor
// plugins mocked (the real ones only run inside the APK).
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (o: { path: string; directory: string }) => ({ uri: `file:///${o.directory}/${o.path}` }));
const share = vi.fn(async () => ({}));
const impact = vi.fn(async () => {});
const notification = vi.fn(async () => {});
// Fake app-local "Speech" plugin: tests emit its events by hand. Hoisted
// because voice.ts registers the plugin as soon as it's imported.
type Ev = "partial" | "final" | "error" | "end";
const { speechListeners, speech, srStart, srPerm, srStop, srAbort, fakeSpeech } = vi.hoisted(() => {
  const speechListeners: Partial<Record<string, (d: { id: number; text?: string; error?: string }) => void>> = {};
  const speech = { id: 0 };
  const srStart = vi.fn(async (_o: { language: string; preferOffline?: boolean }) => ({ id: ++speech.id }));
  const srPerm = vi.fn(async () => ({ microphone: "granted" }));
  const srStop = vi.fn(async () => {});
  const srAbort = vi.fn(async () => {});
  const fakeSpeech = {
    available: async () => ({ available: true }),
    checkPermissions: srPerm,
    requestPermissions: srPerm,
    start: srStart,
    stop: srStop,
    abort: srAbort,
    addListener: async (ev: string, cb: (d: { id: number }) => void) => {
      speechListeners[ev] = cb;
      return { remove: async () => {} };
    },
  };
  return { speechListeners, speech, srStart, srPerm, srStop, srAbort, fakeSpeech };
});
const emit = (ev: Ev, d: { text?: string; error?: string } = {}) => speechListeners[ev]?.({ id: speech.id, ...d });
const started = () => vi.waitFor(() => expect(srStart).toHaveBeenCalled());

vi.mock("./native", async (importOriginal) => ({ ...(await importOriginal<typeof import("./native")>()), isNative: () => true }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { writeFile },
  Directory: { Documents: "DOCUMENTS", Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("@capacitor/share", () => ({ Share: { share } }));
vi.mock("@capacitor/haptics", () => ({
  Haptics: { impact, notification },
  ImpactStyle: { Light: "LIGHT" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING" },
}));
const tts = vi.hoisted(() => ({ range: null as null | ((i: { start: number; end: number }) => void), finish: null as null | (() => void) }));
vi.mock("@capacitor-community/text-to-speech", () => ({
  QueueStrategy: { Flush: 0 },
  TextToSpeech: {
    isLanguageSupported: async () => ({ supported: true }),
    addListener: async (_ev: string, cb: (i: { start: number; end: number }) => void) => {
      tts.range = cb;
      return { remove: async () => {} };
    },
    speak: () => new Promise<void>((resolve) => (tts.finish = resolve)),
    stop: async () => {},
  },
}));
vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return { ...actual, registerPlugin: ((name: string) => (name === "Speech" ? fakeSpeech : actual.registerPlugin(name))) as typeof actual.registerPlugin };
});

import { pickTextFile, saveFile } from "./files";
import { haptic, setHapticsEnabled } from "./haptics";
import { nativeVoiceError, speak, speechInputSupported, speechOutputSupported, startListening } from "./voice";

const fns = [writeFile, share, impact, notification, srStart, srPerm, srStop, srAbort];
beforeEach(() => fns.forEach((f) => f.mockClear()));

describe("Android app adapters", () => {
  it("saves a copy in Documents/Order Board and opens the share sheet", async () => {
    const r = await saveFile("backup.json", "application/json", "{}");
    expect(r.savedTo).toBe("Documents/Order Board");
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Order Board/backup.json", directory: "DOCUMENTS", recursive: true }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: ["file:///CACHE/backup.json"] }));
  });

  it("still shares when shared storage can't be written", async () => {
    writeFile.mockRejectedValueOnce(new Error("denied"));
    const r = await saveFile("report.csv", "text/csv", "a,b");
    expect(r.savedTo).toBeUndefined();
    expect(share).toHaveBeenCalled();
  });

  it("lets any file be picked for import (Android mislabels JSON)", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    void pickTextFile("application/json,.json");
    const input = click.mock.contexts[0] as HTMLInputElement;
    expect(input.accept).toBe("");
    click.mockRestore();
  });

  it("uses native haptics and respects the setting", async () => {
    setHapticsEnabled(true);
    haptic.tap();
    haptic.success();
    await vi.waitFor(() => expect(notification).toHaveBeenCalledWith({ type: "SUCCESS" }));
    expect(impact).toHaveBeenCalledWith({ style: "LIGHT" });
    fns.forEach((f) => f.mockClear());
    setHapticsEnabled(false);
    haptic.tap();
    await new Promise((r) => setTimeout(r, 10));
    expect(impact).not.toHaveBeenCalled();
    setHapticsEnabled(true);
  });

  it("shows live words while talking, then the finished sentence", async () => {
    expect(speechInputSupported()).toBe(true);
    expect(speechOutputSupported()).toBe(true);
    const onPartial = vi.fn();
    const onFinal = vi.fn();
    const onEnd = vi.fn();
    startListening({ onPartial, onFinal, onEnd });
    await started();
    expect(srStart).toHaveBeenCalledWith(expect.objectContaining({ language: "en-PH" }));
    emit("partial", { text: "2 pares" });
    emit("partial", { text: "2 pares for table 3" });
    expect(onPartial.mock.calls.map((c) => c[0])).toEqual(["2 pares", "2 pares for table 3"]);
    emit("final", { text: "2 pares for table 3" });
    emit("end");
    expect(onFinal).toHaveBeenCalledWith("2 pares for table 3");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("keeps what was heard if the recognizer errors after you stop", async () => {
    const onFinal = vi.fn();
    const onError = vi.fn();
    const s = startListening({ onFinal, onError })!;
    await started();
    emit("partial", { text: "isa ka pastil" });
    s.stop();
    expect(srStop).toHaveBeenCalled();
    emit("error", { error: "other" });
    emit("end");
    expect(onFinal).toHaveBeenCalledWith("isa ka pastil");
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports silence as no-speech", async () => {
    const onError = vi.fn();
    const onEnd = vi.fn();
    startListening({ onFinal: vi.fn(), onError, onEnd });
    await started();
    emit("error", { error: "no-speech" });
    emit("end");
    expect(onError).toHaveBeenCalledWith("no-speech");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("falls back to English (US) when the phone lacks en-PH", async () => {
    const onFinal = vi.fn();
    const onEnd = vi.fn();
    startListening({ onFinal, onEnd });
    await started();
    emit("error", { error: "language" });
    emit("end");
    await vi.waitFor(() => expect(srStart).toHaveBeenCalledTimes(2));
    expect(srStart).toHaveBeenLastCalledWith(expect.objectContaining({ language: "en-US" }));
    await new Promise((r) => setTimeout(r, 0));
    emit("final", { text: "one mami" });
    emit("end");
    expect(onFinal).toHaveBeenCalledWith("one mami");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("reports a denied microphone permission", async () => {
    srPerm.mockResolvedValue({ microphone: "denied" });
    const onError = vi.fn();
    const onEnd = vi.fn();
    startListening({ onFinal: vi.fn(), onError, onEnd });
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledWith("not-allowed");
    expect(srStart).not.toHaveBeenCalled();
    srPerm.mockResolvedValue({ microphone: "granted" });
  });

  it("abort ends quietly without delivering text", async () => {
    const onFinal = vi.fn();
    const onEnd = vi.fn();
    const s = startListening({ onFinal, onEnd })!;
    await started();
    emit("partial", { text: "2 mami" });
    s.abort();
    expect(srAbort).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    emit("final", { text: "2 mami" });
    emit("end");
    expect(onFinal).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("reports how far the spoken reply has got, for live captions", async () => {
    const progress: number[] = [];
    const onEnd = vi.fn();
    speak("Added 2 mami", onEnd, { onProgress: (f) => progress.push(f) });
    await vi.waitFor(() => expect(tts.finish).not.toBeNull());
    tts.range!({ start: 0, end: 5 }); // "Added"
    tts.range!({ start: 8, end: 12 }); // "mami"
    expect(progress.slice(-2)).toEqual([5 / 12, 1]);
    tts.finish!();
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
    expect(progress.at(-1)).toBe(1);
  });

  it("maps the recognizer's error messages", () => {
    expect(nativeVoiceError("not-allowed")).toBe("not-allowed");
    expect(nativeVoiceError("no-speech")).toBe("no-speech");
    expect(nativeVoiceError("network")).toBe("network");
    expect(nativeVoiceError("other")).toBe("other");
    expect(nativeVoiceError("Something unexpected")).toBe("other");
  });
});
