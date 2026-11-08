// Converting legacy saved data (localStorage v1–v15) and backup files into
// the current AppData shape. Everything here is defensive: inputs come from
// old app versions or from files the user picks, so nothing is trusted.

import { DEFAULT_SETTINGS, freshData } from "./defaults";
import type { AppData, MenuCategory, Settings, Split, TableDef, Txn } from "./types";

export const LEGACY_STORAGE_KEY = "order_board_streetfood_v1";
export const BACKUP_TYPE = "order-board-full-backup";

type Loose = Record<string, unknown>;

const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

function cleanItems(v: unknown) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .map((i) => ({ name: str(i.name, "Item"), price: num(i.price, 0), qty: Math.max(1, Math.round(num(i.qty, 1))) }));
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
      out[key] = val.filter(isObj).map((sp) => ({ items: cleanItems(sp.items) }));
    } else {
      out[key] = [{ items: cleanItems(val) }];
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
    });
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
    history: cleanHistory(raw.history),
  };
}

export function toBackup(data: AppData, now = new Date()) {
  return { _backupType: BACKUP_TYPE, _exportedAt: now.toISOString(), _format: 2, ...data };
}
