// Facts about tonight for the persona layer (persona.ts), read from app data.

import type { AppData } from "../data/types";
import { minutesSince, tableDisplayName, tableOpenedAt, tableTotal } from "../lib/bill";
import { addDays, businessDayKey, summarize, txnsForPeriod } from "../lib/businessDay";
import { backupDue } from "../lib/money";
import type { PersonaFacts } from "./persona";

export function personaFacts(data: AppData, now: Date = new Date()): PersonaFacts {
  const today = summarize(txnsForPeriod(data.history, { period: "today" }, data.settings, now));
  const y = addDays(businessDayKey(now, data.settings), -1);
  const yesterday = summarize(txnsForPeriod(data.history, { period: "custom", from: y, to: y }, data.settings, now));
  let openTables = 0;
  let unpaid = 0;
  let longestWait = 0;
  let longestWaitTable: string | undefined;
  for (const t of data.tableList) {
    const splits = data.tables[t.id] ?? [];
    const total = tableTotal(splits);
    if (!splits.some((s) => s.items.length)) continue;
    openTables++;
    unpaid += total;
    const opened = tableOpenedAt(splits);
    const wait = opened ? minutesSince(opened, now) : 0;
    if (wait > longestWait) {
      longestWait = wait;
      longestWaitTable = tableDisplayName(data.tableList, t.id);
    }
  }
  return {
    hour: now.getHours(),
    ownerName: data.settings.agent.ownerName,
    todayTotal: today.total,
    todayOrders: today.orders,
    yesterdayTotal: yesterday.total,
    openTables,
    unpaid,
    longestWait,
    longestWaitTable,
    backupDue: backupDue(data.settings, data.history, now),
  };
}
