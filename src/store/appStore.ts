// Application state: data (persisted) + UI state (in-memory).
// All data changes go through setData(), which persists only what changed.

import { create } from "zustand";
import { deleteTxns, putTxn, replaceAll, saveWorkspace, workspaceOf } from "../data/db";
import type { AppData, MenuItem, Period, Settings, ThemePref, Txn } from "../data/types";
import { addToItems, splitTotal, tableDisplayName } from "../lib/bill";
import { businessDayKey, type PeriodSpec } from "../lib/businessDay";
import { generateVerifyCode } from "../lib/format";
import { haptic, setHapticsEnabled } from "../platform/haptics";

export type LegalDoc = "privacy" | "terms";

export type Route =
  | { name: "tables" }
  | { name: "order"; tableId: number }
  | { name: "summary" }
  | { name: "settings" }
  | { name: "menu" }
  | { name: "changelog" }
  | { name: "about" }
  | { name: "legal"; doc: LegalDoc };

export type Dialog =
  | { type: "confirm-clear"; tableId: number }
  | { type: "custom-item"; tableId: number }
  | { type: "add-table" }
  | { type: "confirm-remove-table"; tableId: number; name: string }
  | { type: "confirm-reset"; code: string }
  | { type: "pick-date" }
  | { type: "confirm-restore-txn"; txnId: number; tableId: number; tableExists: boolean }
  | { type: "confirm-delete-txn"; txnId: number; code: string }
  | { type: "export-menu" }
  | { type: "category-form"; catId: number | null }
  | { type: "menu-item-form"; catId: number; itemId: number | null }
  | { type: "confirm-restore-backup"; pending: AppData }
  | { type: "import-error" };

export interface Toast {
  id: number;
  text: string;
  tone?: "default" | "success" | "danger";
  action?: { label: string; run: () => void };
}

interface UndoEntry {
  label: string;
  data: AppData;
}

interface UIState {
  stack: Route[];
  /** Direction of the last navigation, for slide animations. */
  navDir: 1 | -1;
  dialog: Dialog | null;
  sheetOpen: boolean;
  agentOpen: boolean;
  activeSplit: number;
  cashInput: string;
  summary: PeriodSpec;
  expandedTxnId: number | null;
  expandedDayKey: string | null;
  justSettledTableId: number | null;
  toast: Toast | null;
}

export interface AppState extends UIState {
  ready: boolean;
  data: AppData;
  undoStack: UndoEntry[];

  init(data: AppData): void;

  // navigation
  push(route: Route): void;
  goTab(name: "tables" | "summary"): void;
  back(): boolean;
  canGoBack(): boolean;
  openTable(id: number): void;
  setSheet(open: boolean): void;
  setAgentOpen(open: boolean): void;
  openDialog(d: Dialog): void;
  closeDialog(): void;
  showToast(t: Omit<Toast, "id">): void;
  dismissToast(): void;

  // orders
  setActiveSplit(i: number): void;
  setCashInput(v: string): void;
  addItem(tableId: number, name: string, price: number, qty?: number, splitIdx?: number): void;
  changeQty(tableId: number, splitIdx: number, itemIdx: number, delta: number): void;
  setLineQty(tableId: number, splitIdx: number, name: string, qty: number): void;
  addSplit(tableId: number): number;
  removeSplit(tableId: number, idx: number): void;
  clearSplit(tableId: number, splitIdx: number): void;
  markPaid(tableId: number, splitIdx: number, cash?: number): Txn | null;
  addTable(name: string): number;
  removeTable(id: number): void;

  // menu
  saveCategory(catId: number | null, name: string): void;
  deleteCategory(catId: number): void;
  saveMenuItem(catId: number, itemId: number | null, fields: Omit<MenuItem, "id">): number;
  deleteMenuItem(catId: number, itemId: number): void;
  moveCategory(from: number, to: number): void;
  moveMenuItem(catId: number, from: number, to: number): void;

  // settings
  updateSettings(patch: Partial<Settings>): void;
  setTheme(t: ThemePref): void;

