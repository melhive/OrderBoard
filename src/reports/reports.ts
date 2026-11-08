import type { TableDef, Txn } from "../data/types";
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
  now?: Date;
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
  rows.push([]);
  rows.push(["BEST SELLERS"]);
  rows.push(["Item", "Qty Sold", "Revenue (PHP)"]);
  for (const b of summary.best) rows.push([b.name, b.qty, b.revenue]);
  rows.push([]);
  if (isSingleDay(spec)) {
    rows.push(["TRANSACTIONS"]);
    rows.push(["Time", "Table", "Items", "Total (PHP)"]);
    for (const h of summary.txns) {
      rows.push([fmtTime(h.ts), tableDisplayName(tableList, h.table), h.items.map((i) => `${i.qty}x ${i.name}`).join("; "), h.total]);
    }
  } else {
    rows.push(["DAILY BREAKDOWN"]);
    rows.push(["Date", "Orders", "Total (PHP)"]);
    for (const d of groupByDay(txns, hours)) rows.push([fmtDayLabel(d.date), d.orders, d.total]);
  }
  rows.push(["", "", "TOTAL", summary.total]);
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
    detail = `<table class="pr-table"><thead><tr><th>Time</th><th>Table</th><th>Items</th><th class="num">Total</th></tr></thead><tbody>${summary.txns
      .map((h) => `<tr><td>${fmtTime(h.ts)}</td><td>${esc(tableDisplayName(tableList, h.table))}</td><td>${h.items.map((i) => `${i.qty}x ${esc(i.name)}`).join(", ")}</td><td class="num">${peso(h.total)}</td></tr>`)
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
    `<div class="pr-section-title">Best Sellers</div><table class="pr-table"><thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Revenue</th></tr></thead><tbody>${bestRows}</tbody></table>` +
    `<div class="pr-section-title">${detailTitle}</div>${detail}` +
    `<div class="pr-footer">Generated ${gen} &middot; Order Board</div>`
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
