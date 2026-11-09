// @vitest-environment jsdom
// Android-app code paths of the platform adapters, with the Capacitor
// plugins mocked (the real ones only run inside the APK).
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (o: { path: string; directory: string }) => ({ uri: `file:///${o.directory}/${o.path}` }));
const share = vi.fn(async () => ({}));
const impact = vi.fn(async () => {});
const notification = vi.fn(async () => {});
const srStart = vi.fn(async () => ({ matches: ["2 pares for table 3"] }));
const srPerm = vi.fn(async () => ({ speechRecognition: "granted" }));

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
vi.mock("@capacitor-community/speech-recognition", () => ({
  SpeechRecognition: { available: async () => ({ available: true }), checkPermissions: srPerm, requestPermissions: srPerm, start: srStart, stop: async () => {} },
}));

import { pickTextFile, saveFile } from "./files";
import { haptic, setHapticsEnabled } from "./haptics";
import { nativeVoiceError, speechInputSupported, speechOutputSupported, startListening } from "./voice";

const fns = [writeFile, share, impact, notification, srStart, srPerm];
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

  it("reports voice as available and returns the recognized text", async () => {
    expect(speechInputSupported()).toBe(true);
    expect(speechOutputSupported()).toBe(true);
    const onFinal = vi.fn();
    const onEnd = vi.fn();
    startListening({ onFinal, onEnd });
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(onFinal).toHaveBeenCalledWith("2 pares for table 3");
    expect(srStart).toHaveBeenCalledWith(expect.objectContaining({ partialResults: false, popup: false }));
  });

  it("reports a denied microphone permission", async () => {
    srPerm.mockResolvedValue({ speechRecognition: "denied" });
    const onError = vi.fn();
    const onEnd = vi.fn();
    startListening({ onFinal: vi.fn(), onError, onEnd });
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledWith("not-allowed");
    expect(srStart).not.toHaveBeenCalled();
    srPerm.mockResolvedValue({ speechRecognition: "granted" });
  });

  it("abort ends quietly without delivering text", async () => {
    const onFinal = vi.fn();
    const onEnd = vi.fn();
    startListening({ onFinal, onEnd })!.abort();
    expect(onEnd).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(onFinal).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("maps the recognizer's error messages", () => {
    expect(nativeVoiceError("Missing permission")).toBe("not-allowed");
    expect(nativeVoiceError("Insufficient permissions")).toBe("not-allowed");
    expect(nativeVoiceError("No speech input")).toBe("no-speech");
    expect(nativeVoiceError("No match")).toBe("no-speech");
    expect(nativeVoiceError("Network timeout")).toBe("network");
    expect(nativeVoiceError("error from server")).toBe("network");
    expect(nativeVoiceError("Speech recognition service is not available.")).toBe("unsupported");
    expect(nativeVoiceError("Client side error")).toBe("other");
  });
});
