// Prints the GitHub Release notes for the Android APK: install link + the
// newest entry of the in-app changelog (src/data/changelog.ts), so the
// release page and the app's "What's new" always say the same thing.
// Usage: node scripts/release-notes.mjs <owner/repo> <apk-name>
import { readFileSync } from "node:fs";

const [repo = "melhive/OrderBoard", apk = "OrderBoard.apk"] = process.argv.slice(2);
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;
const src = readFileSync(new URL("../src/data/changelog.ts", import.meta.url), "utf8");

// First { version: "vNN", changes: [ "...", ... ] } block.
const m = src.match(/version:\s*"([^"]+)",\s*changes:\s*\[([\s\S]*?)\]\s*}/);
const changes = m ? [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => JSON.parse(`"${x[1]}"`)) : [];

const link = `https://github.com/${repo}/releases/latest/download/${apk}`;
console.log(`## Order Board ${version}

**Install / update:** open this link on your Android phone and install:
${link}

Installs **over** the previous version and keeps your sales, tables and menu (same signing key). Never uninstall to update — that deletes your data.

Coming from the web version? There: Settings → Export all data. In the app: Settings → Import backup.

### What's new${m ? ` in ${m[1]}` : ""}
${changes.map((c) => `- ${c}`).join("\n")}`);
