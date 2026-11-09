# Order Board: Development Status

_Last updated: 2026-11-09_

## Overview

Offline order-taking and sales app for a small Filipino street-food stall, run on one Android phone. It's one React + TypeScript codebase that ships two ways: a **web app (PWA)** on GitHub Pages and a native **Android app** (Capacitor APK) built and signed by GitHub Actions. Ask Agent is fully on-device (rule-based, no LLM, no network).

| Item | Value |
|---|---|
| Repository | https://github.com/melhive/OrderBoard |
| Current version | **v19** (`19.0.0`), in PR #5 on `feature/capacitor-android` |
| Live | Web app **v18** at https://melhive.github.io/OrderBoard/ |
| Android app | Preview builds of PR #5 at [OrderBoard-preview.apk](https://github.com/melhive/OrderBoard/releases/download/preview/OrderBoard-preview.apk). From the v19 merge on, the latest release is at https://github.com/melhive/OrderBoard/releases/latest/download/OrderBoard.apk |
| Workflow | feature branch → PR (CI: tests, web build, signed APK, preview release) → merge to `main` (deploys the web app + publishes the release) |

## Versions

| Version | Status | What it brought |
|---|---|---|
| v1–v15 | Retired | Single-file web app (`legacy/`, kept as a reference) |
| v16 | ✅ Shipped (web) | React + TypeScript rebuild, IndexedDB storage, Ask Agent, voice, Android back button, legal screens |
| v17 | ✅ Shipped (web) | Redesign, new logo, full-screen Ask chat with saved history, Taglish |
| v18 | ✅ Shipped (web), live | Utang, GCash/Maya, expenses and profit, sold out, notes, served and wait timers, backup reminder, Talk mode, how-to answers |
| v19 | 🔶 In review (PR #5) | Android app (APK), Bisaya orders, persona, live captions, AI orb, continuous Talk mode, instant payments, per-table undo, download links |

## Test results

| Suite | Tests | Covers |
|---|---|---|
| `src/agent/engine.test.ts` | 87 | Language understanding and plans: orders, payments, utang, Taglish, Bisaya, corrections, multi-command, undo |
| `src/agent/menuMatch.test.ts` | 27 | Fuzzy and phonetic menu matching, mishearings |
| `src/agent/persona.test.ts` | 13 | Varied wording without changing amounts, items or tables (seeded RNG) |
| `src/App.test.tsx` | 40 | The real app in jsdom: order → pay → undo, splits, tables, summary restore/delete/reset, settings, menu editor, back button, Ask, About |
| `src/platform/native.test.ts` | 16 | Android adapters: voice and captions, TTS start-up retry, speech ownership, files, haptics |
| `src/data/db.test.ts` | 7 | Legacy → IndexedDB migration, backup round-trip, write-through |
| **Total** | **190** | ✅ all pass. CI runs them on every push |

Typecheck (`tsc -b`) and the production build are clean.

## Verification levels

| Feature | Automated tests | Checked in a browser | Needs a real phone |
|---|---|---|---|
| Orders, splits, payments, undo, summary, reports | ✅ | ✅ | |
| Ask Agent language understanding (typed) | ✅ | ✅ | |
| Legacy v15 → v16+ migration, offline reload, PWA update | ✅ | ✅ (headless Chrome) | install over the real v15 PWA |
| Android app install, icon, status bar in both themes | | | ✅ owner has installed builds; full checklist pending |
| Voice recognition (online/offline), live captions | ✅ (mocked) | | ✅ owner confirmed it works; noisy-stall check pending |
| Talk mode: orb, TTS voice, keep-screen-on, greeting | ✅ (mocked) | | ✅ greeting fix (TTS start-up, speech ownership) to confirm |
| Backup/CSV save + share, PDF via print (Android) | ✅ (mocked) | | ✅ |

## Known issues and open items

- Talk mode greeting could be cut off or silent on first open (fixed in PR #5; confirm on the phone).
- Play Store: not planned yet. It would need a $25 developer account, an AAB build, a public privacy-policy URL, a real contact email, and a closed test.
- `src/legal/content.ts`: `PUBLISHER` and `CONTACT_EMAIL` are placeholders (`support@example.com`).
- Bundle size is about 495 KB JS (163 KB gzip). That's fine for a precached app; it could shrink with `LazyMotion`.
- The first open after a web-app update can still show the old version; it updates from the next open.

See [AGENTS.md](AGENTS.md) for architecture and invariants, and [docs/BUILDING.md](docs/BUILDING.md) for releases.
