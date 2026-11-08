import { beforeEach, describe, expect, it } from "vitest";
import { freshData } from "../data/defaults";
import { setPersistenceEnabled, useApp } from "../store/appStore";
import { useAgent } from "./agentStore";

setPersistenceEnabled(false);

const app = () => useApp.getState();
const say = (text: string) => useAgent.getState().send(text);
const confirmLast = () => {
  const m = [...useAgent.getState().messages].reverse().find((x) => x.confirm?.state === "pending");
  if (!m) throw new Error("no pending confirmation");
  return useAgent.getState().confirm(m.id);
};
const bill = (tableId: number, split = 0) =>
  (app().data.tables[tableId]?.[split]?.items ?? []).map((i) => `${i.qty}x ${i.name}`);

beforeEach(() => {
  const data = freshData();
  data.tableList.push({ id: 5, name: "Takeout", custom: true });
  data.tables["5"] = [];
  data.nextCustomId = 6;
  useApp.setState({ data, ready: true, stack: [{ name: "tables" }], dialog: null, undoStack: [], activeSplit: 0 });
  useAgent.getState().reset();
});

describe("orders", () => {
  it("logs the headline example immediately", () => {
    const r = say("Pares w/ egg and Rice table 3");
    expect(bill(3)).toEqual(["1x Pares w/ Egg & Rice"]);
    expect(r.text).toContain("Table 3");
    expect(r.text).toContain("₱90");
  });

  it("handles multiple items, quantities and spoken numbers", () => {
    say("two mami with egg and 3 siomai for table one");
    expect(bill(1)).toEqual(["2x Mami w/ Egg", "3x Siomai"]);
  });

  it("understands speech-style 'for' heard as 4", () => {
    say("pares with rice 4 table 2");
    expect(bill(2)).toEqual(["1x Pares w/ Rice"]);
  });

  it("asks for the table when missing, then completes", () => {
    const r = say("2 pares");
    expect(r.text).toMatch(/which table/i);
    expect(bill(1)).toEqual([]);
    say("table 4");
    expect(bill(4)).toEqual(["2x Pares"]);
  });

  it("remembers the last table for follow-ups", () => {
    say("pares for table 3");
    say("and a water");
    expect(bill(3)).toEqual(["1x Pares", "1x Water"]);
    say("make it 3");
    expect(bill(3)).toEqual(["1x Pares", "3x Water"]);
    say("same for table 4");
    expect(bill(4)).toEqual(["3x Water"]);
  });

  it("uses the open order screen's table", () => {
    app().openTable(2);
    say("siomai x4");
    expect(bill(2)).toEqual(["4x Siomai"]);
  });

  it("supports custom table names", () => {
    say("takeout 2 siomai and a coke");
    expect(bill(5)).toEqual(["2x Siomai", "1x Softdrinks"]);
  });

  it("removes items", () => {
    say("3 siomai and 2 water table 1");
    say("remove 1 siomai from table 1");
    expect(bill(1)).toEqual(["2x Siomai", "2x Water"]);
    say("no more water on table 1");
    expect(bill(1)).toEqual(["2x Siomai"]);
  });

  it("undoes the last change", () => {
    say("pares table 1");
    say("mami table 1");
    say("undo");
    expect(bill(1)).toEqual(["1x Pares"]);
  });

  it("offers to add unknown items as custom with a price", () => {
    const r = say("kwek kwek for table 2");
    expect(r.text).toMatch(/isn.t on the menu/);
    say("20 pesos");
    expect(bill(2)).toEqual(["1x Kwek Kwek"]);
    expect(app().data.tables["2"]![0]!.items[0]!.price).toBe(20);
  });

  it("asks to confirm low-confidence matches", () => {
    const r = say("parse with eg table 1");
    expect(r.confirm).toBeTruthy();
    confirmLast();
    expect(bill(1)).toEqual(["1x Pares w/ Egg"]);
  });

  it("rejects a table that doesn't exist", () => {
    const r = say("pares for table 9");
    expect(r.text).toMatch(/no Table 9/);
    expect(bill(1)).toEqual([]);
  });
});

