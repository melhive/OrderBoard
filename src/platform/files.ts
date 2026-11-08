// File output adapter. In the browser/PWA we use a download link, falling
// back to the share sheet. When the app moves to Capacitor, replace the body
// of saveFile() with @capacitor/filesystem + @capacitor/share — callers stay
// the same.

export async function saveFile(filename: string, mime: string, contents: string): Promise<void> {
  const blob = new Blob([contents], { type: mime });

  // Prefer the native share sheet where it supports files (Android Chrome):
  // lets the user send the file to Drive, Messenger, email, etc.
  const file = typeof File !== "undefined" ? new File([blob], filename, { type: mime }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (file && nav.canShare?.({ files: [file] }) && isStandalone()) {
    try {
      await nav.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return;
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
}

export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
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
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
