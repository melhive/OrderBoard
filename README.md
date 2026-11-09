<p align="center">
  <img src="public/logo.svg" width="96" alt="Order Board logo">
</p>

<h1 align="center">Order Board</h1>

<p align="center"><b>Take orders. Settle bills. Know your sales. Offline.</b></p>

Order Board is an order-taking and sales app for small food stalls (made for a Filipino street-food stall selling pares, mami, pastil and siomai). It runs on one Android phone while you serve customers, late at night, **with no internet needed**. It comes as a native **Android app** (APK) and as a **web app** (PWA) that installs from the browser. Your sales stay on your phone.

## Highlights

- **Tables and split bills.** Tap a table, tap menu items, and the bill updates. Add takeout or custom tables, split a bill, add notes like "walang sibuyas", mark items served, and watch wait timers.
- **Settle in seconds.** Enter the cash and see the change. Pay with **Cash, GCash or Maya**, or put it on **utang** and collect later. Every mistake can be undone.
- **Sales at a glance.** Today, week, month or any date range, with best sellers, profit (sales minus expenses), and CSV or PDF reports with your business name on them.
- **Business day that fits a night stall.** A 1 AM sale counts toward the evening it belongs to.
- **Ask Agent.** Type or say *"2 pares with egg and rice for table 3"*, *"table 1 paid 500"*, *"magkano benta natin today?"*. It understands English, Taglish and Bisaya orders, and runs **fully on the phone**: no AI service, no account.
- **Talk mode.** A hands-free voice conversation with a glowing orb. It listens, answers out loud, and keeps the screen on.
- **Your data stays yours.** No account, no ads, no tracking, no cloud. Back up to a file whenever you want, and the app reminds you after a week.

## Download

**On your Android phone, open:**

### 👉 https://github.com/melhive/OrderBoard/releases/latest/download/OrderBoard.apk

Tap the downloaded file and choose **Install**. The first time, Android asks you to allow "Install unknown apps" for your browser.

- This link always gives the **newest version**, so you can share it with anyone.
- Updates install **over** the old version and keep your sales, tables and menu. **Never uninstall to update**, because uninstalling deletes your data.
- In the app, Settings → About → **Latest Android app** opens the same link.
- All versions: https://github.com/melhive/OrderBoard/releases

**No Android?** Use the web app in any phone browser and add it to your home screen. It works offline too:
**https://melhive.github.io/OrderBoard/**

**Moving from the web app to the Android app:** in the web app, go to Settings → **Export all data**. In the Android app, go to Settings → **Import backup**.

## Documentation

| Document | Contents |
|---|---|
| [ASK_AGENT.md](docs/ASK_AGENT.md) | What you can say to Ask Agent and Talk mode, in English, Taglish and Bisaya |
| [BUILDING.md](docs/BUILDING.md) | Installing the APK, how releases and test builds are made, signing, local development |
| [AGENTS.md](AGENTS.md) | Architecture: how the app works, source map, data model, invariants, recipes |
| [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) | Current state, test results, what still needs testing on a phone |
| [What's new](src/data/changelog.ts) | The changelog shown in the app (also the release notes) |

## Project layout

```
OrderBoard/
├── src/
│   ├── screens/     Tables, Order, Summary, Utang, Settings, Menu editor, About/legal
│   ├── agent/       Ask Agent: offline language engine, executor, persona, chat + Talk mode (+ tests)
│   ├── store/       app state (Zustand), undo, exports
│   ├── data/        data model, IndexedDB storage, backup migration, changelog (+ tests)
│   ├── lib/         bills, business day, money (utang, GCash/Maya, profit), formatting
│   ├── platform/    browser vs Android-app adapters: voice, files, print, haptics (+ tests)
│   ├── reports/     CSV and printable PDF reports
│   └── ui/          shared components, dialogs, icons
├── android/         Capacitor Android project (Speech and Print plugins, icons)
├── public/          app icons and logo
├── docs/            documentation
├── scripts/         release-notes.mjs
└── .github/workflows/  deploy.yml (tests + web app), android.yml (APK + releases)
```

React 18, TypeScript, Vite, Zustand, Dexie (IndexedDB), motion, Workbox (offline web app), Capacitor 8 (Android app), Vitest.

## Status

Actively developed and used every night at the stall. **v19** adds the Android app. The web app is live, and every change runs the full test suite in CI before it ships. See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for what's verified on a real phone and what still needs checking.

## Releases

Every merge to `main` publishes a signed APK as the **Latest** release, with the changes listed, and updates the web app. Older versions stay on the [Releases](https://github.com/melhive/OrderBoard/releases) page, each with its changes. Test builds of open pull requests are published as the **preview** pre-release.
