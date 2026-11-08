# AGENTS.md — Order Board

Read this first. It tells you what this app is, how it is built, and the rules that keep it from breaking for the people who use it every night.

## What this app is

**Order Board** is an offline order-taking and sales-tracking app for a small Filipino street-food stall that sells pares, mami, pastil and siomai. One person runs it on an Android phone, installed as a PWA from Chrome, while serving customers, often late at night and without a reliable internet connection.

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
- **v16** (this codebase, branch `feature/react-rebuild`): React + TypeScript rebuild. Same features, a new design, IndexedDB storage, Ask Agent, voice, Android back button, legal screens.
- The version shown in the app is the **major** of `package.json` `version` (`16.0.0` → "v16"). When you ship user-visible changes, bump it and add an entry at the top of `CHANGELOG` in `src/data/changelog.ts`.

## Stack and commands

React 18, TypeScript (strict), Vite 6, Zustand 5 (state), Dexie 4 (IndexedDB), motion 12 (`motion/react`, animations), vite-plugin-pwa (Workbox service worker), Vitest + jsdom + fake-indexeddb (tests). Package manager: **pnpm** (`.npmrc` uses a hoisted node-linker).

```sh
pnpm install
pnpm dev          # dev server (service worker disabled in dev)
pnpm test         # vitest: engine, matcher, persistence, full-UI tests
pnpm typecheck    # tsc -b
pnpm build        # typecheck + production build to dist/
pnpm preview      # serve dist/ (service worker active) — use to test offline/PWA
```

CI (`.github/workflows/deploy.yml`): on every push and PR it runs install, test and build. On `main` it also deploys `dist/` to **GitHub Pages**. The repo's Pages source must be set to "GitHub Actions".

There is no browser in the agent sandbox. UI behaviour is verified by `src/App.test.tsx`, which renders the real `<App/>` in jsdom and clicks through it. Visual and layout checks need a real phone or browser (`pnpm dev`, then open on the phone over LAN, or use Chrome devtools device mode).

## Source map

```
index.html                 Vite entry (root #root, theme-color metas)
vite.config.ts             base "./", PWA manifest + Workbox, vitest config
public/                    icons (copied as-is)
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
  format.ts                peso(), times, dates, plural, verify codes
src/store/
  appStore.ts              Zustand store: data + UI state + all actions; persistence plumbing; undo stack
  exports.ts               CSV/PDF report export, full-backup export
src/reports/reports.ts     CSV builder + printable letterhead HTML
src/platform/              adapters to swap for Capacitor later: files.ts, haptics.ts, voice.ts
src/agent/
  engine.ts                respond(input, world, ctx) → reply (PURE; never mutates)
  menuMatch.ts, text.ts    tokenizing, number words, fuzzy/phonetic menu matching, mishearing synonyms
  executor.ts              applies a Plan to the store (checkpoint first → undoable)
  agentStore.ts            chat messages + conversation context
  AgentPanel.tsx           chat UI, voice push-to-talk, confirmation/undo buttons, FAB
src/screens/               Tables, Order, Summary, Settings, MenuEditor, InfoScreens (changelog/about/legal/welcome)
src/ui/                    components (TopBar, BottomNav, Switch, Segmented, Toast), Dialogs, Icons, hooks
src/legal/content.ts       Privacy Policy + Terms text, LEGAL_VERSION
legacy/                    v15 single-file app (reference only)
```

## How it works

**State.** One Zustand store (`useApp`) holds `data: AppData` (persisted) plus UI state: the route `stack`, `dialog`, `sheetOpen`, `agentOpen`, `activeSplit`, `cashInput`, `summary` period, `toast` and `undoStack`. Components read with selectors (`useApp(s => s.x)`) and call actions via `useApp.getState().action()`.

**Persistence.** Every data change goes through `setData(fn)`, which treats data immutably (always return new objects). It diffs prev/next: workspace changes (everything except history) are saved as one record, debounced by 120 ms. History rows are put or deleted individually. `flushPersistence()` runs on `visibilitychange: hidden` and `pagehide`. The first launch of v16 migrates the legacy `localStorage` data and keeps a renamed `_migrated` copy as a safety net.

**Navigation.** `stack` is a list of routes. `push`, `back`, `goTab` and `openTable` manage it, and `navDir` drives the slide direction. `useBackButton` (`src/ui/hooks.ts`) maps the Android/browser back button to `store.back()` through a guard history entry. `back()` closes, in order: dialog → agent panel → bill sheet → screen.

**Rendering gotcha.** Screens are wrapped in a transforming `motion.div` for transitions, and a transformed ancestor breaks `position: fixed`. That's why `BottomNav` is rendered in `App` (not inside screens) and the bill sheet is portaled to `document.body`. Keep new fixed-position layers outside the screen wrapper too.

