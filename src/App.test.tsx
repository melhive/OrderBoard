// @vitest-environment jsdom
// End-to-end UI tests: render the real <App/> in jsdom and drive it the way
// a user would (clicks, typing, Android back). Persistence is disabled; the
// IndexedDB layer has its own tests in data/db.test.ts.

import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { freshData } from "./data/defaults";
import { LEGAL_VERSION } from "./legal/content";
import { setPersistenceEnabled, useApp } from "./store/appStore";
import { useAgent } from "./agent/agentStore";
import { quickCashOptions } from "./screens/OrderScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setPersistenceEnabled(false);
MotionGlobalConfig.skipAnimations = true;

let root: Root;
let host: HTMLDivElement;

beforeAll(() => {
  window.matchMedia ??= ((q: string) =>
    ({ matches: q.includes("dark"), media: q, addEventListener() {}, removeEventListener() {}, onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList);
  window.scrollTo = () => {};
  Element.prototype.scrollTo = function () {};
  navigator.vibrate = () => true;
});

function start(opts: { accepted?: boolean } = {}) {
  const data = freshData();
  if (opts.accepted !== false) data.settings.acceptedLegalVersion = LEGAL_VERSION;
  useApp.setState({
    data,
    ready: true,
    stack: [{ name: "tables" }],
    dialog: null,
    sheetOpen: false,
    activeSplit: 0,
    cashInput: "",
    undoStack: [],
    toast: null,
    summary: { period: "today", from: null, to: null },
    expandedTxnId: null,
    expandedDayKey: null,
  });
  useAgent.getState().reset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<App />));
}