  // history
  setPeriod(p: Period): void;
  setCustomRange(from: string, to: string): void;
  toggleTxn(id: number): void;
  toggleDay(key: string): void;
  restoreTxn(txnId: number): void;
  deleteTxn(txnId: number): void;
  resetToday(): void;
  askResetToday(): void;
  askDeleteTxn(txnId: number): void;
  askRestoreTxn(txnId: number): void;

  // data
  replaceData(data: AppData): void;
  checkpoint(label: string): void;
  undo(): string | null;
  /** Escape hatch for the agent executor and tests. */
  setData(fn: (d: AppData) => AppData): void;
}

// ---------- persistence plumbing ----------

let wsTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWs: AppData | null = null;

function scheduleWorkspaceSave(data: AppData) {
  pendingWs = data;
  if (wsTimer) return;
  wsTimer = setTimeout(() => {
    wsTimer = null;
    const d = pendingWs;
    pendingWs = null;
    if (d) void saveWorkspace(workspaceOf(d)).catch(reportStorageError);
  }, 120);
}

/** Write any pending workspace change immediately (e.g. when the app is backgrounded). */
export function flushPersistence() {
  if (wsTimer) {
    clearTimeout(wsTimer);
    wsTimer = null;
  }
  const d = pendingWs;
  pendingWs = null;
  if (d) void saveWorkspace(workspaceOf(d)).catch(reportStorageError);
}

function reportStorageError(e: unknown) {
  console.error("Order Board: failed to save", e);
  useApp.getState().showToast({ text: "Couldn’t save to device storage. Export a backup soon.", tone: "danger" });
}

function persistHistoryDiff(prev: Txn[], next: Txn[]) {
  if (prev === next) return;
  const prevById = new Map(prev.map((t) => [t.id, t]));
  const nextIds = new Set<number>();
  for (const t of next) {
    nextIds.add(t.id);
    if (prevById.get(t.id) !== t) void putTxn(t).catch(reportStorageError);
  }
  const removed = prev.filter((t) => !nextIds.has(t.id)).map((t) => t.id);
  if (removed.length) void deleteTxns(removed).catch(reportStorageError);
}

let persistenceEnabled = true;
/** Tests run the store without IndexedDB. */
export function setPersistenceEnabled(v: boolean) {
  persistenceEnabled = v;
}

let toastSeq = 1;
let lastTxnId = 0;
function nextTxnId(history: Txn[]): number {
  const maxExisting = history.length ? history[history.length - 1]!.id : 0;
  lastTxnId = Math.max(Date.now(), lastTxnId + 1, maxExisting + 1);
  return lastTxnId;
}

const initialUI: UIState = {
  stack: [{ name: "tables" }],
  navDir: 1,
  dialog: null,
  sheetOpen: false,
  agentOpen: false,
  activeSplit: 0,
  cashInput: "",
  summary: { period: "today", from: null, to: null },
  expandedTxnId: null,
  expandedDayKey: null,
  justSettledTableId: null,
  toast: null,
};

export const currentRoute = (s: Pick<AppState, "stack">): Route => s.stack[s.stack.length - 1]!;

