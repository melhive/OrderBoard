# AGENTS.md — Order Board

Read this first. It tells you what this app is, how it is built, and the rules that keep it from breaking for the people who use it every night.

## What this app is

**Order Board** is an offline order-taking and sales-tracking app for a small Filipino street-food stall that sells pares, mami, pastil and siomai. One person runs it on an Android phone, as a PWA installed from Chrome or (since v19) as a Capacitor Android app (APK), while serving customers, often late at night and without a reliable internet connection.

Core jobs, in order of importance:

1. **Take orders per table.** Tap a table, tap menu items, and the running bill updates. A table can have several **split bills**, each paid separately. Custom (named) tables like "Takeout" can be added and removed.
2. **Settle bills.** Enter cash received, the change is shown, then tap **Paid**. The bill becomes a transaction in sales history. Mistakes can be undone: Undo in the toast, or **Restore to table** in Summary.
3. **See sales.** The Summary screen has Today, Week, Month, All time, and a custom date range, with best sellers, transactions and a day-by-day breakdown. It exports CSV or a printable PDF report, and has Reset Today.
4. **Ask Agent.** A chat/voice assistant that understands "2 pares with egg and rice for table 3", "table 1 paid 500", "how much did we sell today?", "change the price of mami to 55". It runs **fully on-device**: rule-based NLP, no LLM, no network.
5. **Settings.** Theme, vibration, business name (letterhead on reports), working hours, menu editor (drag to reorder, nicknames/aliases for the agent), agent preferences, full backup export/import, changelog, about, privacy/terms.

**Business day:** a stall open 6 PM–2 AM must count a 1 AM sale as part of the previous evening. Each day rolls over halfway through the closed hours. All "today", report and reset logic goes through `src/lib/businessDay.ts`. Never use calendar dates directly for sales grouping.

Currency is PHP (₱), shown as whole pesos via `peso()`.

## History and versions

- **v1–v15** (`legacy/index.html`, `legacy/sw.js`): a single hand-written HTML file storing everything in `localStorage` under `order_board_streetfood_v1`. It is kept **only as a behavioural reference**: don't edit it or ship it.
- **v16** (this codebase, merged to `main`): React + TypeScript rebuild. Same features, a new design, IndexedDB storage, Ask Agent, voice, Android back button, legal screens.
- **v17**: UI redesign (new logo/icons, grouped settings, order screen with sticky categories and a cart bar), Ask Agent as a full chat screen with saved history, and more agent abilities (Taglish, move table, change calculation, comparisons).
- **v18**: utang (credit), Cash/GCash/Maya, expenses and profit, sold out, item notes, served marks and wait timers, backup reminder; Ask Agent knows the whole app (how-to), chats in Taglish, fixes mistakes, handles several commands at once and gives tips; Talk mode (hands-free voice); inline startup screen.
- **v19**: the same web app also ships as a **Capacitor Android app** (`android/`), built and signed by GitHub Actions. The PWA keeps working unchanged.
- The version shown in the app is the **major** of `package.json` `version` (`18.0.0` → "v18"). When you ship user-visible changes, bump it and add an entry at the top of `CHANGELOG` in `src/data/changelog.ts`.

## Stack and commands

React 18, TypeScript (strict), Vite 6, Zustand 5 (state), Dexie 4 (IndexedDB), motion 12 (`motion/react`, animations), vite-plugin-pwa (Workbox service worker), Capacitor 8 (Android app), Vitest + jsdom + fake-indexeddb (tests). Package manager: **pnpm** (`.npmrc` uses a hoisted node-linker).

```sh
pnpm install
pnpm dev          # dev server (service worker disabled in dev)
pnpm test         # vitest: engine, matcher, persistence, full-UI tests
pnpm typecheck    # tsc -b
pnpm build        # typecheck + production build to dist/
pnpm preview      # serve dist/ (service worker active) — use to test offline/PWA
pnpm android:sync # build + copy dist/ into android/ (only needed for a local Gradle build)
```

In this Termux/proot sandbox pnpm isn't on PATH: use `corepack pnpm …`.

CI (`.github/workflows/deploy.yml`): on every push and PR it runs install, test and build. On `main` it also deploys `dist/` to **GitHub Pages**. The repo's Pages source must be set to "GitHub Actions".

