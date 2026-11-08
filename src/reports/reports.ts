import type { Expense, TableDef, Txn } from "../data/types";
import { METHOD_LABEL, methodOf, moneyBreakdown, expensesForPeriod } from "../lib/money";
import {
  type Hours,
  type PeriodSpec,
  groupByDay,
  isSingleDay,
  parseISODate,
  summarize,
} from "../lib/businessDay";
import { fmtDayLabel, fmtLongDate, fmtTime, peso } from "../lib/format";
import { tableDisplayName } from "../lib/bill";

export interface ReportInput {
  spec: PeriodSpec;
  txns: Txn[];
  hours: Hours;
  businessName: string;
  tableList: TableDef[];
  /** All expenses and full history (for utang collected in the period). Optional for older callers. */
  expenses?: Expense[];
  history?: Txn[];
  now?: Date;
}

function payLabel(h: Txn): string {
  const m = methodOf(h);
  return m === "utang" ? `Utang (${h.customer ?? ""})` : METHOD_LABEL[m];
}

function titleWord(spec: PeriodSpec): string {
  if (isSingleDay(spec)) return "Daily";
  return { week: "Weekly", month: "Monthly", custom: "Custom Range", all: "All-Time", today: "Daily" }[spec.period];
}

export function reportDateParts(spec: PeriodSpec, now = new Date()): { iso: string; long: string } {
  if (spec.period === "custom" && spec.from && spec.to) {
    if (spec.from === spec.to) return { iso: spec.from, long: fmtLongDate(parseISODate(spec.from)) };
    const f = parseISODate(spec.from);
    return {
      iso: `${spec.from}_to_${spec.to}`,
      long: `${f.toLocaleDateString("en-PH", { month: "long", day: "numeric" })} – ${fmtLongDate(parseISODate(spec.to))}`,
    };
  }
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { iso, long: fmtLongDate(now) };
}