describe("payments", () => {
  it("confirms before paying and computes change", () => {
    say("pares w/ egg and rice table 3");
    const r = say("table 3 paid 500 cash");
    expect(r.confirm?.yes).toBe("Mark paid");
    expect(r.text).toContain("change ₱410");
    expect(app().data.history).toHaveLength(0);
    say("yes");
    expect(app().data.history).toHaveLength(1);
    expect(app().data.history[0]!.total).toBe(90);
    expect(app().data.history[0]!.cash).toBe(500);
    expect(bill(3)).toEqual([]);
  });

  it("can be cancelled", () => {
    say("mami table 1");
    say("table 1 paid");
    say("no");
    expect(app().data.history).toHaveLength(0);
  });

  it("warns when cash is short", () => {
    say("pares w/ egg and rice table 3");
    const r = say("table 3 paid 50");
    expect(r.text).toMatch(/short by ₱40/);
    expect(r.confirm).toBeUndefined();
  });

  it("asks which split when a table has several bills", () => {
    say("pares table 2");
    say("split table 2");
    app().addItem(2, "Water", 20, 1, 1);
    const r = say("table 2 paid");
    expect(r.text).toMatch(/2 separate bills/);
    say("split 2");
    say("yes");
    expect(app().data.history[0]!.total).toBe(20);
    expect(bill(2)).toEqual(["1x Pares"]);
  });
});

describe("questions", () => {
  beforeEach(() => {
    say("2 pares and a water table 1");
    say("table 1 paid");
    say("yes");
    say("mami table 2");
  });

  it("answers sales questions", () => {
    const r = say("how much did we sell today?");
    expect(r.text).toContain("₱140");
    expect(r.text).toContain("1 order");
  });

  it("answers item sales", () => {
    expect(say("how many pares did we sell today").text).toMatch(/2 sold/);
  });

  it("lists open tables", () => {
    const r = say("which tables are still open?");
    expect(r.text).toMatch(/1 table has open bills, ₱50 unpaid/);
  });

  it("shows a table's bill", () => {
    expect(say("what's on table 2?").text).toBe("Table 2: 1× Mami. Total ₱50.");
  });

  it("answers price questions", () => {
    expect(say("how much is pares with egg?").text).toBe("Pares w/ Egg is ₱75.");
  });

  it("reports best seller", () => {
    expect(say("what's our best seller today").text).toMatch(/Pares ×2/);
  });

  it("refuses to delete records", () => {
    const r = say("reset today's sales");
    expect(r.tone).toBe("warn");
    expect(app().data.history).toHaveLength(1);
  });

  it("restores the last paid order after confirmation", () => {
    say("restore the last order");
    say("yes");
    expect(app().data.history).toHaveLength(0);
    expect(bill(1)).toEqual(["2x Pares", "1x Water"]);
  });
});

describe("app control", () => {
  it("changes a price after confirmation", () => {
    say("change the price of mami to 55");
    confirmLast();
    expect(app().data.menu[1]!.items[0]!.price).toBe(55);
  });

  it("adds a menu item into a category", () => {
    say("add tapsilog to the menu for 95 under pares");
    confirmLast();
    const pares = app().data.menu.find((c) => c.cat === "Pares")!;
    expect(pares.items.some((i) => i.name === "Tapsilog" && i.price === 95)).toBe(true);
  });

  it("adds a table", () => {
    say("add table Delivery");
    expect(app().data.tableList.some((t) => t.name === "Delivery")).toBe(true);
  });

  it("navigates", () => {
    say("open summary");
    expect(app().stack[app().stack.length - 1]!.name).toBe("summary");
    say("open table 3");
    expect(app().stack[app().stack.length - 1]).toEqual({ name: "order", tableId: 3 });
  });

  it("switches theme", () => {
    say("switch to light mode");
    expect(app().data.settings.theme).toBe("light");
  });

  it("sets working hours", () => {
    say("set working hours from 5pm to 1am");
    confirmLast();
    expect(app().data.settings.workStart).toBe("17:00");
    expect(app().data.settings.workEnd).toBe("01:00");
  });

  it("greets and helps", () => {
    expect(say("hello").text).toMatch(/Ready to take orders/);
    expect(say("what can you do?").card?.kind).toBe("list");
  });

  it("falls back politely", () => {
    expect(say("the weather is nice").tone).toBe("warn");
  });
});
