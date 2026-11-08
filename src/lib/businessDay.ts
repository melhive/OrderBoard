// Business-day logic: a stall that works 6 PM – 2 AM should count a 1 AM sale
// as part of the previous evening's shift. The day "rolls over" halfway
// through the off-hours gap between closing and opening.

import type { Period, Txn } from "../data/types";
import { fmtDayLabel, pad2 } from "./format";

export interface Hours {
  workStart: string;
  workEnd: string;
}

export function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || "00:00").split(":");
  return (parseInt(h ?? "0", 10) || 0) * 60 + (parseInt(m ?? "0", 10) || 0);
}

export function formatMinutesAsTime(min: number): string {
  min = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad2(m)} ${ampm}`;
}

export function computeCutoffMinutes(hours: Hours): number {
  const startMin = parseTimeToMinutes(hours.workStart);
  const endMin = parseTimeToMinutes(hours.workEnd);
  let offDuration = (startMin - endMin + 1440) % 1440;
  if (offDuration === 0) offDuration = 1440;
  return Math.round((endMin + offDuration / 2) % 1440);
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
  return new Date(y!, m! - 1, d!);
}

export function businessDayKey(date: Date, hours: Hours): string {
  const shifted = new Date(date.getTime() - computeCutoffMinutes(hours) * 60000);
  return isoDate(shifted);
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export interface PeriodSpec {
  period: Period;
  from?: string | null;
  to?: string | null;
}

export function txnsForPeriod(history: Txn[], spec: PeriodSpec, hours: Hours, now: Date = new Date()): Txn[] {
  const { period } = spec;
  if (period === "all") return history.slice();
  if (period === "today") {
    const key = businessDayKey(now, hours);
    return history.filter((h) => businessDayKey(new Date(h.ts), hours) === key);
  }
  if (period === "custom") {
    const { from, to } = spec;
    if (!from || !to) return [];
    return history.filter((h) => {
      const key = businessDayKey(new Date(h.ts), hours);
      return key >= from && key <= to;
    });
  }
  const refDate = parseISODate(businessDayKey(now, hours));
  const startKey = isoDate(period === "week" ? startOfWeek(refDate) : startOfMonth(refDate));
  return history.filter((h) => businessDayKey(new Date(h.ts), hours) >= startKey);
}

export function isSingleDay(spec: PeriodSpec): boolean {
  if (spec.period === "today") return true;
  if (spec.period === "custom") return !!(spec.from && spec.from === spec.to);
  return false;
}

export function periodLabel(spec: PeriodSpec): string {
  switch (spec.period) {
    case "today": return "Today’s";
    case "week": return "This Week’s";
    case "month": return "This Month’s";
    case "all": return "All-Time";
    case "custom": {
      if (!spec.from || !spec.to) return "That Day’s";
      if (spec.from === spec.to) return fmtDayLabel(parseISODate(spec.from));
      return `${fmtDayLabel(parseISODate(spec.from))} – ${fmtDayLabel(parseISODate(spec.to))}`;
    }
  }
}

export interface DayGroup {
  key: string;
  date: Date;
  total: number;
  orders: number;
}

export function groupByDay(txns: Txn[], hours: Hours): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const h of txns) {
    const key = businessDayKey(new Date(h.ts), hours);
    let g = map.get(key);
    if (!g) {
      g = { key, date: parseISODate(key), total: 0, orders: 0 };
      map.set(key, g);
    }
    g.total += h.total;
    g.orders += 1;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

export interface SalesSummary {
  total: number;
  orders: number;
  itemsSold: number;
  best: { name: string; qty: number; revenue: number }[];
  txns: Txn[];
}

export function summarize(txns: Txn[]): SalesSummary {
  let total = 0;
  let itemsSold = 0;
  const tally = new Map<string, { qty: number; revenue: number }>();
  for (const h of txns) {
    total += h.total;
    for (const it of h.items) {
      itemsSold += it.qty;
      const t = tally.get(it.name) ?? { qty: 0, revenue: 0 };
      t.qty += it.qty;
      t.revenue += it.qty * it.price;
      tally.set(it.name, t);
    }
  }
  const best = [...tally.entries()]
    .map(([name, t]) => ({ name, qty: t.qty, revenue: t.revenue }))
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  return { total, orders: txns.length, itemsSold, best, txns };
}