afterEach(async () => {
  await wait(20); // let exit animations settle inside act()
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const text = () => document.body.textContent ?? "";
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

function byLabel(label: string | RegExp): HTMLElement {
  const els = [...document.querySelectorAll<HTMLElement>("[aria-label]")].filter((e) => {
    const l = e.getAttribute("aria-label")!;
    return typeof label === "string" ? l === label : label.test(l);
  });
  if (!els.length) throw new Error(`No element labelled ${label}`);
  return els[0]!;
}

function button(name: string | RegExp): HTMLButtonElement {
  const all = [...document.querySelectorAll<HTMLButtonElement>("button")];
  const found = all.find((b) => {
    const t = (b.getAttribute("aria-label") ?? b.textContent ?? "").trim();
    return typeof name === "string" ? t === name || b.textContent?.trim() === name : name.test(t) || name.test(b.textContent ?? "");
  });
  if (!found) throw new Error(`No button ${name}. Buttons: ${all.map((b) => b.getAttribute("aria-label") ?? b.textContent).join(" | ")}`);
  return found;
}

function click(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submitForm(el: HTMLElement) {
  act(() => {
    el.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("first launch", () => {
  beforeEach(() => start({ accepted: false }));

  it("asks to accept the terms, then shows the tables", () => {
    expect(text()).toContain("Welcome to Order Board");
    click(button(/Agree and continue/));
    expect(useApp.getState().data.settings.acceptedLegalVersion).toBe(LEGAL_VERSION);
    expect(text()).not.toContain("Welcome to Order Board");
    expect(byLabel("Table 1, empty")).toBeTruthy();
    expect(text()).toContain("Available");
  });

  it("can open the Privacy Policy from the welcome screen and come back", async () => {
    click(button("Privacy Policy"));
    await wait(20);
    expect(text()).toContain("Information stored on your device");
    expect(text()).not.toContain("Welcome to Order Board");
    click(byLabel("Back to Back"));
    await wait(20);
    expect(text()).toContain("Welcome to Order Board");
  });
});

describe("taking and settling an order", () => {
  beforeEach(() => start());

  it("adds items, computes change, records the sale and returns to tables", async () => {
    click(byLabel("Table 1, empty"));
    expect(text()).toContain("0 items");
    click(byLabel(/^Add Pares, ₱60/));
    click(byLabel(/^Add Pares, ₱60/));
    click(byLabel(/^Add Siomai, ₱25/));
    const bill = useApp.getState().data.tables["1"]![0]!.items;
    expect(bill).toEqual([
      { name: "Pares", price: 60, qty: 2 },
      { name: "Siomai", price: 25, qty: 1 },
    ]);
    expect(byLabel(/^Add Pares, ₱60, 2 on bill/)).toBeTruthy();

    click(byLabel("View bill"));
    type(byLabel("Cash received") as HTMLInputElement, "200");
    expect(document.querySelector(".change")!.textContent).toBe("Change₱55");
    type(byLabel("Cash received") as HTMLInputElement, "100");
    expect(document.querySelector(".change")!.textContent).toBe("Short₱45");
    type(byLabel("Cash received") as HTMLInputElement, "500");

    click(button(/Paid ₱145/));
    await wait(450);
    const s = useApp.getState();
    expect(s.data.history).toHaveLength(1);
    expect(s.data.history[0]).toMatchObject({ table: 1, total: 145, cash: 500 });
    expect(s.stack).toEqual([{ name: "tables" }]);
    expect(text()).toContain("Table 1 paid ₱145 · change ₱355");
    expect(document.querySelector(".today-card")!.textContent).toContain("₱145Sales today");

    // Undo from the toast puts the bill back.
    click(button("Undo"));
    expect(useApp.getState().data.history).toHaveLength(0);
    expect(useApp.getState().data.tables["1"]![0]!.items).toHaveLength(2);
  });

  it("removes a line with the stepper and clears with confirmation", () => {
    click(byLabel("Table 2, empty"));
    click(byLabel(/^Add Water/));
    click(byLabel("View bill"));
    click(byLabel("Remove one Water"));
    expect(useApp.getState().data.tables["2"]![0]!.items).toEqual([]);
    click(byLabel(/^Add Mami, ₱50/));
    click(button("Clear"));
    expect(text()).toContain("Clear Table 2?");
    click(document.querySelector<HTMLButtonElement>(".modal-card .btn-primary")!);
    expect(useApp.getState().data.tables["2"]![0]!.items).toEqual([]);
    expect(text()).toContain("Table 2 cleared");
  });

  it("supports split bills paid separately", async () => {
    click(byLabel("Table 3, empty"));
    click(byLabel(/^Add Pares, ₱60/));
    click(byLabel("Add a separate bill"));
    expect(useApp.getState().activeSplit).toBe(1);
    click(byLabel(/^Add Water/));
    click(byLabel("View bill"));
    click(button(/Paid ₱20/));
    await wait(450);
    const d = useApp.getState().data;
    expect(d.history.map((h) => h.total)).toEqual([20]);
    expect(d.tables["3"]).toEqual([{ items: [{ name: "Pares", price: 60, qty: 1 }], openedAt: expect.any(String) }]);
    // Still on the order screen because a bill remains.
    expect(useApp.getState().stack.at(-1)).toEqual({ name: "order", tableId: 3 });
  });

  it("adds a custom item", () => {
    click(byLabel("Table 4, empty"));
    click(byLabel("Add custom item"));
    type(document.getElementById("ci-name") as HTMLInputElement, "Extra sauce");
    type(document.getElementById("ci-price") as HTMLInputElement, "10");
    submitForm(document.getElementById("ci-name")!);
    expect(useApp.getState().data.tables["4"]![0]!.items).toEqual([{ name: "Extra sauce", price: 10, qty: 1 }]);
  });

  it("filters the menu with search", () => {
    click(byLabel("Table 1, empty"));
    type(byLabel("Search menu") as HTMLInputElement, "soda");
    const tiles = [...document.querySelectorAll(".mtile")].map((t) => t.querySelector(".name")!.textContent);
    expect(tiles).toEqual(["Softdrinks"]);
  });
});

describe("tables", () => {
  beforeEach(() => start());

  it("adds and removes a custom table", () => {
    click(button(/Add table/));
    type(document.getElementById("at-name") as HTMLInputElement, "Takeout");
    submitForm(document.getElementById("at-name")!);
    expect(text()).toContain("Takeout");
    click(byLabel("Remove Takeout"));
    click(button("Remove"));
    expect(useApp.getState().data.tableList.map((t) => t.name)).toEqual(["1", "2", "3", "4"]);
  });

  it("rejects a duplicate table name", () => {
    click(button(/Add table/));
    type(document.getElementById("at-name") as HTMLInputElement, "1");
    expect(text()).toContain("already a table with that name");
    expect(button("Add").disabled).toBe(true);
  });
});

describe("summary", () => {
  beforeEach(() => {
    start();
    const now = Date.now();
    useApp.getState().setData((d) => ({
      ...d,
      history: [
        { id: 1, table: 1, items: [{ name: "Pares", price: 60, qty: 2 }], total: 120, ts: new Date(now - 60_000).toISOString() },
        { id: 2, table: 2, items: [{ name: "Water", price: 20, qty: 1 }], total: 20, ts: new Date(now).toISOString() },
      ],
    }));
  });

  it("shows today's totals and best sellers", () => {
    click(button("Summary"));
    expect(text()).toContain("₱140");
    expect(text()).toContain("Best sellers");
    expect(document.querySelector(".best-row .n")!.textContent).toContain("Pares");
  });

  it("restores a paid order back to its table", () => {
    click(button("Summary"));
    click([...document.querySelectorAll<HTMLButtonElement>(".txn-row")].find((b) => b.textContent!.includes("Table 1"))!);
    click(button(/Restore to table/));
    click(button("Restore"));
    const d = useApp.getState().data;
    expect(d.history.map((h) => h.id)).toEqual([2]);
    // Restored bills come back as already served, with their original time.
    expect(d.tables["1"]).toEqual([{ items: [{ name: "Pares", price: 60, qty: 2, served: 2 }], openedAt: expect.any(String) }]);
  });

  it("deletes an order only after the confirmation code is typed", () => {
    click(button("Summary"));
    click(document.querySelector<HTMLButtonElement>(".txn-row")!);
    click(button(/Delete order/));
    const code = document.querySelector(".verify-code")!.textContent!;
    const confirm = button("Delete");
    expect(confirm.disabled).toBe(true);
    type(document.getElementById("verify") as HTMLInputElement, "ZZZZ");
    expect(button("Delete").disabled).toBe(true);
    type(document.getElementById("verify") as HTMLInputElement, code.toLowerCase());
    submitForm(document.getElementById("verify")!);
    expect(useApp.getState().data.history).toHaveLength(1);
  });

  it("resets today with a code", () => {
    click(button("Summary"));
    click(button("Reset today"));
    const code = document.querySelector(".verify-code")!.textContent!;
    type(document.getElementById("verify") as HTMLInputElement, code);
    submitForm(document.getElementById("verify")!);
    expect(useApp.getState().data.history).toHaveLength(0);
  });

  it("switches to a weekly view with a daily breakdown", () => {
    click(button("Summary"));
    click(button("This week"));
    expect(text()).toContain("Daily breakdown");
    expect(text()).toContain("This Week’s earnings");
  });
});

describe("settings and menu", () => {
  beforeEach(() => start());

  it("changes theme and business name", () => {
    click(byLabel("Settings"));
    click(button("Light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    type(document.getElementById("biz-name") as HTMLInputElement, "Kuya's Pares");
    expect(useApp.getState().data.settings.businessName).toBe("Kuya's Pares");
  });

  it("edits a menu item's price and nicknames", () => {
    click(byLabel("Settings"));
    click(button(/^Menu\d/));
    const row = [...document.querySelectorAll<HTMLButtonElement>(".mitem-main")].find((b) => b.textContent!.startsWith("Mami₱"))!;
    click(row);
    type(document.getElementById("mi-price") as HTMLInputElement, "55");
    type(document.getElementById("mi-alias") as HTMLInputElement, "noodles, mami soup");
    submitForm(document.getElementById("mi-price")!);
    const mami = useApp.getState().data.menu[1]!.items[0]!;
    expect(mami).toMatchObject({ name: "Mami", price: 55, aliases: ["noodles", "mami soup"] });
  });

  it("adds a category and an item in it", () => {
    click(byLabel("Settings"));
    click(button(/^Menu\d/));
    click(button(/Add category/));
    type(document.getElementById("cat-name") as HTMLInputElement, "Desserts");
    submitForm(document.getElementById("cat-name")!);
    click(button(/Add item to Desserts/));
    type(document.getElementById("mi-name") as HTMLInputElement, "Halo-halo");
    type(document.getElementById("mi-price") as HTMLInputElement, "70");
    submitForm(document.getElementById("mi-name")!);
    const cat = useApp.getState().data.menu.at(-1)!;
    expect(cat.cat).toBe("Desserts");
    expect(cat.items[0]).toMatchObject({ name: "Halo-halo", price: 70 });
  });
});

describe("Android back button", () => {
  beforeEach(() => start());

  const pressBack = () =>
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

  it("closes a dialog first, then goes back a screen", () => {
    click(byLabel("Settings"));
    click(button(/^Menu\d/));
    click(button(/Add category/));
    expect(useApp.getState().dialog).not.toBeNull();
    pressBack();
    expect(useApp.getState().dialog).toBeNull();
    expect(useApp.getState().stack.map((r) => r.name)).toEqual(["tables", "settings", "menu"]);
    pressBack();
    pressBack();
    expect(useApp.getState().stack.map((r) => r.name)).toEqual(["tables"]);
  });
});

describe("Ask Agent panel", () => {
  beforeEach(() => start());

  it("takes a typed order and offers undo", () => {
    click(byLabel("Ask Agent"));
    const input = byLabel("Message Ask Agent") as HTMLTextAreaElement;
    type(input, "2 mami with egg and a water for table 2");
    click(byLabel("Send"));
    expect(useApp.getState().data.tables["2"]![0]!.items).toEqual([
      { name: "Mami w/ Egg", price: 65, qty: 2 },
      { name: "Water", price: 20, qty: 1 },
    ]);
    expect(text()).toContain("₱150");
    click(button(/Undo/));
    expect(useApp.getState().data.tables["2"]?.[0]?.items ?? []).toEqual([]);
  });

  it("records a payment right away, and its Undo button reopens the bill", () => {
    useApp.getState().addItem(1, "Pares", 60, 2, 0);
    click(byLabel("Ask Agent"));
    type(byLabel("Message Ask Agent") as HTMLTextAreaElement, "table 1 paid 200");
    click(byLabel("Send"));
    expect(useApp.getState().data.history[0]).toMatchObject({ table: 1, total: 120, cash: 200 });
    expect(text()).toContain("change ₱80");
    click(button(/Undo/));
    expect(useApp.getState().data.history).toHaveLength(0);
    expect(useApp.getState().data.tables[1]![0]!.items).toEqual([expect.objectContaining({ name: "Pares", qty: 2 })]);
  });

  it("confirms a menu price change from a card button", () => {
    click(byLabel("Ask Agent"));
    type(byLabel("Message Ask Agent") as HTMLTextAreaElement, "change the price of mami to 55");
    click(byLabel("Send"));
    expect(useApp.getState().data.menu.flatMap((c) => c.items).find((i) => i.name === "Mami")!.price).toBe(50);
    click(document.querySelector<HTMLButtonElement>(".mactions .btn-primary")!);
    expect(useApp.getState().data.menu.flatMap((c) => c.items).find((i) => i.name === "Mami")!.price).toBe(55);
  });

  it("welcome cards send a message", () => {
    click(byLabel("Ask Agent"));
    expect(text()).toContain("How can I help?");
    click(button(/Today’s sales/));
    expect(useAgent.getState().messages).toHaveLength(2);
    expect(text()).toContain("How much did we sell today?");
  });

  it("is a full screen that Back closes", () => {
    click(byLabel("Ask Agent"));
    expect(useApp.getState().stack.map((r) => r.name)).toEqual(["tables", "ask"]);
    expect(document.querySelector(".bottomnav")).toBeNull();
    click(byLabel(/^Back to/));
    expect(useApp.getState().stack.map((r) => r.name)).toEqual(["tables"]);
  });

  it("knows the table it was opened from and returns to it", () => {
    click(byLabel("Table 1, empty"));
    click(byLabel("Ask Agent about this table"));
    expect(text()).toContain("Helping with Table 1");
    type(byLabel("Message Ask Agent") as HTMLTextAreaElement, "2 pares and a water");
    click(byLabel("Send"));
    expect(useApp.getState().data.tables["1"]![0]!.items).toEqual([
      { name: "Pares", price: 60, qty: 2 },
      { name: "Water", price: 20, qty: 1 },
    ]);
    click(byLabel(/^Back to/));
    expect(useApp.getState().stack.at(-1)).toEqual({ name: "order", tableId: 1 });
  });

  it("opens a table from a bill card", () => {
    click(byLabel("Ask Agent"));
    type(byLabel("Message Ask Agent") as HTMLTextAreaElement, "1 siomai for table 3");
    click(byLabel("Send"));
    click(button("Open"));
    expect(useApp.getState().stack.at(-1)).toEqual({ name: "order", tableId: 3 });
  });

  it("clears the chat after confirmation", () => {
    click(byLabel("Ask Agent"));
    type(byLabel("Message Ask Agent") as HTMLTextAreaElement, "hello");
    click(byLabel("Send"));
    click(byLabel("Clear chat"));
    click(document.querySelector<HTMLButtonElement>(".modal .btn-primary, [role=dialog] .btn-primary")!);
    expect(useAgent.getState().messages).toHaveLength(0);
  });

  it("restores saved history with old buttons retired", () => {
    useAgent.getState().hydrate([
      { id: 5, ts: Date.now() - 3600e3, role: "user", text: "table 1 paid" },
      { id: 6, ts: Date.now() - 3600e3, role: "agent", text: "Mark Table 1 as paid?", confirm: { yes: "Mark paid", state: "pending" }, undo: "available" },
    ]);
    click(byLabel("Ask Agent"));
    expect(text()).toContain("Mark Table 1 as paid?");
    expect(text()).toContain("No longer active");
    expect(document.querySelector(".mactions")).toBeNull();
  });
});

describe("quick cash", () => {
  it("offers exact amount and the next round bills", () => {
    expect(quickCashOptions(145)).toEqual([145, 150, 200, 500, 1000]);
    expect(quickCashOptions(500)).toEqual([500, 1000]);
    expect(quickCashOptions(0)).toEqual([]);
  });
});

// ---------------- v18 features ----------------

function contextMenu(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
}

describe("serving, notes and sold out", () => {
  beforeEach(() => start());

  it("marks items served and shows what's left to serve on the table card", () => {
    click(byLabel("Table 1, empty"));
    click(byLabel(/^Add Pares, ₱60/));
    click(byLabel(/^Add Mami, ₱50/));
    click(byLabel("View bill"));
    expect(text()).toContain("2 not served yet");
    click(byLabel("Mark Pares served"));
    expect(useApp.getState().data.tables["1"]![0]!.items[0]!.served).toBe(1);
    expect(text()).toContain("1 not served yet");
    click(button(/All served/));
    expect(text()).not.toContain("not served yet");
    click(byLabel("Hide bill"));
    click(byLabel(/^Back to/));
    expect(byLabel("Table 1, ₱110")).toBeTruthy();
    expect(text()).toContain("Served");
  });

  it("adds a note to an item from the bill", () => {
    click(byLabel("Table 2, empty"));
    click(byLabel(/^Add Pares, ₱60/));
    click(byLabel("View bill"));
    click(byLabel("Note for Pares"));
    click(button("Walang sibuyas"));
    submitForm(document.getElementById("note-text")!);
    expect(useApp.getState().data.tables["2"]![0]!.items[0]).toMatchObject({ name: "Pares", note: "Walang sibuyas" });
    expect(text()).toContain("Walang sibuyas");
  });

  it("long-press marks an item sold out; tapping it warns, with Add anyway", () => {
    click(byLabel("Table 1, empty"));
    contextMenu(byLabel(/^Add Pastil, ₱50/));
    expect(byLabel(/^Add Pastil, ₱50, sold out/)).toBeTruthy();
    click(byLabel(/^Add Pastil, ₱50, sold out/));
    expect(useApp.getState().data.tables["1"]![0]!.items).toEqual([]);
    expect(text()).toContain("Pastil is marked sold out");
    click(button("Add anyway"));
    expect(useApp.getState().data.tables["1"]![0]!.items).toEqual([{ name: "Pastil", price: 50, qty: 1 }]);
  });

  it("menu editor toggles sold out", () => {
    click(byLabel("Settings"));
    click(button(/^Menu\d/));
    click(byLabel("Mark Siomai sold out"));
    expect(useApp.getState().data.menu.flatMap((c) => c.items).find((i) => i.name === "Siomai")!.soldOut).toBeTruthy();
    click(byLabel(/Siomai is sold out/));
    expect(useApp.getState().data.menu.flatMap((c) => c.items).find((i) => i.name === "Siomai")!.soldOut).toBeUndefined();
  });
});

describe("payment methods, utang and expenses", () => {
  beforeEach(() => start());

  it("pays with GCash", async () => {
    click(byLabel("Table 1, empty"));
    click(byLabel(/^Add Pares, ₱60/));
    click(byLabel("View bill"));
    click(button("GCash"));
    expect(text()).toContain("Check the GCash payment");
    expect(document.querySelector('[aria-label="Cash received"]')).toBeNull();
    click(button(/Paid GCash ₱60/));
    await wait(450);
    expect(useApp.getState().data.history[0]).toMatchObject({ method: "gcash", total: 60 });
    expect(text()).toContain("Table 1 paid via GCash ₱60");
  });

  it("charges a bill to utang, then records a payment from the utang list", async () => {
    click(byLabel("Table 2, empty"));
    click(byLabel(/^Add Pares, ₱60/));
    click(byLabel(/^Add Pares, ₱60/));
    click(byLabel("View bill"));
    click(button("Utang"));
    expect(button(/Utang ₱120/).disabled).toBe(true);
    type(byLabel("Customer name") as HTMLInputElement, "Kuya Ben");
    click(button(/Utang ₱120/));
    await wait(450);
    expect(useApp.getState().data.history[0]).toMatchObject({ method: "utang", customer: "Kuya Ben", total: 120 });

    click(button("Summary"));
    expect(text()).toContain("Sold on utang");
    click(button(/^Utang₱120 unpaid/));
    expect(text()).toContain("Kuya Ben");
    click([...document.querySelectorAll<HTMLButtonElement>(".txn-row")].find((b) => b.textContent!.includes("unpaid order"))!);
    click(button(/Record payment/));
    type(document.getElementById("up-amount") as HTMLInputElement, "50");
    submitForm(document.getElementById("up-amount")!);
    expect(useApp.getState().data.history[0]!.payments).toEqual([expect.objectContaining({ amount: 50, method: "cash" })]);
    expect(text()).toContain("₱70 left");
  });

  it("adds an expense and shows profit", () => {
    useApp.getState().setData((d) => ({ ...d, history: [{ id: 1, table: 1, items: [{ name: "Pares", price: 60, qty: 5 }], total: 300, ts: new Date().toISOString() }] }));
    click(button("Summary"));
    click(button(/Add expense/));
    type(document.getElementById("ex-amount") as HTMLInputElement, "120");
    click(button("Ice"));
    submitForm(document.getElementById("ex-amount")!);
    expect(useApp.getState().data.expenses).toEqual([expect.objectContaining({ amount: 120, what: "Ice" })]);
    const money = document.querySelector(".money")!.textContent!;
    expect(money).toContain("−₱120");
    expect(money).toContain("Profit₱180");
    click(byLabel("Delete expense Ice"));
    expect(useApp.getState().data.expenses).toEqual([]);
    click(button("Undo"));
    expect(useApp.getState().data.expenses).toHaveLength(1);
  });
});

describe("backup reminder", () => {
  beforeEach(() => start());

  it("nudges when there are old sales and no backup, and Later hides it", () => {
    act(() => useApp.getState().setData((d) => ({ ...d, history: [{ id: 1, table: 1, items: [{ name: "Pares", price: 60, qty: 1 }], total: 60, ts: new Date(Date.now() - 5 * 86400e3).toISOString() }] })));
    expect(text()).toContain("Save a backup?");
    click(button("Later"));
    expect(text()).not.toContain("Save a backup?");
    expect(useApp.getState().data.settings.backupSnoozeUntil).toBeTruthy();
  });
});

describe("Ask Agent extras", () => {
  beforeEach(() => start());

  it("how-to answers have a button that opens the screen", () => {
    click(byLabel("Ask Agent"));
    type(byLabel("Message Ask Agent") as HTMLTextAreaElement, "how do I back up my data?");
    click(byLabel("Send"));
    click(button(/Open Settings/));
    expect(useApp.getState().stack.at(-1)).toEqual({ name: "settings" });
  });

  it("shows a heads-up tip for a table that has waited long", () => {
    act(() =>
      useApp.getState().setData((d) => ({
        ...d,
        tables: { ...d.tables, "3": [{ items: [{ name: "Mami", price: 50, qty: 1 }], openedAt: new Date(Date.now() - 25 * 60000).toISOString() }] },
      })),
    );
    expect(document.querySelector(".tcard.waiting")).toBeTruthy();
    click(byLabel("Ask Agent"));
    expect(document.querySelector(".nudge")!.textContent).toContain("Table 3 has been waiting 25 min");
    click(document.querySelector<HTMLButtonElement>(".nudge-text")!);
    expect(useApp.getState().stack.at(-1)).toEqual({ name: "order", tableId: 3 });
  });

  it("opens Talk mode by voice command and explains when voice isn't available", () => {
    click(byLabel("Ask Agent"));
    type(byLabel("Message Ask Agent") as HTMLTextAreaElement, "talk mode");
    click(byLabel("Send"));
    expect(useApp.getState().stack.map((r) => r.name)).toEqual(["tables", "ask", "talk"]);
    expect(text()).toContain("Voice isn’t supported in this browser");
    click(byLabel("End Talk mode"));
    expect(useApp.getState().stack.at(-1)).toEqual({ name: "ask" });
  });
});
