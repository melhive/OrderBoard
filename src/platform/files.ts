// File output adapter.
// - PWA: a download link, or the share sheet when installed (Android Chrome).
// - Android app: writes the file to Documents/Order Board on the phone, then
//   opens the share sheet so it can also go to Drive, Messenger, email, etc.
// Callers don't need to know which.

import { isNative } from "./native";

export interface SaveResult {
  /** Where a copy was kept on the phone (Android app only), e.g. "Documents/Order Board". */
  savedTo?: string;
}

export async function saveFile(filename: string, mime: string, contents: string): Promise<SaveResult> {
  if (isNative()) return saveFileNative(filename, mime, contents);

  const blob = new Blob([contents], { type: mime });

  // Prefer the native share sheet where it supports files (Android Chrome):
  // lets the user send the file to Drive, Messenger, email, etc.
  const file = typeof File !== "undefined" ? new File([blob], filename, { type: mime }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (file && nav.canShare?.({ files: [file] }) && isStandalone()) {
    try {
      await nav.share({ files: [file], title: filename });
      return {};
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return {};
      /* fall through to download */
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return {};
}

const PHONE_FOLDER = "Order Board";

async function saveFileNative(filename: string, _mime: string, contents: string): Promise<SaveResult> {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const result: SaveResult = {};
  // A copy the user can find later in the Files app (Documents/Order Board).
  try {
    await Filesystem.writeFile({ path: `${PHONE_FOLDER}/${filename}`, data: contents, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    result.savedTo = `Documents/${PHONE_FOLDER}`;
  } catch {
    /* no access to shared storage on this phone: the share sheet still works */
  }
  // And the share sheet, to send it somewhere off the phone.
  try {
    const { uri } = await Filesystem.writeFile({ path: filename, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, files: [uri], dialogTitle: filename });
  } catch {
    /* share sheet closed */
  }
  return result;
}

export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    // Android's file picker often labels backups from Drive/Messenger as
    // "application/octet-stream", so in the app let every file be picked
    // (the import checks the contents anyway).
    if (!isNative()) input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsText(f);
    };
    input.click();
  });
}

export function isStandalone(): boolean {
  return (
    isNative() ||
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Opens the print dialog (which also offers "Save as PDF"). */
export async function printPage(): Promise<void> {
  if (isNative()) {
    const { registerPlugin } = await import("@capacitor/core");
    const Print = registerPlugin<{ print(o: { name: string }): Promise<void> }>("Print");
    try {
      await Print.print({ name: "Order Board report" });
    } catch {
      /* no print service on this phone */
    }
    return;
  }
  window.print();
}
