// Single source of truth for the app version shown in the UI.
export const APP_VERSION = `v${__APP_VERSION__.split(".")[0]}`;

export const CHANGELOG: { version: string; changes: string[] }[] = [
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
