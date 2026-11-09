// Single source of truth for the app version shown in the UI.
export const APP_VERSION = `v${__APP_VERSION__.split(".")[0]}`;

/** Always the newest signed Android app (GitHub's "latest release" link; see .github/workflows/android.yml). */
export const APP_DOWNLOAD_URL = "https://github.com/melhive/OrderBoard/releases/latest/download/OrderBoard.apk";

export const CHANGELOG: { version: string; changes: string[] }[] = [
  { version: "v19", changes: [
    "Order Board is now also a real Android app (APK): everything is built in, so it works offline from the first open",
    "In the Android app, voice uses the phone’s own speech recognition — it can work without internet if the phone has Google’s offline speech pack — and replies are read aloud by the phone’s voice",
    "Android app: backups and CSV reports are saved in Documents/Order Board and can be shared; PDF reports open Android’s print screen (choose “Save as PDF”)",
    "Ask Agent takes orders in Bisaya too: “isa ka pares with egg og duha ka mami”, “usa ka pastil ug softdrinks sa table 3”, “dugangi og usa ka mami” (replies stay in English/Taglish)",
    "Ask Agent talks more like a person: it says things differently every time, answers in your language, celebrates the first sale and milestones, notices when you pass yesterday’s sales, and remembers your name (“ako si …”)",
    "More small talk: greetings (also in Bisaya), how it’s going tonight, tired, hungry, busy or slow nights, closing up with a summary, and jokes that don’t repeat",
    "Talk mode is a real conversation now: a glowing AI orb listens and moves with your voice, pulses as it answers, and keeps listening — no need to tap again. Captions under the orb show what you said, what it said, and the bill it changed",
    "Voice sends by itself when you pause — in the chat and in Talk mode",
    "Payments happen right away, without a “Yes” step (say “table 4 paid gcash”); say “undo table 4” to take back only that table’s last change, even a payment",
    "“Cancel pares” finds the table that has pares; “utang table 2 Juan” works; “add menu item kwek kwek 20” works",
    "The assistant speaks a little slower, so it’s easier to follow",
    "Live captions: what you say appears as you talk (in the chat box and in Talk mode), and in Talk mode the assistant’s reply lights up word by word as it’s read aloud",
    "Smoother voice animations in Ask and Talk mode — no more tilted mic, flashing spinner or jumpy rings",
    "Moving from the web version: use Settings → Export all data there, then use Import backup in the app",
  ]},
  { version: "v18", changes: [
    "Talk mode — a hands-free voice conversation with Ask Agent: it listens, answers out loud and listens again; say “yes” or “oo” to confirm",
    "Ask Agent knows the whole app: ask “paano mag-backup?” or “how do I split a bill?” and get the answer with a button that takes you there",
    "Ask Agent chats casually in English or Taglish, fixes mistakes (“no, table 4”, “mami pala”), handles several orders in one sentence, and gives tips (long waits, sold-out items, old utang)",
    "Utang: put a bill on a customer’s tab, record payments later, and see who owes what",
    "Pay with Cash, GCash or Maya — Summary shows the money by method",
    "Expenses and profit: record what you spend; Summary shows profit (sales minus expenses), and reports include it",
    "Sold out: long-press a menu item (or say “ubos na ang pastil”); it’s back automatically the next day",
    "Item notes like “walang sibuyas” or “extra sabaw” — tap an item on the bill",
    "Served check marks and wait timers: tables show how long they’ve been open and turn red when food is late",
    "Backup reminder when your last backup is over a week old",
    "The startup screen now shows the same logo as the app icon, with no flicker",
  ]},
  { version: "v17", changes: [
    "Fresh new look across the whole app, with a new logo and app icon",
    "Ask Agent is now a full chat screen: scroll back through earlier messages, jump to the latest, and pick up where you left off — your chat is saved on this phone (clear it any time)",
    "Ask Agent is smarter: Taglish (“dalawang pares”, “magkano table 1”, “bayad”, “sukli”), move a table's order to another table, work out change before paying, compare days, busiest hour and average order",
    "Ask from a table and it already knows which table you mean; tap Open on a bill to jump to that table",
    "Order screen: category shortcuts, a search box and a Custom item button that's always visible, plus a bill bar that slides up when you need it",
    "Opening tables is smoother — no more flicker",
    "Settings reorganized into clear groups",
  ]},
  { version: "v16", changes: [
    "Rebuilt from the ground up with a new professional design, smooth screen transitions and animations",
    "Ask Agent — type or say orders like “2 pares with egg and rice for table 3” and they're logged instantly, fully offline",
    "Ask Agent also answers questions (“how much did we sell today?”, “what's on table 2?”) and can pay, split, navigate and edit the menu",
    "Push-to-talk voice ordering, with optional spoken replies and hands-free mode",
    "Android back button now closes dialogs and goes back a screen",
    "Menu items can have alternate names to help the agent recognize them",
    "Sales data now stored in the device database, built to hold years of history",
    "Privacy Policy, Terms of Use and an About screen",
  ]},
  { version: "v15", changes: [
    "Delete Order — permanently void a mistaken payment from a transaction's expanded view, separate from Restore, with the same random-code confirmation as Reset Today",
  ]},
  { version: "v14", changes: [
    "Multi-day reports are now drill-down — tap any day in a date range to see its actual transactions and items, not just the day's total",
  ]},
  { version: "v13", changes: [
    "Set your actual working hours so late-night sales (past midnight) count as the same business day everywhere — Today's total, Reset, and reports",
    "Pick a date range (not just one day) to view or export combined sales across several days",
    "Settings now shows a version history — this screen",
  ]},
  { version: "v12", changes: [
    "Undo an accidental Paid tap — expand a transaction to restore it back to its table",
    "Pick and export any specific past day's sales",
    "Reset Today now requires typing a random confirmation code, so it can't be tapped by accident",
  ]},
  { version: "v11", changes: [
    "New Settings screen (gear icon) consolidating theme, business name, menu editing, and backup",
    "Fixed invisible text and buttons in dark mode",
    "Business name now shows as a subtitle, keeping “Order Board” as the app's own name",
  ]},
  { version: "v10", changes: [
    "Weekly, Monthly, and All-Time sales analytics with a day-by-day breakdown",
    "Fully editable menu — rename, reprice, add, delete, and drag to reorder categories and items",
    "Full data backup and restore",
  ]},
  { version: "v9", changes: [
    "Paid button now flashes to confirm before returning to Tables",
    "The table you just paid off gets a soft settle animation on the Tables screen",
  ]},
  { version: "v8", changes: ["Reliable background auto-updates when the app is hosted online"] },
  { version: "v7", changes: ["Split bills — separate, individually payable checks at the same table"] },
  { version: "v6", changes: ["Cash Received field with automatic change calculation"] },
  { version: "v5", changes: ["Custom tables you can add and remove", "Light and dark theme"] },
  { version: "v4", changes: ["Installable home-screen app icon", "Offline support once installed"] },
  { version: "v3", changes: ["Professional letterhead-style PDF sales report export"] },
  { version: "v2", changes: ["CSV export of daily sales"] },
  { version: "v1", changes: ["Original release — table-by-table ordering, running bills, Paid and Clear actions"] },
];