export const useApp = create<AppState>()((set, get) => {
  const setData = (fn: (d: AppData) => AppData) => {
    const prev = get().data;
    const next = fn(prev);
    if (next === prev) return;
    set({ data: next });
    if (!persistenceEnabled) return;
    const { history: ph, ...pw } = prev;
    const { history: nh, ...nw } = next;
    if (Object.keys(nw).some((k) => (nw as Record<string, unknown>)[k] !== (pw as Record<string, unknown>)[k])) {
      scheduleWorkspaceSave(next);
    }
    persistHistoryDiff(ph, nh);
  };

  const updateTables = (tableId: number, fn: (splits: AppData["tables"][string]) => AppData["tables"][string]) =>
    setData((d) => ({ ...d, tables: { ...d.tables, [tableId]: fn(d.tables[tableId] ?? []) } }));

  return {
    ...initialUI,
    ready: false,
    data: null as unknown as AppData,
    undoStack: [],

    init(data) {
      setHapticsEnabled(data.settings.haptics);
      set({ data, ready: true });
    },

    // ---------- navigation ----------
    push(route) {
      set((s) => ({ stack: [...s.stack, route], navDir: 1, dialog: null, sheetOpen: false, cashInput: "", activeSplit: 0 }));
    },
    goTab(name) {
      set((s) => {
        if (s.stack.length === 1 && s.stack[0]!.name === name) return { dialog: null, agentOpen: false };
        return {
          stack: name === "tables" ? [{ name: "tables" }] : [{ name: "tables" }, { name }],
          navDir: name === "tables" ? -1 : 1,
          dialog: null,
          sheetOpen: false,
          cashInput: "",
          activeSplit: 0,
        };
      });
    },
    canGoBack() {
      const s = get();
      return !!s.dialog || s.agentOpen || s.sheetOpen || s.stack.length > 1;
    },
    back() {
      const s = get();
      if (s.dialog) set({ dialog: null });
      else if (s.agentOpen) set({ agentOpen: false });
      else if (s.sheetOpen) set({ sheetOpen: false });
      else if (s.stack.length > 1) set({ stack: s.stack.slice(0, -1), navDir: -1, cashInput: "", activeSplit: 0 });
      else return false;
      return true;
    },
    openTable(id) {
      const d = get().data;
      if (!d.tableList.some((t) => t.id === id)) return;
      if (!d.tables[id] || d.tables[id].length === 0) updateTables(id, () => [{ items: [] }]);
      const s = get();
      const top = currentRoute(s);
      if (top.name === "order" && top.tableId === id) return;
      // Opening a table from anywhere shows it directly above the Tables tab.
      set({
        stack: [{ name: "tables" }, { name: "order", tableId: id }],
        navDir: 1,
        dialog: null,
        sheetOpen: false,
        cashInput: "",
        activeSplit: 0,
      });
    },
    setSheet(open) {
      set({ sheetOpen: open });
    },
    setAgentOpen(open) {
      set({ agentOpen: open, dialog: open ? null : get().dialog });
    },
    openDialog(dialog) {
      set({ dialog });
    },
    closeDialog() {
      set({ dialog: null });
    },
    showToast(t) {
      set({ toast: { ...t, id: toastSeq++ } });
    },
    dismissToast() {
      set({ toast: null });
    },

    // ---------- orders ----------
    setActiveSplit(i) {
      set({ activeSplit: i, cashInput: "" });
    },
    setCashInput(v) {
      set({ cashInput: v });
    },
    addItem(tableId, name, price, qty = 1, splitIdx) {
      const idx = splitIdx ?? get().activeSplit;
      updateTables(tableId, (splits) => {
        const next = splits.length ? splits.slice() : [{ items: [] }];
        const i = Math.min(idx, next.length - 1);
        next[i] = { items: addToItems(next[i]!.items, name, price, qty) };
        return next;
      });
    },
    changeQty(tableId, splitIdx, itemIdx, delta) {
      updateTables(tableId, (splits) =>
        splits.map((sp, i) => {
          if (i !== splitIdx) return sp;
          const items = sp.items
            .map((it, j) => (j === itemIdx ? { ...it, qty: it.qty + delta } : it))
            .filter((it) => it.qty > 0);
          return { items };
        }),
      );
    },
    setLineQty(tableId, splitIdx, name, qty) {
      updateTables(tableId, (splits) =>
        splits.map((sp, i) =>
          i !== splitIdx ? sp : { items: sp.items.map((it) => (it.name === name ? { ...it, qty } : it)).filter((it) => it.qty > 0) },
        ),
      );
    },
    addSplit(tableId) {
      updateTables(tableId, (splits) => [...(splits.length ? splits : [{ items: [] }]), { items: [] }]);
      const n = (get().data.tables[tableId] ?? []).length - 1;
      set({ activeSplit: n, cashInput: "" });
      return n;
    },
    removeSplit(tableId, idx) {
      const splits = get().data.tables[tableId] ?? [];
      if (splits.length <= 1 || splits[idx]?.items.length) return;
      updateTables(tableId, (sp) => sp.filter((_, i) => i !== idx));
      const len = splits.length - 1;
      set((s) => ({ activeSplit: Math.min(s.activeSplit, len - 1), cashInput: "" }));
    },
    clearSplit(tableId, splitIdx) {
      get().checkpoint("clear");
      updateTables(tableId, (splits) => splits.map((sp, i) => (i === splitIdx ? { items: [] } : sp)));
      set({ dialog: null, cashInput: "", sheetOpen: false });
      get().showToast({
        text: `${tableDisplayName(get().data.tableList, tableId)} cleared`,
        action: { label: "Undo", run: () => get().undo() },
      });
    },
    markPaid(tableId, splitIdx, cash) {
      const d = get().data;
      const splits = d.tables[tableId] ?? [];
      const split = splits[splitIdx];
      if (!split || !split.items.length) return null;
      const txn: Txn = {
        id: nextTxnId(d.history),
        table: tableId,
        items: split.items.map((i) => ({ ...i })),
        total: splitTotal(split),
        ts: new Date().toISOString(),
        ...(cash !== undefined && Number.isFinite(cash) ? { cash } : {}),
      };
      setData((dd) => ({
        ...dd,
        history: [...dd.history, txn],
        tables: { ...dd.tables, [tableId]: (dd.tables[tableId] ?? []).filter((_, i) => i !== splitIdx) },
      }));
      haptic.success();
      const remaining = get().data.tables[tableId] ?? [];
      const top = currentRoute(get());
      if (remaining.length === 0) {
        set({ justSettledTableId: tableId, cashInput: "", sheetOpen: false });
        if (top.name === "order" && top.tableId === tableId) {
          set({ stack: [{ name: "tables" }], navDir: -1, activeSplit: 0 });
        }
      } else {
        set({ activeSplit: 0, cashInput: "", sheetOpen: false });
      }
      return txn;
    },
    addTable(name) {
      const id = get().data.nextCustomId;
      setData((d) => ({
        ...d,
        nextCustomId: d.nextCustomId + 1,
        tableList: [...d.tableList, { id, name: name.trim().slice(0, 24), custom: true }],
        tables: { ...d.tables, [id]: [] },
      }));
      set({ dialog: null });
      return id;
    },
    removeTable(id) {
      const d = get().data;
      const t = d.tableList.find((x) => x.id === id);
      if (!t || !t.custom || (d.tables[id] ?? []).some((sp) => sp.items.length)) return;
      setData((dd) => {
        const tables = { ...dd.tables };
        delete tables[id];
        return { ...dd, tables, tableList: dd.tableList.filter((x) => x.id !== id) };
      });
      set({ dialog: null });
    },

    // ---------- menu ----------
    saveCategory(catId, name) {
      const clean = name.trim().slice(0, 24);
      if (!clean) return;
      setData((d) =>
        catId === null
          ? { ...d, nextMenuCatId: d.nextMenuCatId + 1, menu: [...d.menu, { id: d.nextMenuCatId, cat: clean, items: [] }] }
          : { ...d, menu: d.menu.map((c) => (c.id === catId ? { ...c, cat: clean } : c)) },
      );
      set({ dialog: null });
    },
    deleteCategory(catId) {
      setData((d) => {
        const cat = d.menu.find((c) => c.id === catId);
        if (!cat || cat.items.length) return d;
        return { ...d, menu: d.menu.filter((c) => c.id !== catId) };
      });
      set({ dialog: null });
    },
    saveMenuItem(catId, itemId, fields) {
      let savedId = itemId ?? 0;
      const name = fields.name.trim().slice(0, 40);
      const aliases = (fields.aliases ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 10);
      setData((d) => {
        const menu = d.menu.map((c) => {
          if (c.id !== catId) return c;
          if (itemId !== null) {
            return { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, name, price: fields.price, aliases } : i)) };
          }
          savedId = d.nextMenuItemId;
          return { ...c, items: [...c.items, { id: savedId, name, price: fields.price, aliases }] };
        });
        return { ...d, menu, nextMenuItemId: itemId === null ? d.nextMenuItemId + 1 : d.nextMenuItemId };
      });
      set({ dialog: null });
      return savedId;
    },
    deleteMenuItem(catId, itemId) {
      setData((d) => ({
        ...d,
        menu: d.menu.map((c) => (c.id === catId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c)),
      }));
      set({ dialog: null });
    },
    moveCategory(from, to) {
      setData((d) => {
        const menu = d.menu.slice();
        const [moved] = menu.splice(from, 1);
        if (!moved) return d;
        menu.splice(to, 0, moved);
        return { ...d, menu };
      });
    },
    moveMenuItem(catId, from, to) {
      setData((d) => ({
        ...d,
        menu: d.menu.map((c) => {
          if (c.id !== catId) return c;
          const items = c.items.slice();
          const [moved] = items.splice(from, 1);
          if (!moved) return c;
          items.splice(to, 0, moved);
          return { ...c, items };
        }),
      }));
    },

    // ---------- settings ----------
    updateSettings(patch) {
      setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
      if (patch.haptics !== undefined) setHapticsEnabled(patch.haptics);
    },
    setTheme(theme) {
      get().updateSettings({ theme });
    },

    // ---------- sales history ----------
    setPeriod(period) {
      set((s) => ({ summary: { ...s.summary, period }, expandedTxnId: null, expandedDayKey: null }));
    },
    setCustomRange(from, to) {
      if (to < from) [from, to] = [to, from];
      set({ summary: { period: "custom", from, to }, expandedTxnId: null, expandedDayKey: null, dialog: null });
    },
    toggleTxn(id) {
      set((s) => ({ expandedTxnId: s.expandedTxnId === id ? null : id }));
    },
    toggleDay(key) {
      set((s) => ({ expandedDayKey: s.expandedDayKey === key ? null : key, expandedTxnId: null }));
    },
    askRestoreTxn(txnId) {
      const d = get().data;
      const h = d.history.find((x) => x.id === txnId);
      if (!h) return;
      set({ dialog: { type: "confirm-restore-txn", txnId, tableId: h.table, tableExists: d.tableList.some((t) => t.id === h.table) } });
    },
    restoreTxn(txnId) {
      const d = get().data;
      const h = d.history.find((x) => x.id === txnId);
      if (!h || !d.tableList.some((t) => t.id === h.table)) {
        set({ dialog: null });
        return;
      }
      setData((dd) => ({
        ...dd,
        history: dd.history.filter((x) => x.id !== txnId),
        tables: { ...dd.tables, [h.table]: [...(dd.tables[h.table] ?? []).filter((sp) => sp.items.length), { items: h.items.map((i) => ({ ...i })) }] },
      }));
      set({ dialog: null, expandedTxnId: null });
      get().showToast({ text: `Restored to ${tableDisplayName(d.tableList, h.table)}`, tone: "success" });
    },
    askDeleteTxn(txnId) {
      if (!get().data.history.some((x) => x.id === txnId)) return;
      set({ dialog: { type: "confirm-delete-txn", txnId, code: generateVerifyCode() } });
    },
    deleteTxn(txnId) {
      setData((d) => ({ ...d, history: d.history.filter((x) => x.id !== txnId) }));
      set({ dialog: null, expandedTxnId: null });
      get().showToast({ text: "Order deleted from sales records", tone: "danger" });
    },
    askResetToday() {
      set({ dialog: { type: "confirm-reset", code: generateVerifyCode() } });
    },
    resetToday() {
      const d = get().data;
      const key = businessDayKey(new Date(), d.settings);
      setData((dd) => ({ ...dd, history: dd.history.filter((h) => businessDayKey(new Date(h.ts), dd.settings) !== key) }));
      set({ dialog: null });
      get().showToast({ text: "Today’s sales were reset" });
    },

    // ---------- whole-data operations ----------
    replaceData(data) {
      set({ data, dialog: null, stack: [{ name: "tables" }], navDir: -1, undoStack: [] });
      setHapticsEnabled(data.settings.haptics);
      if (persistenceEnabled) void replaceAll(data).catch(reportStorageError);
    },
    checkpoint(label) {
      set((s) => ({ undoStack: [...s.undoStack.slice(-9), { label, data: s.data }] }));
    },
    undo() {
      const stack = get().undoStack;
      const last = stack[stack.length - 1];
      if (!last) return null;
      set({ undoStack: stack.slice(0, -1) });
      setData(() => last.data);
      set((s) => ({ activeSplit: Math.min(s.activeSplit, Math.max(0, (last.data.tables[(currentRoute(s) as { tableId?: number }).tableId ?? -1]?.length ?? 1) - 1)) }));
      return last.label;
    },
    setData,
  };
});
