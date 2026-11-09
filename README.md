<p align="center">
  <img src="public/logo.svg" width="96" alt="Order Board logo">
</p>

<h1 align="center">Order Board</h1>

<p align="center"><b>Take orders. Settle bills. Know your sales. Offline.</b></p>

Order Board is an order-taking and sales app for small food stalls (made for a Filipino street-food stall selling pares, mami, pastil and siomai). It runs on one Android phone while you serve customers, late at night, **with no internet needed**. Your sales stay on your phone.

## Download

**On your Android phone, open:**

### 👉 https://github.com/melhive/OrderBoard/releases/latest/download/OrderBoard.apk

Tap the downloaded file and choose **Install**. The first time, Android asks you to allow "Install unknown apps" for your browser.

- This link always gives the **newest version**, so you can share it with anyone.
- Updates install **over** the old version and keep your sales, tables and menu. **Never uninstall to update**, because uninstalling deletes your data.
- All versions and what changed: [Releases](https://github.com/melhive/OrderBoard/releases)

**No Android?** Use the web app in any phone browser and add it to your home screen. It works offline too:
**https://melhive.github.io/OrderBoard/**

**Moving from the web app to the Android app:** in the web app, go to Settings → **Export all data**. In the Android app, go to Settings → **Import backup**.

## Highlights

- **Tables and split bills.** Tap a table, tap menu items, and the bill updates. Add takeout or custom tables, split a bill, add notes like "walang sibuyas", mark items served, and watch wait timers.
- **Settle in seconds.** Enter the cash and see the change. Pay with **Cash, GCash or Maya**, or put it on **utang** and collect later. Every mistake can be undone.
- **Sales at a glance.** Today, week, month or any date range, with best sellers, profit (sales minus expenses), and CSV or PDF reports with your business name on them.
- **Business day that fits a night stall.** A 1 AM sale counts toward the evening it belongs to.
- **Ask Agent.** Type or say *"2 pares with egg and rice for table 3"*, *"table 1 paid 500"*, *"magkano benta natin today?"*. It understands English, Taglish and Bisaya orders, and runs **fully on the phone**: no AI service and no account.
- **Talk mode.** A hands-free voice conversation with a glowing orb. It listens, answers out loud, and keeps the screen on.
- **Your data stays yours.** No account, no ads, no tracking, no cloud. Back up to a file whenever you want, and the app reminds you after a week.

## Your data and privacy

Everything is stored on your phone. The app makes no network calls. The only exception is voice recognition: the phone's speech service may use the internet unless an offline speech pack is installed. Typing always works offline. See the Privacy Policy in the app (Settings → About).

## For developers

React 18, TypeScript, Vite, Zustand, Dexie (IndexedDB), and Capacitor for the Android app.

```sh
pnpm install
pnpm dev        # dev server
pnpm test       # tests (agent, storage, full UI in jsdom)
pnpm build      # production build to dist/
```

| Document | Contents |
|---|---|
| [AGENTS.md](AGENTS.md) | How the app works, source map, invariants, recipes |
| [What's new](src/data/changelog.ts) | The changelog shown in the app |

**Releases:** every push to `main` deploys the web app to GitHub Pages and publishes a signed APK as the latest release, named `OrderBoard.apk`. Each pull request also updates the **preview** test build: [OrderBoard-preview.apk](https://github.com/melhive/OrderBoard/releases/download/preview/OrderBoard-preview.apk). Bump `version` in `package.json` for every Android release, because Android only updates to a higher version.