`.github/workflows/android.yml` builds the **APK** on every push and PR (no Android Studio; the runner has Java 21 and the Android SDK): `pnpm build` → `cap sync android` → `gradlew assembleRelease`. The APK is attached to the run as an artifact. On `main` it is also published as GitHub Release `v<version>` (re-uploaded if that release exists). Signing uses repo secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` (PKCS12, alias `orderboard`). Without them it builds a debug APK. **The same key must sign every update**, or Android refuses to update and the user would have to uninstall, which deletes their data. The owner keeps the key backup. Never regenerate it.

There is no browser in the agent sandbox. UI behaviour is verified by `src/App.test.tsx`, which renders the real `<App/>` in jsdom and clicks through it. Visual and layout checks need a real phone or browser (`pnpm dev`, then open on the phone over LAN, or use Chrome devtools device mode).

## Source map

```
index.html                 Vite entry: inline startup logo (#splash, faded out by main.tsx) + theme pre-paint from localStorage "ob-theme"
vite.config.ts             base "./", PWA manifest + Workbox, vitest config
public/                    icons (copied as-is). Named app-icon-*.png so Android notices icon changes; rename again if the icon changes
src/main.tsx               boot: load data → init store → render; SW registration; old-cache cleanup
src/App.tsx                route → screen with slide transitions; nav, FAB, agent, dialogs, toast, welcome gate
src/styles.css             all styles; design tokens on :root, light theme via [data-theme="light"]
src/data/
  types.ts                 data model (field names match legacy format — see invariants)
  defaults.ts              default menu/tables/settings, freshData()
  migrate.ts               normalizeAppData(): legacy state + any backup → AppData (defensive)
  db.ts                    Dexie: kv["workspace"] + history table (one row per txn); legacy migration
  changelog.ts             APP_VERSION + user-facing CHANGELOG
src/lib/
  bill.ts                  totals, display names, addToItems
  businessDay.ts           business-day keys, periods, grouping, summarize()
  money.ts                 payment methods, utang accounts/balances/allocation, expenses, profit, sold out, backupDue()
  format.ts                peso(), times, dates, plural, verify codes
src/store/
  appStore.ts              Zustand store: data + UI state + all actions; persistence plumbing; undo stack
  exports.ts               CSV/PDF report export, full-backup export
src/reports/reports.ts     CSV builder + printable letterhead HTML
src/platform/              browser vs Android-app adapters: native.ts (isNative, lazy), files.ts (save/share/pick/print), haptics.ts, voice.ts
android/                   Capacitor Android project (committed). Icons in res/mipmap-*, launch theme in res/values/styles.xml,
                           PrintPlugin.java (app-local "Print" plugin), versionCode/Name read from package.json in app/build.gradle
capacitor.config.json      appId com.melhive.orderboard, webDir dist, SystemBars insets → env(safe-area-inset-*)
src/agent/
  engine.ts                respond(input, world, ctx) → reply (PURE; never mutates); also insights()/statusLine()
  knowledge.ts             how-to topics for every feature, small talk (EN/Taglish), isTaglish()
  menuMatch.ts, text.ts    tokenizing, number words, fuzzy/phonetic menu matching, mishearing synonyms
  executor.ts              applies a Plan to the store (checkpoint first → undoable)
  agentStore.ts            chat messages + conversation context
  AskScreen.tsx            full-screen chat (route "ask"): scrollable saved history, cards, voice, confirm/undo, tip bar
  TalkScreen.tsx           Talk mode (route "talk"): listen → answer aloud → listen again; yes/no by voice
src/screens/               Tables, Order, Summary, Utang, Settings, MenuEditor, InfoScreens (changelog/about/legal/welcome)
src/ui/                    components (TopBar, BottomNav, Switch, Segmented, Toast), Dialogs, Icons, hooks
src/legal/content.ts       Privacy Policy + Terms text, LEGAL_VERSION
legacy/                    v15 single-file app (reference only)
```

## How it works

**State.** One Zustand store (`useApp`) holds `data: AppData` (persisted) plus UI state: the route `stack`, `dialog`, `sheetOpen`, `activeSplit`, `cashInput`, `summary` period, `toast` and `undoStack`. Components read with selectors (`useApp(s => s.x)`) and call actions via `useApp.getState().action()`.

**Persistence.** Every data change goes through `setData(fn)`, which treats data immutably (always return new objects). It diffs prev/next: workspace changes (everything except history) are saved as one record, debounced by 120 ms. History rows are put or deleted individually. `flushPersistence()` runs on `visibilitychange: hidden` and `pagehide`. The first launch of v16 migrates the legacy `localStorage` data and keeps a renamed `_migrated` copy as a safety net.

**Navigation.** `stack` is a list of routes. `push`, `back`, `goTab` and `openTable` manage it, and `navDir` drives the slide direction. `useBackButton` (`src/ui/hooks.ts`) maps the Android/browser back button to `store.back()` through a guard history entry. `back()` closes, in order: dialog → bill sheet → screen. Ask Agent is a normal route (`openAsk()` pushes `{ name: "ask" }`), so Back leaves the chat and returns to the screen it was opened from.

**Rendering gotcha.** Screens are wrapped in a transforming `motion.div` for transitions, and a transformed ancestor breaks `position: fixed`. That's why `BottomNav` is rendered in `App` (not inside screens) and the bill sheet is portaled to `document.body`. Keep new fixed-position layers outside the screen wrapper too.

**Ask Agent.** `engine.respond()` is pure and takes a `World` snapshot. It returns text, an optional card (bill/stats/list), and either `execute` (applied immediately; used for safe, undoable things like adding items) or `confirm` (clearing, moving, restoring, menu/settings edits wait for a Yes; payments execute immediately and are undoable). The executor checkpoints before every mutation, so Undo restores exactly. Context remembers the last table for 3 minutes ("and a water", "same for table 4"). Low-confidence matches always ask first. The agent **refuses to delete or reset sales records**; those need the human code-confirmation flow in Summary.

**Ask screen.** When opened from an order screen, `worldSnapshot()` looks below the `ask` route, so that table is the current table. Chat history (last 200 messages) is saved in Dexie `kv["chat"]` (`loadChat`/`saveChat` in `db.ts`, debounced in `main.tsx`) and restored with `useAgent.hydrate()`, which retires stale Yes/Undo buttons. It is not part of the full backup. This is disclosed in the Privacy Policy.

**Money model.** A sale is recorded when the bill is settled. `Txn.method` is missing for cash (all old records), or `gcash`/`maya`/`utang`. Utang sales count as sales on the day they were eaten. Their `payments[]` are money collected on the day paid. `lib/money.ts` turns this into per-period sales by method, collected utang, money received, expenses and profit (sales − expenses). Utang payments are applied oldest-first per customer (`allocateUtangPayment`). `Workspace.expenses` holds expenses. `MenuItem.soldOut` stores the business-day key it was marked, so it resets by itself the next day.

**Open bills.** `Split.openedAt` is set when the first item arrives (see `withItems` in appStore) and drives the wait timers. `OrderItem.served` counts served units, and `note` is a kitchen note. Lines only merge when name, price and note all match. Both are stripped or kept as appropriate when paid.

**Agent skill order** (in `respond`): pending follow-ups → multi-command split → help/small talk/how-to/tips → corrections ("no, table 4", "mami pala") → nav/theme/settings/export/menu → sold out → expenses → tables → utang → serving → notes → money → move/change/open/restore → queries → pay → split/clear/remove → swap → set qty → repeat → add (default). Follow-ups that need a confirmation return `{reply, ctx}` from `resume` (type `Resumed`) so the Yes button keeps working. `Plan` kind `batch` applies several plans as one undo step.

**Talk mode (v19).** `AiOrb.tsx` is a canvas orb with one rAF loop. It reads mic level (`onLevel`, Android only) and word pulses through refs, so nothing re-renders per frame, and its colours ease between phases. The loop is continuous: silence or recognizer hiccups simply re-listen (bounded retries for network/other errors), and it rests only after `IDLE_LIMIT_MS` (3 min) of no speech. Tapping the orb pauses, resumes or interrupts. `PAUSE_TO_SEND_MS` (1.2 s of silence after words) ends an utterance automatically in both Ask and Talk. Payments (`pay`, `payUtang`) execute without confirmation and are undoable. `{ kind: "undo", tableId }` calls `undoTable()`, which rolls back only that table's bill and sales from the newest snapshot that touched it, and patches later snapshots to match.

**Voice.** Captions: Ask shows the live words in the listening bar. Talk mode keeps a scrolling caption log (`lines`): your words appear live, and the assistant's reply is lit word by word from `onProgress` (`SpokenText`). `platform/voice.ts` uses the Web Speech API (en-PH, falls back to en-US). Chrome on Android needs internet for recognition (Google service); typing always works offline. Text-to-speech is optional (`settings.agent.voiceReplies`). Hands-free mode re-listens after each spoken reply. Talk mode (`TalkScreen`) is a dedicated loop that greets with `statusLine()` and the top tip, keeps the screen on (`keepScreenOn`), re-listens quietly twice on silence, then waits for a tap. It uses a Filipino TTS voice for Taglish replies when the phone has one. Everything said in Talk mode is also kept in the chat history.

**Android app (Capacitor).** The same `dist/` runs in a WebView from `https://localhost`. Its storage (IndexedDB) is separate from the PWA's Chrome storage, so users move data with Export all data → Import backup. Everything native lives in `src/platform/` behind `isNative()`, and plugins are loaded with `lazy(() => import(...))` so the PWA bundle doesn't run them. Never return a Capacitor plugin object from a promise: it's a proxy that answers `.then`. In the app:
- **voice** uses the app-local `Speech` plugin (`SpeechPlugin.java`). It emits `partial`/`final`/`error`/`end` events tagged with a session id, which gives live captions. Language is en-PH with `preferOffline` when offline, retried as en-US on a `language` error. If the recognizer errors after hearing something, the last partial is used. Replies use `@capacitor-community/text-to-speech` (fil-PH → en-PH → en-US), and its `onRangeStart` drives `speak(..., { onProgress })`. In the browser, `onboundary` drives it. Without word events, progress is estimated from elapsed time.
- **keepScreenOn** uses `@capacitor-community/keep-awake`.
- **files** writes to `Documents/Order Board` and opens the share sheet.
- **PDF reports** call the app-local `Print` plugin (`webView.createPrintDocumentAdapter`) instead of `window.print()`, which the WebView doesn't support.
- **haptics** uses `@capacitor/haptics`.
- **Back** uses `@capacitor/app` `backButton` (at the root it calls `minimizeApp()`).
- **System bar** icons follow the theme through `SystemBars.setStyle`. `main.tsx` flushes on Capacitor's `pause` event and skips the service worker.

`allowBackup` is off and `data_extraction_rules.xml` excludes everything, so sales data never goes to Google's cloud backup (matches the Privacy Policy). Icons are rendered from `public/logo.svg` (adaptive foreground/background plus monochrome). If the logo changes, regenerate every `mipmap-*` PNG.

**PWA / updates.** Workbox precaches the build. `registerType: "autoUpdate"` activates new versions and reloads. The SW filename stays `sw.js`, so phones still running the legacy app pick up v16 as a normal SW update. `main.tsx` deletes the legacy `order-board-vNN` caches.

## Invariants: do not break these

1. **Data compatibility.** `Txn`, `Split`, `OrderItem`, `TableDef`, `MenuCategory` field names match the v1–v15 format, so old backups import without conversion. Add new fields as **optional**. Add new settings in `types.ts`, `defaults.ts` **and** `cleanSettings()` in `migrate.ts`. Anything read from storage or a file passes through `normalizeAppData()`.
2. **Offline-first.** No runtime network calls, CDNs, web fonts, analytics or remote APIs. Everything needed to take an order ships in the precache. The only network use is the browser's own speech recognition, which is disclosed in the Privacy Policy.
3. **Never lose sales.** Destructive actions on sales history (Delete Order, Reset Today) require typing a random 4-character code. Restoring a backup replaces everything and must be confirmed. The agent may never delete or reset history. Prefer Undo over "Are you sure?" for small actions.
4. **Business-day logic** goes through `businessDay.ts`, keyed by settings `workStart`/`workEnd`.
5. **Engine purity.** `engine.respond()` must not touch the store. New agent abilities = a new `Plan` kind in `types.ts` + its handler in `executor.ts` + tests in `engine.test.ts`.
6. **`base: "./"`** and relative asset paths, so the build works on GitHub Pages subpaths and in the Capacitor WebView.
8. **Android signing key and `appId`** never change (see CI above). Every Android release needs a higher `package.json` version, because `versionCode` comes from it (19.0.0 → 190000).
7. **Legal text changes** require bumping `LEGAL_VERSION` (users re-accept via the welcome gate).

## Adding things (recipes)

- **New dialog:** add a variant to `Dialog` in `appStore.ts`, a component plus a `case` in `src/ui/Dialogs.tsx`, and open it with `openDialog({...})`.
- **New screen:** add to `Route` in `appStore.ts`, a `case` in `App.tsx` `Screen` and `routeKey`, then navigate with `push({ name })`. Use `screen no-nav` and `<TopBar title><BackButton/></TopBar>` for sub-screens.
- **New setting:** see invariant 1, then add UI in `SettingsScreen.tsx`.
- **Bisaya (Cebuano)** is supported for *taking orders only* (v19): numbers usa/duha/tulo/upat/unom/napulo, the `ka` linker after numbers (also glued, as in "duhaka"), og/ug = and, (nga) naay = with, kan-on = rice, buok = pieces, dugang(i) = add, "usa pa ka X" = 1 X. These live in `TOKEN_SYNONYMS`/`PHRASE_SYNONYMS`. Replies stay English/Taglish. Tests are under "Bisaya orders" in `engine.test.ts`.
- **New agent phrase or mishearing:** first try `TOKEN_SYNONYMS` / `PHRASE_SYNONYMS` in `agent/text.ts` or menu item aliases. Always add a test.
- **Styling:** use tokens (`--shell-*` for app chrome, `--paper`/`--ink` for cards, sheets and dialogs, `--chili` actions, `--accent-gold` labels/prices, `--leaf` money in). Check both themes. Mobile-first: 16px gutters, 44px+ tap targets, no horizontal scroll.

## Testing

- `src/agent/*.test.ts`: agent language understanding and execution (most regressions show up here).
- `src/data/db.test.ts`: legacy → IndexedDB migration, backup round-trip, store write-through (fake-indexeddb).
- `src/App.test.tsx`: full UI flows in jsdom (order → pay → undo, splits, custom items, tables, summary restore/delete/reset, settings, menu editor, Android back, agent panel). It sets `MotionGlobalConfig.skipAnimations` and disables persistence. Expect harmless "not wrapped in act" warnings from motion's internal exit bookkeeping.

Run `pnpm test && pnpm typecheck` before declaring anything done.

## Before publishing (open items)

- [ ] `src/legal/content.ts`: set real `PUBLISHER` and `CONTACT_EMAIL` (currently `support@example.com`), have the text reviewed, and host the Privacy Policy at a public URL (needed for a Play Store listing).
- [x] v16 merged to `main` (PR #1).
- [x] Pages source set to "GitHub Actions" (2026-11-08); every push to `main` now deploys.
- [ ] Talk mode on a real phone: check speech recognition in a noisy stall, the Filipino TTS voice, and that the screen stays on.
- [ ] Test on the actual phone: install over the existing v15 PWA and confirm data migrates, offline works, the update reloads, and the Ask chat survives an app restart.
- [x] Capacitor Android app (v19): adapters swapped in `src/platform/`, APK built and signed by CI.
- [ ] Android app on the real phone: install, import the PWA backup, then check voice (online and offline), Talk mode keep-awake, backup/CSV save + share, PDF via print, back button, status bar in both themes, and the app icon.
- [ ] Optional: Play Store. Needs a $25 developer account, an AAB (`bundleRelease`), a public privacy-policy URL, the real contact email, and (for new personal accounts) a 12-tester, 14-day closed test.
- [ ] Optional: bundle size (~495 KB JS, ~163 KB gzip, mostly React + motion) could shrink with `LazyMotion`. It's fine for a precached PWA.
