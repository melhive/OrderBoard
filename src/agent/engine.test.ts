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

describe("Taglish and everyday phrasing", () => {
  it("understands Filipino numbers and 'at'", () => {
    say("isang pares at dalawang mami table 1");
    expect(bill(1)).toEqual(["1x Pares", "2x Mami"]);
  });

  it("ignores Filipino politeness particles", () => {
    say("pa-order po ng 3 siomai sa table 4");
    expect(bill(4)).toEqual(["3x Siomai"]);
  });

  it("answers 'magkano' about a table", () => {
    say("2 pares for table 3");
    expect(say("magkano table 3").text).toContain("₱120");
  });

  it("treats 'bayad na' as a payment", () => {
    say("1 mami for table 2");
    const r = say("table 2 bayad na");
    expect(r.confirm?.plan.kind).toBe("pay");
  });

  it("answers sales questions in Taglish", () => {
    expect(say("magkano benta ngayon").text).toMatch(/No sales recorded today/);
  });
});

describe("safety of follow-up questions", () => {
  it("a new request is not mistaken for a custom item's price", () => {
    say("kwek kwek for table 2");
    say("1 pares for table 3");
    say("table 3 paid 200");
    expect(bill(2)).toEqual([]);
    expect(bill(3)).toEqual(["1x Pares"]);
  });

  it("does not offer unknown words as custom items without an order", () => {
    const r = say("blah blah something");
    expect(r.text).not.toMatch(/isn.t on the menu/);
    expect(bill(1)).toEqual([]);
  });

  it("'remove the egg from table 3' never tries to remove the table", () => {
    say("pares with egg for table 3");
    const r = say("remove the egg from table 3");
    expect(r.text).not.toMatch(/built-in table/);
  });

  it("a bare yes with nothing pending explains itself", () => {
    expect(say("yes").text).toMatch(/nothing waiting/);
  });

  it("carries the quantity of a custom item", () => {
    say("2 kwek kwek for table 1");
    say("15");
    expect(bill(1)).toEqual(["2x Kwek Kwek"]);
  });
});

describe("new abilities", () => {
  const seed = () => {
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    app().setData((d) => ({
      ...d,
      history: [
        { id: 1, table: 1, items: [{ name: "Pares", price: 60, qty: 1 }], total: 60, ts: new Date(now - day).toISOString() },
        { id: 2, table: 1, items: [{ name: "Pares", price: 60, qty: 2 }], total: 120, ts: new Date(now - 60_000).toISOString() },
        { id: 3, table: 2, items: [{ name: "Water", price: 20, qty: 3 }], total: 60, ts: new Date(now).toISOString() },
      ],
    }));
  };

  it("moves a bill to another table", () => {
    say("2 siomai for table 2");
    const r = say("move table 2 to table 4");
    expect(r.confirm?.plan.kind).toBe("moveTable");
    confirmLast();
    expect(bill(2)).toEqual([]);
    expect(bill(4)).toEqual(["2x Siomai"]);
  });

  it("understands 'transfer table 1 to 3' without the second 'table'", () => {
    say("1 water for table 1");
    expect(say("transfer table 1 to 3").confirm?.plan).toEqual({ kind: "moveTable", from: 1, to: 3 });
  });

  it("works out change without paying", () => {
    say("2 pares for table 1");
    const r = say("change for 500 on table 1");
    expect(r.text).toContain("₱380");
    expect(app().data.history).toHaveLength(0);
    expect(say("sukli sa 100 table 1").text).toMatch(/short by ₱20/);
  });

  it("compares today with yesterday", () => {
    seed();
    const r = say("compare today and yesterday");
    expect(r.text).toContain("Today: ₱180");
    expect(r.text).toContain("Yesterday: ₱60");
    expect(r.text).toContain("+200%");
  });

  it("reports the average order", () => {
    seed();
    expect(say("average order today").text).toContain("₱90");
  });

  it("finds the busiest hour", () => {
    seed();
    expect(say("what is our busiest hour").text).toMatch(/busiest hour/);
  });
});