**Ask Agent.** `engine.respond()` is pure and takes a `World` snapshot. It returns text, an optional card (bill/stats/list), and either `execute` (applied immediately; used for safe, undoable things like adding items) or `confirm` (payments, clearing, menu/settings edits wait for a Yes). The executor checkpoints before every mutation, so Undo restores exactly. Context remembers the last table for 3 minutes ("and a water", "same for table 4"). Low-confidence matches always ask first. The agent **refuses to delete or reset sales records**; those need the human code-confirmation flow in Summary.

**Voice.** `platform/voice.ts` uses the Web Speech API (en-PH, falls back to en-US). Chrome on Android needs internet for recognition (Google service); typing always works offline. Text-to-speech is optional (`settings.agent.voiceReplies`). Hands-free mode re-listens after each spoken reply.

**PWA / updates.** Workbox precaches the build. `registerType: "autoUpdate"` activates new versions and reloads. The SW filename stays `sw.js`, so phones still running the legacy app pick up v16 as a normal SW update. `main.tsx` deletes the legacy `order-board-vNN` caches.

## Invariants: do not break these

1. **Data compatibility.** `Txn`, `Split`, `OrderItem`, `TableDef`, `MenuCategory` field names match the v1–v15 format, so old backups import without conversion. Add new fields as **optional**. Add new settings in `types.ts`, `defaults.ts` **and** `cleanSettings()` in `migrate.ts`. Anything read from storage or a file passes through `normalizeAppData()`.
2. **Offline-first.** No runtime network calls, CDNs, web fonts, analytics or remote APIs. Everything needed to take an order ships in the precache. The only network use is the browser's own speech recognition, which is disclosed in the Privacy Policy.
3. **Never lose sales.** Destructive actions on sales history (Delete Order, Reset Today) require typing a random 4-character code. Restoring a backup replaces everything and must be confirmed. The agent may never delete or reset history. Prefer Undo over "Are you sure?" for small actions.
4. **Business-day logic** goes through `businessDay.ts`, keyed by settings `workStart`/`workEnd`.
5. **Engine purity.** `engine.respond()` must not touch the store. New agent abilities = a new `Plan` kind in `types.ts` + its handler in `executor.ts` + tests in `engine.test.ts`.
6. **`base: "./"`** and relative asset paths, so the build works on GitHub Pages subpaths and in a future Capacitor WebView.
7. **Legal text changes** require bumping `LEGAL_VERSION` (users re-accept via the welcome gate).

## Adding things (recipes)

- **New dialog:** add a variant to `Dialog` in `appStore.ts`, a component plus a `case` in `src/ui/Dialogs.tsx`, and open it with `openDialog({...})`.
- **New screen:** add to `Route` in `appStore.ts`, a `case` in `App.tsx` `Screen` and `routeKey`, then navigate with `push({ name })`. Use `screen no-nav` and `<TopBar title><BackButton/></TopBar>` for sub-screens.
- **New setting:** see invariant 1, then add UI in `SettingsScreen.tsx`.
- **New agent phrase or mishearing:** first try `TOKEN_SYNONYMS` / `PHRASE_SYNONYMS` in `agent/text.ts` or menu item aliases. Always add a test.
- **Styling:** use tokens (`--shell-*` for app chrome, `--paper`/`--ink` for cards, sheets and dialogs, `--chili` actions, `--accent-gold` labels/prices, `--leaf` money in). Check both themes. Mobile-first: 16px gutters, 44px+ tap targets, no horizontal scroll.

## Testing

- `src/agent/*.test.ts`: agent language understanding and execution (most regressions show up here).
- `src/data/db.test.ts`: legacy → IndexedDB migration, backup round-trip, store write-through (fake-indexeddb).
- `src/App.test.tsx`: full UI flows in jsdom (order → pay → undo, splits, custom items, tables, summary restore/delete/reset, settings, menu editor, Android back, agent panel). It sets `MotionGlobalConfig.skipAnimations` and disables persistence. Expect harmless "not wrapped in act" warnings from motion's internal exit bookkeeping.

Run `pnpm test && pnpm typecheck` before declaring anything done.

## Before publishing (open items)

- [ ] `src/legal/content.ts`: set real `PUBLISHER` and `CONTACT_EMAIL` (currently `support@example.com`), have the text reviewed, and host the Privacy Policy at a public URL (needed for a Play Store listing).
- [ ] Merge `feature/react-rebuild` → `main` to deploy. Before that, test on the actual phone: install over the existing v15 PWA and confirm data migrates, offline works, and the update reloads.
- [ ] Optional: Play Store via Capacitor. Swap the adapters in `src/platform/` (files → @capacitor/filesystem + share, haptics → @capacitor/haptics, voice → @capacitor-community/speech-recognition + text-to-speech, because the Android WebView has no SpeechRecognition). Nothing outside `platform/` should need to change.
- [ ] Optional: bundle size (~495 KB JS, ~163 KB gzip, mostly React + motion) could shrink with `LazyMotion`. It's fine for a precached PWA.
