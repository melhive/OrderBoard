// @vitest-environment jsdom
// Persistence: legacy (v1–v15 localStorage) → IndexedDB migration, and the
// store writing changes through to IndexedDB.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, loadAppData } from "./db";
import { LEGACY_STORAGE_KEY, normalizeAppData, toBackup } from "./migrate";
import { flushPersistence, useApp } from "../store/appStore";

const LEGACY_V15 = {
  tables: { "1": [{ name: "Pares", price: 60, qty: 2 }], "2": [], "3": [], "4": [], "5": [{ items: [{ name: "Water", price: 20, qty: 1 }] }] },
  history: [{ id: 1730000000000, table: 2, items: [{ name: "Mami", price: 50, qty: 1 }], total: 50, ts: "2026-11-01T11:00:00.000Z" }],
  theme: "light",
  tableList: [
    { id: 1, name: "1", custom: false },
    { id: 2, name: "2", custom: false },
    { id: 3, name: "3", custom: false },
    { id: 4, name: "4", custom: false },
    { id: 5, name: "Takeout", custom: true },
  ],
  nextCustomId: 6,
  menu: [{ id: 1, cat: "Pares", items: [{ id: 1, name: "Pares", price: 60 }] }],
  nextMenuCatId: 2,
  nextMenuItemId: 2,
  businessName: "Kuya's",
  workStart: "17:00",
  workEnd: "01:00",
};

beforeEach(async () => {
  localStorage.clear();
  await db.kv.clear();
  await db.history.clear();
});

describe("loadAppData", () => {
  it("migrates legacy localStorage data once and keeps a renamed copy", async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(LEGACY_V15));
    const first = await loadAppData();
    expect(first.source).toBe("legacy");
    expect(first.data.tables["1"]).toEqual([{ items: [{ name: "Pares", price: 60, qty: 2 }] }]);
    expect(first.data.tables["5"]).toEqual([{ items: [{ name: "Water", price: 20, qty: 1 }] }]);
    expect(first.data.settings).toMatchObject({ theme: "light", businessName: "Kuya's", workStart: "17:00", workEnd: "01:00", acceptedLegalVersion: null });
    expect(first.data.history).toHaveLength(1);
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_STORAGE_KEY + "_migrated")).not.toBeNull();

    const second = await loadAppData();
    expect(second.source).toBe("indexeddb");
    expect(second.data).toEqual(first.data);
  });

  it("starts fresh with the default menu when there is nothing to migrate", async () => {
    const { data, source } = await loadAppData();
    expect(source).toBe("fresh");
    expect(data.tableList).toHaveLength(4);
    expect(data.menu.length).toBeGreaterThan(3);
  });

  it("round-trips a backup file", () => {
    const data = normalizeAppData(LEGACY_V15);
    const restored = normalizeAppData(JSON.parse(JSON.stringify(toBackup(data))));
    expect(restored).toEqual(data);
  });
});

describe("store persistence", () => {
  it("writes paid orders and workspace changes through to IndexedDB", async () => {
    const { data } = await loadAppData();
    useApp.getState().init(data);
    const app = useApp.getState();
    app.addItem(1, "Siomai", 25, 4, 0);
    app.markPaid(1, 0, 100);
    app.updateSettings({ businessName: "Stall 9" });
    flushPersistence();
    await new Promise((r) => setTimeout(r, 50));

    const reloaded = await loadAppData();
    expect(reloaded.source).toBe("indexeddb");
    expect(reloaded.data.history).toHaveLength(1);
    expect(reloaded.data.history[0]).toMatchObject({ table: 1, total: 100, cash: 100 });
    expect(reloaded.data.settings.businessName).toBe("Stall 9");
    expect(reloaded.data.tables["1"]).toEqual([]);
  });
});
