import type { OrderItem, Split, TableDef } from "../data/types";

export function splitTotal(split: Split | undefined): number {
  return split ? split.items.reduce((s, i) => s + i.price * i.qty, 0) : 0;
}

export function splitCount(split: Split | undefined): number {
  return split ? split.items.reduce((s, i) => s + i.qty, 0) : 0;
}

export function tableTotal(splits: Split[] | undefined): number {
  return (splits ?? []).reduce((s, sp) => s + splitTotal(sp), 0);
}

export function tableCount(splits: Split[] | undefined): number {
  return (splits ?? []).reduce((s, sp) => s + splitCount(sp), 0);
}

export function tableDisplayName(tableList: TableDef[], id: number): string {
  const t = tableList.find((x) => x.id === id);
  if (!t) return `Table ${id}`;
  return t.custom ? t.name : `Table ${t.name}`;
}

const sameNote = (a?: string, b?: string) => (a ?? "") === (b ?? "");

/** Adds qty of an item to a list, merging with an identical existing line (same name, price and note). Returns a new array. */
export function addToItems(items: OrderItem[], name: string, price: number, qty = 1, note?: string): OrderItem[] {
  const n = note?.trim().slice(0, 60) || undefined;
  const idx = items.findIndex((i) => i.name === name && i.price === price && sameNote(i.note, n));
  if (idx >= 0) {
    return items.map((it, i) => (i === idx ? { ...it, qty: it.qty + qty } : it));
  }
  return [...items, { name, price, qty, ...(n ? { note: n } : {}) }];
}

/** Items on a split not yet served. */
export function unservedCount(split: Split | undefined): number {
  return split ? split.items.reduce((s, i) => s + Math.max(0, i.qty - (i.served ?? 0)), 0) : 0;
}

export function tableUnserved(splits: Split[] | undefined): number {
  return (splits ?? []).reduce((s, sp) => s + unservedCount(sp), 0);
}

/** Earliest open time across a table's bills (ISO), if any. */
export function tableOpenedAt(splits: Split[] | undefined): string | null {
  let best: string | null = null;
  for (const sp of splits ?? []) if (sp.items.length && sp.openedAt && (!best || sp.openedAt < best)) best = sp.openedAt;
  return best;
}

/** "5 min", "1 h 20 min" */
export function fmtElapsed(fromIso: string, now: Date = new Date()): string {
  const min = Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function minutesSince(fromIso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 60000));
}
