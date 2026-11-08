// Converting legacy saved data (localStorage v1–v15) and backup files into
// the current AppData shape. Everything here is defensive: inputs come from
// old app versions or from files the user picks, so nothing is trusted.

import { DEFAULT_SETTINGS, freshData } from "./defaults";
import type { AppData, Expense, MenuCategory, MoneyMethod, OrderItem, PayMethod, Settings, Split, TableDef, Txn, UtangPayment } from "./types";

export const LEGACY_STORAGE_KEY = "order_board_streetfood_v1";
export const BACKUP_TYPE = "order-board-full-backup";

type Loose = Record<string, unknown>;

const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const isoOr = (v: unknown): string | undefined => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);
const PAY_METHODS: PayMethod[] = ["cash", "gcash", "maya", "utang"];
const MONEY_METHODS: MoneyMethod[] = ["cash", "gcash", "maya"];

/** keepServed: open bills track serving; paid records don't. */
function cleanItems(v: unknown, keepServed = false): OrderItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((i) => {
    const qty = Math.max(1, Math.round(num(i.qty, 1)));
    const note = typeof i.note === "string" ? i.note.trim().slice(0, 60) : "";
    const served = keepServed && typeof i.served === "number" ? Math.max(0, Math.min(qty, Math.round(i.served))) : 0;
    return { name: str(i.name, "Item"), price: num(i.price, 0), qty, ...(note ? { note } : {}), ...(served ? { served } : {}) };
  });
}

function cleanSplit(sp: Loose): Split {
  const items = cleanItems(sp.items, true);
  const openedAt = items.length ? isoOr(sp.openedAt) : undefined;
  return { items, ...(openedAt ? { openedAt } : {}) };
}

/**
 * Older data stored each table as a flat item array; newer data stores an
 * array of splits, each holding its own items.
 */
export function migrateTables(raw: unknown): Record<string, Split[]> {
  const out: Record<string, Split[]> = {};
  if (!isObj(raw)) return out;
  for (const key of Object.keys(raw)) {
    const val = raw[key];
    if (!Array.isArray(val) || val.length === 0) {
      out[key] = [];
    } else if (isObj(val[0]) && "items" in val[0]) {
      out[key] = val.filter(isObj).map(cleanSplit);
    } else {
      out[key] = [{ items: cleanItems(val, true) }];
    }
  }
  return out;
}

function cleanTableList(v: unknown): TableDef[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(isObj).map((t) => ({ id: num(t.id, 0), name: str(t.name, "?"), custom: !!t.custom }));
}

function cleanMenu(v: unknown): MenuCategory[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(isObj).map((c) => ({
    id: num(c.id, 0),
    cat: str(c.cat, "Menu"),
    items: Array.isArray(c.items)
      ? c.items.filter(isObj).map((i) => ({
          id: num(i.id, 0),
          name: str(i.name, "Item"),
          price: num(i.price, 0),
          ...(Array.isArray(i.aliases) ? { aliases: i.aliases.filter((a): a is string => typeof a === "string") } : {}),
          ...(typeof i.soldOut === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.soldOut) ? { soldOut: i.soldOut } : {}),
        }))
      : [],
  }));
}

function cleanHistory(v: unknown): Txn[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<number>();
  const out: Txn[] = [];
  for (const h of v) {
    if (!isObj(h)) continue;
    let id = num(h.id, Date.now());
    while (seen.has(id)) id++;
    seen.add(id);
    const items = cleanItems(h.items);
    const ts = str(h.ts, new Date().toISOString());
    out.push({
      id,
      table: num(h.table, 0),
      items,
      total: num(h.total, items.reduce((s, i) => s + i.price * i.qty, 0)),
      ts: Number.isNaN(Date.parse(ts)) ? new Date().toISOString() : ts,
      ...(typeof h.cash === "number" ? { cash: h.cash } : {}),
      ...cleanPaymentInfo(h),
    });
  }
  return out;
}

