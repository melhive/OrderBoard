// Money beyond plain sales: payment methods, utang (credit), expenses and
// profit. Sales (what was sold) are counted on the business day of the order;
// money collected for utang counts on the business day it was paid.

import type { Expense, MenuItem, MoneyMethod, PayMethod, Settings, Txn } from "../data/types";
import { businessDayKey, txnsForPeriod, type Hours, type PeriodSpec } from "./businessDay";

export const METHOD_LABEL: Record<PayMethod, string> = { cash: "Cash", gcash: "GCash", maya: "Maya", utang: "Utang" };

export const methodOf = (t: Txn): PayMethod => t.method ?? "cash";

export function utangPaid(t: Txn): number {
  return (t.payments ?? []).reduce((s, p) => s + p.amount, 0);
}

/** What is still owed on a sale (0 for anything but unpaid utang). */
export function utangBalance(t: Txn): number {
  return methodOf(t) === "utang" ? Math.max(0, t.total - utangPaid(t)) : 0;
}

export const customerKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export interface UtangAccount {
  key: string;
  name: string;
  balance: number;
  /** Open (not fully paid) sales, oldest first. */
  open: Txn[];
  /** Every utang sale for this person, oldest first. */
  all: Txn[];
  /** ISO time of the oldest unpaid sale. */
  since: string | null;
}

/** Everyone who has bought on credit, biggest balance first. */
export function utangAccounts(history: Txn[]): UtangAccount[] {
  const map = new Map<string, UtangAccount>();
  for (const t of history) {
    if (methodOf(t) !== "utang") continue;
    const name = t.customer?.trim() || "Customer";
    const key = customerKey(name);
    let a = map.get(key);
    if (!a) {
      a = { key, name, balance: 0, open: [], all: [], since: null };
      map.set(key, a);
    }
    a.name = name; // latest spelling wins
    a.all.push(t);
    const bal = utangBalance(t);
    if (bal > 0) {
      a.balance += bal;
      a.open.push(t);
      if (!a.since || t.ts < a.since) a.since = t.ts;
    }
  }
  return [...map.values()].sort((x, y) => y.balance - x.balance || x.name.localeCompare(y.name));
}

export function findAccount(history: Txn[], name: string): UtangAccount | null {
  const k = customerKey(name);
  return utangAccounts(history).find((a) => a.key === k) ?? null;
}

/** Splits a payment over a person's unpaid sales, oldest first. Returns per-txn amounts and any overpayment. */
export function allocateUtangPayment(account: UtangAccount, amount: number): { txnId: number; amount: number }[] {
  let left = amount;
  const out: { txnId: number; amount: number }[] = [];
  for (const t of account.open) {
    if (left <= 0) break;
    const pay = Math.min(left, utangBalance(t));
    if (pay > 0) out.push({ txnId: t.id, amount: pay });
    left -= pay;
  }
  return out;
}

export interface MoneyBreakdown {
  /** Sales in the period by how they were paid. */
  sales: Record<PayMethod, number>;
  /** Utang payments collected in the period, by method. */
  collected: Record<MoneyMethod, number>;
  /** Money actually received in the period: paid sales + utang collected. */
  received: number;
  expenses: number;
  /** Sales minus expenses. */
  profit: number;
  salesTotal: number;
}

function inSpec(iso: string, spec: PeriodSpec, hours: Hours, now: Date): boolean {
  // Reuse the sales period filter by wrapping the time in a fake transaction.
  return txnsForPeriod([{ id: 0, table: 0, items: [], total: 0, ts: iso }], spec, hours, now).length > 0;
}

export function expensesForPeriod(expenses: Expense[], spec: PeriodSpec, hours: Hours, now: Date = new Date()): Expense[] {
  return expenses.filter((e) => inSpec(e.ts, spec, hours, now));
}

export function moneyBreakdown(history: Txn[], expenses: Expense[], spec: PeriodSpec, hours: Hours, now: Date = new Date()): MoneyBreakdown {
  const sales: Record<PayMethod, number> = { cash: 0, gcash: 0, maya: 0, utang: 0 };
  const collected: Record<MoneyMethod, number> = { cash: 0, gcash: 0, maya: 0 };
  for (const t of txnsForPeriod(history, spec, hours, now)) sales[methodOf(t)] += t.total;
  for (const t of history) {
    for (const p of t.payments ?? []) if (inSpec(p.ts, spec, hours, now)) collected[p.method] += p.amount;
  }
  const exp = expensesForPeriod(expenses, spec, hours, now).reduce((s, e) => s + e.amount, 0);
  const salesTotal = sales.cash + sales.gcash + sales.maya + sales.utang;
  const received = sales.cash + sales.gcash + sales.maya + collected.cash + collected.gcash + collected.maya;
  return { sales, collected, received, expenses: exp, profit: salesTotal - exp, salesTotal };
}

// ---------- sold out ----------

export function isSoldOut(item: Pick<MenuItem, "soldOut">, settings: Hours, now: Date = new Date()): boolean {
  return !!item.soldOut && item.soldOut === businessDayKey(now, settings);
}

// ---------- backup reminder ----------

const DAY = 24 * 3600e3;

/** Whether to nudge for a backup: there's data worth protecting and the last backup is old (or never). */
export function backupDue(settings: Settings, history: Txn[], now: Date = new Date()): boolean {
  if (!settings.backupReminder || !history.length) return false;
  if (settings.backupSnoozeUntil && Date.parse(settings.backupSnoozeUntil) > now.getTime()) return false;
  if (settings.lastBackupAt) return now.getTime() - Date.parse(settings.lastBackupAt) >= 7 * DAY;
  const oldest = history.reduce((m, t) => (t.ts < m ? t.ts : m), history[0]!.ts);
  return now.getTime() - Date.parse(oldest) >= 3 * DAY || history.length >= 30;
}
