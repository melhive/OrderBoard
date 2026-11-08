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
    agentOpen: false,
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
    expect(text()).toContain("Empty · tap to start");
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
    expect(text()).toContain("No items yet");
    click(byLabel(/^Add Pares, ₱60/));
    click(byLabel(/^Add Pares, ₱60/));
    click(byLabel(/^Add Siomai, ₱25/));
    const bill = useApp.getState().data.tables["1"]![0]!.items;
    expect(bill).toEqual([
      { name: "Pares", price: 60, qty: 2 },
      { name: "Siomai", price: 25, qty: 1 },
    ]);
    expect(byLabel(/^Add Pares, ₱60, 2 on bill/)).toBeTruthy();

    type(byLabel("Cash received") as HTMLInputElement, "200");
    expect(text()).toContain("Change ₱55");
    type(byLabel("Cash received") as HTMLInputElement, "100");
    expect(text()).toContain("Short ₱45");
    type(byLabel("Cash received") as HTMLInputElement, "500");

    click(button(/Paid ₱145/));
    await wait(450);
    const s = useApp.getState();
    expect(s.data.history).toHaveLength(1);
    expect(s.data.history[0]).toMatchObject({ table: 1, total: 145, cash: 500 });
    expect(s.stack).toEqual([{ name: "tables" }]);
    expect(text()).toContain("Table 1 paid ₱145 · change ₱355");
    expect(text()).toContain("Today ₱145");

    // Undo from the toast puts the bill back.
    click(button("Undo"));
    expect(useApp.getState().data.history).toHaveLength(0);
    expect(useApp.getState().data.tables["1"]![0]!.items).toHaveLength(2);
  });

  it("removes a line with the stepper and clears with confirmation", () => {
    click(byLabel("Table 2, empty"));
    click(byLabel(/^Add Water/));
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
    click(button(/Paid ₱20/));
    await wait(450);
    const d = useApp.getState().data;
    expect(d.history.map((h) => h.total)).toEqual([20]);
    expect(d.tables["3"]).toEqual([{ items: [{ name: "Pares", price: 60, qty: 1 }] }]);
    // Still on the order screen because a bill remains.
    expect(useApp.getState().stack.at(-1)).toEqual({ name: "order", tableId: 3 });
  });

  it("adds a custom item", () => {
    click(byLabel("Table 4, empty"));
    click(button("+ Custom item"));
    type(document.getElementById("ci-name") as HTMLInputElement, "Extra sauce");
    type(document.getElementById("ci-price") as HTMLInputElement, "10");
    submitForm(document.getElementById("ci-name")!);
    expect(useApp.getState().data.tables["4"]![0]!.items).toEqual([{ name: "Extra sauce", price: 10, qty: 1 }]);
  });

  it("filters the menu with search", () => {
    click(byLabel("Table 1, empty"));
    type(byLabel("Search menu") as HTMLInputElement, "soda");
    const tiles = [...document.querySelectorAll(".menu-tile:not(.custom)")].map((t) => t.querySelector(".name")!.textContent);
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
    expect(d.tables["1"]).toEqual([{ items: [{ name: "Pares", price: 60, qty: 2 }] }]);
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
    click(button("Week"));
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
    click(button(/Edit menu/));
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
    click(button(/Edit menu/));
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
    click(button(/Edit menu/));
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

  it("confirms a payment from a card button", () => {
    useApp.getState().addItem(1, "Pares", 60, 2, 0);
    click(byLabel("Ask Agent"));
    type(byLabel("Message Ask Agent") as HTMLTextAreaElement, "table 1 paid 200");
    click(byLabel("Send"));
    expect(useApp.getState().data.history).toHaveLength(0);
    click(document.querySelector<HTMLButtonElement>(".msg-actions .btn-primary")!);
    expect(useApp.getState().data.history[0]).toMatchObject({ table: 1, total: 120, cash: 200 });
  });

  it("starter suggestions send a message", () => {
    click(byLabel("Ask Agent"));
    click(button("Which tables are open?"));
    expect(useAgent.getState().messages).toHaveLength(2);
  });
});

describe("quick cash", () => {
  it("offers exact amount and the next round bills", () => {
    expect(quickCashOptions(145)).toEqual([145, 150, 200, 500, 1000]);
    expect(quickCashOptions(500)).toEqual([500, 1000]);
    expect(quickCashOptions(0)).toEqual([]);
  });
});
