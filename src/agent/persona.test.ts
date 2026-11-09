import { beforeEach, describe, expect, it } from "vitest";
import { freshData } from "../data/defaults";
import { setPersistenceEnabled, useApp } from "../store/appStore";
import { setPersona, useAgent } from "./agentStore";
import { freshPersonaMemory, humanize, type PersonaFacts } from "./persona";

setPersistenceEnabled(false);

/** Small seeded random generator, so runs are repeatable. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const facts = (over: Partial<PersonaFacts> = {}): PersonaFacts => ({
  hour: 21, todayTotal: 0, todayOrders: 0, yesterdayTotal: 0, openTables: 0, unpaid: 0, longestWait: 0, backupDue: false, ...over,
});

const say = (t: string) => useAgent.getState().send(t).text;

beforeEach(() => {
  useApp.setState({ data: freshData(), ready: true, stack: [{ name: "tables" }], dialog: null, undoStack: [], activeSplit: 0 });
  useAgent.getState().reset();
  setPersona(true, seeded(7));
});

describe("persona: same facts, human wording", () => {
  it("varies how it confirms an order but always keeps items, table and total", () => {
    let mem = freshPersonaMemory();
    const rng = seeded(1);
    const seen = new Set<string>();
    let prev = "";
    for (let i = 0; i < 25; i++) {
      const h = humanize({ kind: "added", table: "Table 4", items: "4× Pares", units: 4, total: 240, tl: false }, facts(), mem, rng);
      mem = h.memory;
      expect(h.text).toContain("4× Pares");
      expect(h.text).toContain("₱240");
      expect(h.text).not.toBe(prev); // never the same line twice in a row
      prev = h.text;
      seen.add(h.text);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it("answers in Taglish when you talk in Taglish", () => {
    const h = humanize({ kind: "added", table: "Table 2", items: "2× Mami", units: 2, total: 100, tl: true }, facts(), freshPersonaMemory(), seeded(3));
    expect(h.text).toMatch(/2× Mami/);
    expect(h.text).toMatch(/Sige|Okay po|Noted|Ayan|Copy|G!|para sa|sa Table 2|Nailagay|Table 2:/);
  });

  it("celebrates the first sale, milestones and beating yesterday", () => {
    const first = humanize({ kind: "paid", table: "Table 1", total: 120, method: "cash", todayBefore: 0, yesterday: 0, ordersBefore: 0, stillOpen: 1, tl: false }, facts(), freshPersonaMemory(), seeded(2));
    expect(first.text).toMatch(/first sale/i);
    const tlFirst = humanize({ kind: "paid", table: "Table 1", total: 120, method: "gcash", todayBefore: 0, yesterday: 0, ordersBefore: 0, stillOpen: 1, tl: true }, facts(), freshPersonaMemory(), seeded(2));
    expect(tlFirst.text).toMatch(/Buena mano|Unang benta/);
    expect(tlFirst.text).toMatch(/GCash/);
    const passed = humanize({ kind: "paid", table: "Table 3", total: 300, method: "cash", todayBefore: 900, yesterday: 1100, ordersBefore: 8, stillOpen: 2, tl: false }, facts(), freshPersonaMemory(), seeded(2));
    expect(passed.text).toMatch(/passed yesterday’s total of ₱1,100/);
    const mile = humanize({ kind: "paid", table: "Table 3", total: 300, method: "cash", change: 200, todayBefore: 800, yesterday: 0, ordersBefore: 5, stillOpen: 2, tl: false }, facts(), freshPersonaMemory(), seeded(2));
    expect(mile.text).toMatch(/₱1,100|₱1,000/);
    expect(mile.text).toMatch(/₱200/);
  });

  it("tells jokes without repeating until it runs out", () => {
    let mem = freshPersonaMemory();
    const rng = seeded(5);
    const told = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const h = humanize({ kind: "chat", topic: "joke", tl: false, bisaya: false }, facts(), mem, rng);
      mem = h.memory;
      told.add(h.text.split(/[?.]/)[0]!);
    }
    expect(told.size).toBe(6);
  });

  it("greets by time of day, in Bisaya too, with how tonight is going", () => {
    const g = humanize({ kind: "chat", topic: "greet", tl: false, bisaya: false }, facts({ todayTotal: 1500, todayOrders: 12, openTables: 2, unpaid: 300 }), freshPersonaMemory(), seeded(4));
    expect(g.text).toMatch(/Good evening|Hey/);
    expect(g.text).toMatch(/₱1,500/);
    const b = humanize({ kind: "chat", topic: "greet", tl: false, bisaya: true }, facts({ hour: 8 }), freshPersonaMemory(), seeded(4));
    expect(b.text).toMatch(/Maayong buntag/);
    // 1 AM is still "tonight" for a stall open past midnight.
    const late = humanize({ kind: "chat", topic: "greet", tl: true, bisaya: false }, facts({ hour: 1 }), freshPersonaMemory(), seeded(4));
    expect(late.text).toMatch(/Magandang gabi/);
  });

  it("opens Talk mode with a short hello — time of day, name, no numbers — that changes", () => {
    let mem = freshPersonaMemory();
    const rng = seeded(11);
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const h = humanize({ kind: "chat", topic: "talkHello", tl: false, bisaya: false, name: "Rommel" }, facts({ hour: 20, todayTotal: 1115, todayOrders: 5 }), mem, rng);
      mem = h.memory;
      expect(h.text).toMatch(/Rommel/);
      expect(h.text).not.toMatch(/₱|\d/);
      expect(h.text.length).toBeLessThan(45);
      seen.add(h.text);
    }
    expect(seen.size).toBeGreaterThan(3);
    const tl = humanize({ kind: "chat", topic: "talkHello", tl: true, bisaya: false }, facts({ hour: 20 }), freshPersonaMemory(), seeded(12));
    expect(tl.text).toMatch(/Ano|Nakikinig|Game|Uy|Hello/);
  });

  it("reads the mood of the night when asked how it is", () => {
    const good = humanize({ kind: "chat", topic: "howareyou", tl: false, bisaya: false }, facts({ todayTotal: 3000, todayOrders: 20, yesterdayTotal: 2000 }), freshPersonaMemory(), seeded(6));
    expect(good.text).toMatch(/great|Fantastic/i);
    expect(good.text).toMatch(/ahead of yesterday/);
    const quiet = humanize({ kind: "chat", topic: "howareyou", tl: false, bisaya: false }, facts(), freshPersonaMemory(), seeded(6));
    expect(quiet.text).toMatch(/first customer|ready for the rush/i);
  });

  it("points out a long wait when it's busy", () => {
    const h = humanize({ kind: "chat", topic: "busy", tl: false, bisaya: false }, facts({ longestWait: 22, longestWaitTable: "Table 5" }), freshPersonaMemory(), seeded(8));
    expect(h.text).toMatch(/Table 5 has been waiting 22 minutes/);
  });

  it("reminds to back up when closing up", () => {
    const h = humanize({ kind: "chat", topic: "bye", tl: true, bisaya: false }, facts({ backupDue: true, todayOrders: 3, todayTotal: 400 }), freshPersonaMemory(), seeded(9));
    expect(h.text).toMatch(/backup/);
    expect(h.text).toMatch(/₱400/);
  });

  it("guesses what you meant when it didn't understand", () => {
    const h = humanize({ kind: "unknown", tl: false, tableName: "Table 3" }, facts(), freshPersonaMemory(), seeded(10));
    expect(h.text).toMatch(/What should I do with Table 3/);
  });
});

describe("persona in the real chat", () => {
  it("remembers your name and uses it", () => {
    expect(say("ako si Rommel")).toMatch(/Rommel/);
    expect(useApp.getState().data.settings.agent.ownerName).toBe("Rommel");
    expect(say("what's my name?")).toMatch(/Rommel/);
    expect(say("good evening")).toMatch(/Rommel/);
  });

  it("doesn't take 'I'm tired' as a name", () => {
    say("i'm tired");
    expect(useApp.getState().data.settings.agent.ownerName).toBeUndefined();
  });

  it("keeps the exact facts on real orders and payments", () => {
    const a = say("4 pares table 4");
    expect(a).toContain("4× Pares");
    expect(a).toContain("₱240");
    const p = say("table 4 paid 500");
    expect(p).toMatch(/₱240/);
    expect(p).toMatch(/₱260/); // change
    expect(useApp.getState().data.history).toHaveLength(1);
  });
});