export function buildCSV(input: ReportInput): { filename: string; csv: string } {
  const { spec, txns, hours, tableList } = input;
  const summary = summarize(txns);
  const dp = reportDateParts(spec, input.now);
  const brand = input.businessName || "Order Board";
  const rows: (string | number)[][] = [];
  rows.push([`${brand} - ${titleWord(spec)} Sales Report`]);
  rows.push(["Date", dp.iso]);
  rows.push([]);
  rows.push(["SUMMARY"]);
  rows.push(["Total Earnings (PHP)", summary.total]);
  rows.push(["Orders", summary.orders]);
  rows.push(["Items Sold", summary.itemsSold]);
  const money = moneyBreakdown(input.history ?? txns, input.expenses ?? [], spec, hours, input.now);
  rows.push([]);
  rows.push(["MONEY"]);
  rows.push(["Cash sales (PHP)", money.sales.cash]);
  rows.push(["GCash sales (PHP)", money.sales.gcash]);
  rows.push(["Maya sales (PHP)", money.sales.maya]);
  rows.push(["Utang sales (PHP)", money.sales.utang]);
  rows.push(["Utang collected (PHP)", money.collected.cash + money.collected.gcash + money.collected.maya]);
  rows.push(["Money received (PHP)", money.received]);
  rows.push(["Expenses (PHP)", money.expenses]);
  rows.push(["Profit: sales - expenses (PHP)", money.profit]);
  const exps = expensesForPeriod(input.expenses ?? [], spec, hours, input.now);
  if (exps.length) {
    rows.push([]);
    rows.push(["EXPENSES"]);
    rows.push(["Date", "Time", "What", "Amount (PHP)"]);
    for (const e of exps) rows.push([new Date(e.ts).toLocaleDateString("en-PH"), fmtTime(e.ts), e.what, e.amount]);
  }
  rows.push([]);
  rows.push(["BEST SELLERS"]);
  rows.push(["Item", "Qty Sold", "Revenue (PHP)"]);
  for (const b of summary.best) rows.push([b.name, b.qty, b.revenue]);
  rows.push([]);
  if (isSingleDay(spec)) {
    rows.push(["TRANSACTIONS"]);
    rows.push(["Time", "Table", "Items", "Paid by", "Total (PHP)"]);
    for (const h of summary.txns) {
      rows.push([fmtTime(h.ts), tableDisplayName(tableList, h.table), h.items.map((i) => `${i.qty}x ${i.name}${i.note ? ` (${i.note})` : ""}`).join("; "), payLabel(h), h.total]);
    }
  } else {
    rows.push(["DAILY BREAKDOWN"]);
    rows.push(["Date", "Orders", "Total (PHP)"]);
    for (const d of groupByDay(txns, hours)) rows.push([fmtDayLabel(d.date), d.orders, d.total]);
  }
  rows.push(["", "", "", "TOTAL", summary.total]);
  // Leading BOM so Excel opens the peso sign and names correctly.
  const csv = "﻿" + rows.map((r) => r.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  return { filename: `orderboard_${spec.period}_report_${dp.iso}.csv`, csv };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Letterhead-style printable report; printed via the system print dialog (Save as PDF). */
export function buildReportHTML(input: ReportInput): string {
  const { spec, txns, hours, tableList } = input;
  const summary = summarize(txns);
  const dp = reportDateParts(spec, input.now);
  const gen = (input.now ?? new Date()).toLocaleString("en-PH", { hour: "numeric", minute: "2-digit" });
  const bestRows = summary.best.length
    ? summary.best.map((b, i) => `<tr><td>${i + 1}</td><td>${esc(b.name)}</td><td class="num">${b.qty}</td><td class="num">${peso(b.revenue)}</td></tr>`).join("")
    : `<tr><td colspan="4" class="muted">No sales recorded</td></tr>`;
  let detailTitle: string;
  let detail: string;
  if (isSingleDay(spec)) {
    detailTitle = "Transactions";
    detail = `<table class="pr-table"><thead><tr><th>Time</th><th>Table</th><th>Items</th><th>Paid by</th><th class="num">Total</th></tr></thead><tbody>${summary.txns
      .map((h) => `<tr><td>${fmtTime(h.ts)}</td><td>${esc(tableDisplayName(tableList, h.table))}</td><td>${h.items.map((i) => `${i.qty}x ${esc(i.name)}`).join(", ")}</td><td>${esc(payLabel(h))}</td><td class="num">${peso(h.total)}</td></tr>`)
      .join("")}</tbody></table>`;
  } else {
    detailTitle = "Daily Breakdown";
    detail = `<table class="pr-table"><thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Total</th></tr></thead><tbody>${groupByDay(txns, hours)
      .map((d) => `<tr><td>${fmtDayLabel(d.date)}</td><td class="num">${d.orders}</td><td class="num">${peso(d.total)}</td></tr>`)
      .join("")}</tbody></table>`;
  }
  return (
    `<div class="pr-header"><div class="pr-kicker">${titleWord(spec)} Sales Report</div>` +
    `<div class="pr-brand">${esc(input.businessName || "Order Board")}</div><div class="pr-date">${dp.long}</div></div>` +
    `<div class="pr-stats"><div class="pr-stat"><div class="pr-stat-n">${peso(summary.total)}</div><div class="pr-stat-l">Total Earnings</div></div>` +
    `<div class="pr-stat"><div class="pr-stat-n">${summary.orders}</div><div class="pr-stat-l">Orders</div></div>` +
    `<div class="pr-stat"><div class="pr-stat-n">${summary.itemsSold}</div><div class="pr-stat-l">Items Sold</div></div></div>` +
    moneyHTML(input) +
    `<div class="pr-section-title">Best Sellers</div><table class="pr-table"><thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Revenue</th></tr></thead><tbody>${bestRows}</tbody></table>` +
    `<div class="pr-section-title">${detailTitle}</div>${detail}` +
    `<div class="pr-footer">Generated ${gen} &middot; Order Board</div>`
  );
}

function moneyHTML(input: ReportInput): string {
  const m = moneyBreakdown(input.history ?? input.txns, input.expenses ?? [], input.spec, input.hours, input.now);
  const collected = m.collected.cash + m.collected.gcash + m.collected.maya;
  const row = (l: string, v: string, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><td>${l}</td><td class="num">${v}</td></tr>`;
  const exps = expensesForPeriod(input.expenses ?? [], input.spec, input.hours, input.now);
  return (
    `<div class="pr-section-title">Money</div><table class="pr-table"><tbody>` +
    row("Cash sales", peso(m.sales.cash)) +
    (m.sales.gcash ? row("GCash sales", peso(m.sales.gcash)) : "") +
    (m.sales.maya ? row("Maya sales", peso(m.sales.maya)) : "") +
    (m.sales.utang ? row("Utang (sold on credit)", peso(m.sales.utang)) : "") +
    (collected ? row("Utang collected", peso(collected)) : "") +
    row("Money received", peso(m.received)) +
    row("Expenses", `−${peso(m.expenses)}`) +
    row("<b>Profit (sales − expenses)</b>", `<b>${peso(m.profit)}</b>`) +
    `</tbody></table>` +
    (exps.length
      ? `<div class="pr-section-title">Expenses</div><table class="pr-table"><thead><tr><th>Date</th><th>What</th><th class="num">Amount</th></tr></thead><tbody>${exps
          .map((e) => `<tr><td>${fmtDayLabel(new Date(e.ts))} ${fmtTime(e.ts)}</td><td>${esc(e.what)}</td><td class="num">${peso(e.amount)}</td></tr>`)
          .join("")}</tbody></table>`
      : "")
  );
}

export function printReport(html: string) {
  let el = document.getElementById("print-report");
  if (!el) {
    el = document.createElement("div");
    el.id = "print-report";
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  window.print();
}