function cleanPaymentInfo(h: Loose): Pick<Txn, "method" | "customer" | "payments"> {
  const method = PAY_METHODS.includes(h.method as PayMethod) ? (h.method as PayMethod) : undefined;
  if (!method || method === "cash") return {};
  if (method !== "utang") return { method };
  const payments: UtangPayment[] = Array.isArray(h.payments)
    ? h.payments.filter(isObj).flatMap((p) => {
        const ts = isoOr(p.ts);
        const amount = num(p.amount, 0);
        if (!ts || amount <= 0) return [];
        return [{ ts, amount, method: MONEY_METHODS.includes(p.method as MoneyMethod) ? (p.method as MoneyMethod) : "cash" }];
      })
    : [];
  const customer = str(h.customer, "").trim().slice(0, 40) || "Customer";
  return { method, customer, ...(payments.length ? { payments } : {}) };
}

function cleanExpenses(v: unknown): Expense[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<number>();
  const out: Expense[] = [];
  for (const e of v) {
    if (!isObj(e)) continue;
    const ts = isoOr(e.ts);
    const amount = num(e.amount, 0);
    if (!ts || amount <= 0) continue;
    let id = num(e.id, Date.parse(ts));
    while (seen.has(id)) id++;
    seen.add(id);
    out.push({ id, ts, amount, what: str(e.what, "Expense").trim().slice(0, 40) || "Expense" });
  }
  return out;
}

function cleanSettings(raw: Loose): Settings {
  // Legacy data kept these fields at the top level; new data nests them.
  const s = isObj(raw.settings) ? raw.settings : raw;
  const agent = isObj(s.agent) ? s.agent : {};
  const theme = s.theme === "light" || s.theme === "dark" || s.theme === "system" ? s.theme : DEFAULT_SETTINGS.theme;
  const time = (v: unknown, d: string) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : d);
  return {
    theme,
    businessName: str(s.businessName, "").slice(0, 40),
    workStart: time(s.workStart, DEFAULT_SETTINGS.workStart),
    workEnd: time(s.workEnd, DEFAULT_SETTINGS.workEnd),
    haptics: typeof s.haptics === "boolean" ? s.haptics : true,
    agent: {
      voiceReplies: typeof agent.voiceReplies === "boolean" ? agent.voiceReplies : DEFAULT_SETTINGS.agent.voiceReplies,
      confirmAdds: typeof agent.confirmAdds === "boolean" ? agent.confirmAdds : DEFAULT_SETTINGS.agent.confirmAdds,
      handsFree: typeof agent.handsFree === "boolean" ? agent.handsFree : DEFAULT_SETTINGS.agent.handsFree,
    },
    acceptedLegalVersion: typeof s.acceptedLegalVersion === "string" ? s.acceptedLegalVersion : null,
    backupReminder: typeof s.backupReminder === "boolean" ? s.backupReminder : DEFAULT_SETTINGS.backupReminder,
    lastBackupAt: isoOr(s.lastBackupAt) ?? null,
    backupSnoozeUntil: isoOr(s.backupSnoozeUntil) ?? null,
  };
}

/** Looks like legacy app state or a backup file (either generation). */
export function looksLikeAppData(v: unknown): v is Loose {
  return isObj(v) && "tables" in v && "history" in v;
}

/** Normalizes legacy app state or any backup file into AppData. */
export function normalizeAppData(raw: Loose): AppData {
  const base = freshData();
  const tableList = cleanTableList(raw.tableList) ?? base.tableList;
  const tables = migrateTables(raw.tables);
  for (const t of tableList) if (!tables[t.id]) tables[t.id] = [];
  const menu = cleanMenu(raw.menu) ?? base.menu;
  const maxCat = menu.reduce((m, c) => Math.max(m, c.id), 0);
  const maxItem = menu.reduce((m, c) => c.items.reduce((mm, i) => Math.max(mm, i.id), m), 0);
  const maxTable = tableList.reduce((m, t) => Math.max(m, t.id), 0);
  return {
    tables,
    tableList,
    nextCustomId: Math.max(num(raw.nextCustomId, 5), maxTable + 1),
    menu,
    nextMenuCatId: Math.max(num(raw.nextMenuCatId, 7), maxCat + 1),
    nextMenuItemId: Math.max(num(raw.nextMenuItemId, 16), maxItem + 1),
    settings: cleanSettings(raw),
    expenses: cleanExpenses(raw.expenses),
    history: cleanHistory(raw.history),
  };
}

export function toBackup(data: AppData, now = new Date()) {
  return { _backupType: BACKUP_TYPE, _exportedAt: now.toISOString(), _format: 2, ...data };
}
