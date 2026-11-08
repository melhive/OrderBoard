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

/** Adds qty of an item to a list, merging with an identical existing line. Returns a new array. */
export function addToItems(items: OrderItem[], name: string, price: number, qty = 1): OrderItem[] {
  const idx = items.findIndex((i) => i.name === name && i.price === price);
  if (idx >= 0) {
    return items.map((it, i) => (i === idx ? { ...it, qty: it.qty + qty } : it));
  }
  return [...items, { name, price, qty }];
}
