// Ask Agent — offline conversational engine.
//
// respond() is a pure function: (input, world snapshot, context) -> reply.
// It never mutates app data; it returns a Plan that the executor applies,
// either immediately (safe, undoable changes like adding items) or after the
// user confirms (payments, clearing, menu edits).

import type { AppData, TableDef } from "../data/types";
import { splitTotal, tableDisplayName } from "../lib/bill";
import {
  addDays,
  businessDayKey,
  formatMinutesAsTime,
  parseISODate,
  parseTimeToMinutes,
  periodLabel,
  summarize,
  txnsForPeriod,
  type PeriodSpec,
} from "../lib/businessDay";
import { fmtDayLabel, fmtTime, peso, plural } from "../lib/format";
import {
  buildMenuIndex,
  findCategory,
  findMenuItem,
  parseItems,
  prepareTokens,
  suggestItems,
  type MenuIndex,
  type ParsedLine,
} from "./menuMatch";
import { isNumberToken } from "./text";
import type { AgentContext, AgentInput, AgentReply, Card, Line, Pending, Plan, World } from "./types";

const CONTEXT_TTL_MS = 3 * 60 * 1000;
const LOW_CONFIDENCE = 0.8;

const YES = new Set(["yes", "yeah", "yep", "yup", "sure", "confirm", "confirmed", "ok", "okay", "correct", "right", "proceed", "go", "do", "oo", "opo", "affirmative", "please"]);
const NO = new Set(["no", "nope", "nah", "cancel", "stop", "dont", "wait", "hindi", "wrong", "negative"]);

// ---------- small helpers ----------

const has = (toks: string[], ...words: string[]) => words.some((w) => toks.includes(w));
const hasPhrase = (norm: string, ...phrases: string[]) => phrases.some((p) => ` ${norm} `.includes(` ${p} `));

function linesText(lines: Line[]): string {
  return lines.map((l) => `${l.qty}× ${l.name}`).join(", ");
}
function spokenLines(lines: Line[]): string {
  const parts = lines.map((l) => `${l.qty} ${l.name.replace(/w\//g, "with").replace(/&/g, "and")}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
}
function pesoSpoken(n: number) {
  return `${Math.round(n).toLocaleString("en-PH")} pesos`;
}

function tableName(data: AppData, id: number) {
  return tableDisplayName(data.tableList, id);
}

// ---------- entity extraction ----------

interface TableRef {
  tableId: number | null;
  /** The user named a table that doesn't exist. */
  missing?: string;
  rest: string[];
}

function tableNameTokens(t: TableDef): string[] {
  return prepareTokens(t.name).filter((x) => x !== "table");
}

export function extractTable(toks: string[], data: AppData): TableRef {
  const t = toks.slice();
  // Speech often renders "for table 3" as "4 table 3" and "to table 3" as "2 table 3".
  for (let i = 0; i < t.length - 1; i++) {
    if ((t[i] === "4" || t[i] === "2") && (t[i + 1] === "table" || t[i + 1] === "tables") && isNumberToken(t[i + 2])) {
      t[i] = t[i] === "4" ? "for" : "to";
    }
  }
  const findByName = (nameToks: string[]) =>
    data.tableList.find((tb) => {
      const n = tableNameTokens(tb);
      return n.length === nameToks.length && n.every((x, k) => x === nameToks[k]);
    });

  for (let i = 0; i < t.length; i++) {
    const w = t[i]!;
    const m = /^t(\d+)$/.exec(w);
    if (m) {
      const tb = findByName([m[1]!]);
      if (tb) return { tableId: tb.id, rest: [...t.slice(0, i), ...t.slice(i + 1)] };
    }
    if (w === "table" || w === "tbl" || w === "mesa" || w === "number" || w === "tables") {
      // "table 3", "table takeout", "table number 3"
      let j = i + 1;
      if (t[j] === "number" || t[j] === "no") j++;
      for (let len = 3; len >= 1; len--) {
        const cand = t.slice(j, j + len);
        if (cand.length < len) continue;
        const tb = findByName(cand);
        if (tb) return { tableId: tb.id, rest: [...t.slice(0, i), ...t.slice(j + len)] };
      }
      if (isNumberToken(t[j])) return { tableId: null, missing: t[j], rest: [...t.slice(0, i), ...t.slice(j + 1)] };
    }
  }
  // Custom table names anywhere in the sentence ("takeout 2 siomai").
  const customs = data.tableList.filter((tb) => tb.custom).map((tb) => ({ tb, n: tableNameTokens(tb) })).sort((a, b) => b.n.length - a.n.length);
  for (const { tb, n } of customs) {
    if (!n.length) continue;
    for (let i = 0; i + n.length <= t.length; i++) {
      if (n.every((x, k) => t[i + k] === x)) return { tableId: tb.id, rest: [...t.slice(0, i), ...t.slice(i + n.length)] };
    }
  }
  return { tableId: null, rest: t };
}

/** "split 2" / "bill 2" / "all bills" */
function extractSplit(toks: string[]): { split: number | "all" | null; rest: string[] } {
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i]!;
    if ((w === "split" || w === "bill" || w === "check" || w === "splits" || w === "bills") && isNumberToken(toks[i + 1])) {
      return { split: parseInt(toks[i + 1]!, 10) - 1, rest: [...toks.slice(0, i), ...toks.slice(i + 2)] };
    }
    if ((w === "all" || w === "both" || w === "everything") && (toks[i + 1] === undefined || /^(split|bill|check|of)/.test(toks[i + 1]!))) {
      return { split: "all", rest: [...toks.slice(0, i), ...toks.slice(i + 1)] };
    }
  }
  return { split: null, rest: toks };
}

function extractAmount(toks: string[], keywords: string[]): number | undefined {
  for (let i = 0; i < toks.length; i++) {
    if (!keywords.includes(toks[i]!)) continue;
    for (const k of [i + 1, i + 2, i - 1]) {
      if (isNumberToken(toks[k])) return parseFloat(toks[k]!);
    }
  }
  return undefined;
}

function firstNumber(toks: string[]): number | undefined {
  const t = toks.find((x) => isNumberToken(x));
  return t === undefined ? undefined : parseFloat(t);
}

function extractPeriod(toks: string[], norm: string, world: World): PeriodSpec | null {
  const today = businessDayKey(world.now, world.data.settings);
  const lastN = /\b(?:last|past) (\d+) days?\b/.exec(norm);
  if (lastN) return { period: "custom", from: addDays(today, -(parseInt(lastN[1]!, 10) - 1)), to: today };
  if (hasPhrase(norm, "yesterday")) {
    const y = addDays(today, -1);
    return { period: "custom", from: y, to: y };
  }
  if (hasPhrase(norm, "last week")) {
    const d = parseISODate(today);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    const thisMon = addDays(today, -dow);
    return { period: "custom", from: addDays(thisMon, -7), to: addDays(thisMon, -1) };
  }
  if (hasPhrase(norm, "last month")) {
    const d = parseISODate(today);
    const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth(), 0);
    const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    return { period: "custom", from: iso(first), to: iso(last) };
  }
  if (has(toks, "week", "weekly")) return { period: "week" };
  if (has(toks, "month", "monthly")) return { period: "month" };
  if (hasPhrase(norm, "all time", "ever", "overall", "lifetime") || has(toks, "alltime")) return { period: "all" };
  if (has(toks, "today", "tonight", "now", "shift")) return { period: "today" };
  return null;
}

function periodPhrase(spec: PeriodSpec, world: World): string {
  if (spec.period === "today") return "today";
  if (spec.period === "week") return "this week";
  if (spec.period === "month") return "this month";
  if (spec.period === "all") return "all time";
  const today = businessDayKey(world.now, world.data.settings);
  if (spec.from === spec.to && spec.from === addDays(today, -1)) return "yesterday";
  return periodLabel(spec);
}

/** Parses "6pm", "6:30 pm", "18:00", "2am" from raw text. */
function parseTimes(raw: string): string[] {
  const out: string[] = [];
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=\b|\s|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let h = parseInt(m[1]!, 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const ap = (m[3] ?? "").toLowerCase().replace(/\./g, "");
    if (!m[2] && !ap) continue; // bare numbers aren't times
    if (h > 23 || min > 59) continue;
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    out.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return out;
}

// ---------- context helpers ----------

function rememberTable(ctx: AgentContext, tableId: number, world: World): AgentContext {
  return { ...ctx, lastTableId: tableId, lastTableAt: world.now.getTime() };
}

function contextTable(world: World, ctx: AgentContext): number | null {
  if (world.currentTableId !== null) return world.currentTableId;
  if (ctx.lastTableId !== null && world.now.getTime() - ctx.lastTableAt < CONTEXT_TTL_MS && world.data.tableList.some((t) => t.id === ctx.lastTableId)) {
    return ctx.lastTableId;
  }
  return null;
}

function splitFor(world: World, tableId: number): number {
  const splits = world.data.tables[tableId] ?? [];
  if (tableId === world.currentTableId) return Math.min(world.activeSplit, Math.max(0, splits.length - 1));
  return 0;
}

function billCard(world: World, tableId: number, split: number, added: Line[] = [], removed: { name: string; qty: number | "all" }[] = []): Card {
  const splits = world.data.tables[tableId] ?? [];
  const lines: Line[] = (splits[split]?.items ?? []).map((i) => ({ ...i }));
  for (const a of added) {
    const ex = lines.find((l) => l.name === a.name && l.price === a.price);
    if (ex) ex.qty += a.qty;
    else lines.push({ ...a });
  }
  for (const r of removed) {
    const ex = lines.find((l) => l.name === r.name);
    if (ex) ex.qty = r.qty === "all" ? 0 : ex.qty - r.qty;
  }
  const kept = lines.filter((l) => l.qty > 0);
  const multi = splits.length > 1;
  return {
    kind: "bill",
    title: `${tableName(world.data, tableId)}${multi ? ` · Split ${split + 1}` : ""}`,
    lines: kept,
    total: kept.reduce((s, l) => s + l.price * l.qty, 0),
    highlight: added.map((a) => a.name),
  };
}

// ---------- the engine ----------

export interface RespondResult {
  reply: AgentReply;
  ctx: AgentContext;
}

let indexCache: { menu: AppData["menu"]; index: MenuIndex } | null = null;
function menuIndex(data: AppData): MenuIndex {
  if (!indexCache || indexCache.menu !== data.menu) indexCache = { menu: data.menu, index: buildMenuIndex(data.menu) };
  return indexCache.index;
}

export function respond(input: AgentInput, world: World, ctx: AgentContext): RespondResult {
  // Button presses on a confirmation card.
  if (typeof input !== "string") {
    const p = ctx.pending;
    if (p?.kind !== "confirm") return { reply: { text: "There’s nothing waiting for confirmation." }, ctx };
    if (input.type === "confirm") return { reply: { text: p.doneText, execute: p.plan, undoable: p.undoable }, ctx: { ...ctx, pending: null } };
    return { reply: { text: "Okay, cancelled. Nothing was changed." }, ctx: { ...ctx, pending: null } };
  }

  const raw = input.trim();
  const toks = prepareTokens(raw);
  const norm = toks.join(" ");
  if (!toks.length) return { reply: { text: "I’m listening — tell me an order or ask a question." }, ctx };

  // ----- pending follow-ups -----
  const pending = ctx.pending;
  if (pending) {
    const cleared = { ...ctx, pending: null };
    if (pending.kind === "confirm") {
      if (toks.length <= 4 && toks.some((t) => YES.has(t)) && !toks.some((t) => NO.has(t))) {
        return { reply: { text: pending.doneText, execute: pending.plan, undoable: pending.undoable }, ctx: cleared };
      }
      if (toks.length <= 4 && toks.some((t) => NO.has(t))) {
        return { reply: { text: "Okay, cancelled. Nothing was changed." }, ctx: cleared };
      }
      return respond(raw, world, cleared);
    }
    if (pending.kind === "needTable") {
      const ref = extractTable(toks, world.data);
      let tableId = ref.tableId;
      if (tableId === null && toks.length <= 2) {
        const n = toks.find((x) => isNumberToken(x) || x.length > 0);
        const tb = world.data.tableList.find((t) => prepareTokens(t.name).join(" ") === (n ?? ""));
        if (tb) tableId = tb.id;
      }
      if (tableId !== null) return { reply: pending.resume(tableId, world, cleared), ctx: rememberTable(cleared, tableId, world) };
      if (toks.some((t) => NO.has(t)) && toks.length <= 3) return { reply: { text: "Okay, cancelled." }, ctx: cleared };
      if (ref.missing) return { reply: { text: `There’s no Table ${ref.missing}. Which table should I use?`, suggestions: tableSuggestions(world.data) }, ctx };
      return respond(raw, world, cleared);
    }
    if (pending.kind === "needPrice") {
      const price = firstNumber(toks);
      if (price !== undefined && toks.length <= 4) {
        const line: Line = { name: titleCase(pending.name), price, qty: pending.qty };
        const plan: Plan = { kind: "addItems", tableId: pending.tableId, split: pending.split, items: [line] };
        return {
          reply: { text: `Added ${linesText([line])} (custom, ${peso(price)} each) to ${tableName(world.data, pending.tableId)}.`, execute: plan, undoable: true, card: billCard(world, pending.tableId, pending.split, [line]) },
          ctx: cleared,
        };
      }
      if (toks.some((t) => NO.has(t)) && toks.length <= 3) return { reply: { text: "Okay, I won’t add it." }, ctx: cleared };
      return respond(raw, world, cleared);
    }
    if (pending.kind === "needSplit") {
      const sp = extractSplit(toks);
      let split = sp.split;
      if (split === null && toks.length <= 2 && isNumberToken(toks[0])) split = parseInt(toks[0]!, 10) - 1;
      if (split !== null) return payReply(world, pending.tableId, split, pending.cash, cleared);
      return respond(raw, world, cleared);
    }
  }

  const data = world.data;
  const index = menuIndex(data);

  // ----- social / meta -----
  if (/^(hi|hello|hey|hiya|yo|good (morning|afternoon|evening)|kumusta|musta)\b/.test(norm) && toks.length <= 4) {
    const name = data.settings.businessName ? ` at ${data.settings.businessName}` : "";
    return { reply: { text: `Hello! Ready to take orders${name}. Try “2 pares with egg for table 3”.`, suggestions: ["What can you do?", "How much did we sell today?", "Which tables are open?"] }, ctx };
  }
  if (has(toks, "thanks", "thank", "salamat", "ty", "thx")) {
    return { reply: { text: "You’re welcome! Anything else?" }, ctx };
  }
  if (hasPhrase(norm, "who are you", "what are you", "your name")) {
    return { reply: { text: "I’m the Order Board assistant. I take orders, manage bills and answer questions about your sales — all on this phone, no internet needed." }, ctx };
  }
  if (has(toks, "help", "commands", "examples") || hasPhrase(norm, "what can you do", "how do i", "how to use", "what can i say")) {
    return { reply: helpReply(), ctx };
  }

  // ----- undo -----
  if (/^(undo|revert|scratch that|take that back|undo that|undo last)\b/.test(norm) || norm === "oops") {
    return { reply: { text: "Undone.", execute: { kind: "undo" } }, ctx };
  }

  // ----- refuse destructive record changes -----
  if (has(toks, "reset") || (has(toks, "delete", "erase", "wipe") && has(toks, "sales", "history", "records", "record", "transactions", "transaction", "data", "everything", "payment", "payments"))) {
    return {
      reply: {
        text: "For safety I can’t delete or reset sales records. You can do it yourself in Summary: tap an order to delete it, or use Reset Today — both ask for a confirmation code.",
        tone: "warn",
        suggestions: ["Open summary"],
      },
      ctx,
    };
  }

  // ----- navigation -----
  const navVerb = has(toks, "go", "open", "show", "navigate", "switch", "take", "view", "display", "bring");
  const nav = navigationTarget(toks, norm);
  if (nav && (navVerb || toks.length <= 2)) {
    return { reply: { text: nav.text, execute: { kind: "navigate", route: nav.route } }, ctx };
  }

  // ----- theme -----
  if ((has(toks, "dark", "light") && has(toks, "mode", "theme", "switch", "use", "turn", "set")) || hasPhrase(norm, "system theme")) {
    const theme = has(toks, "system") ? "system" : has(toks, "dark") ? "dark" : "light";
    return { reply: { text: `Switched to ${theme} theme.`, execute: { kind: "setTheme", theme } }, ctx };
  }

  // ----- business settings -----
  if (hasPhrase(norm, "business name", "store name", "stall name", "shop name")) {
    const m = /(?:business|store|stall|shop) name (?:is |to |as )?(.+)$/i.exec(raw.replace(/[.!?]+$/, ""));
    const name = m?.[1]?.replace(/^(is|to|as)\s+/i, "").trim();
    if (name && !/^(\?|what)/i.test(name)) {
      return confirmReply(ctx, { kind: "setBusinessName", name: name.slice(0, 40) }, `Set the business name to “${name.slice(0, 40)}”?`, "Save name", `Business name set to “${name.slice(0, 40)}”.`);
    }
    return { reply: { text: data.settings.businessName ? `Your business name is “${data.settings.businessName}”.` : "No business name is set yet. Say “set business name to …”." }, ctx };
  }
  if (has(toks, "hours", "schedule") || hasPhrase(norm, "what time do we close", "what time do we open", "when do we close", "when do we open")) {
    const times = parseTimes(raw);
    if (times.length >= 2 && has(toks, "set", "change", "update", "from", "open", "to")) {
      const [start, end] = times as [string, string];
      return confirmReply(ctx, { kind: "setHours", start, end },
        `Set working hours to ${formatMinutesAsTime(parseTimeToMinutes(start))} – ${formatMinutesAsTime(parseTimeToMinutes(end))}?`, "Save hours", "Working hours updated.");
    }
    const s = data.settings;
    return { reply: { text: `Working hours are ${formatMinutesAsTime(parseTimeToMinutes(s.workStart))} to ${formatMinutesAsTime(parseTimeToMinutes(s.workEnd))}. Sales after midnight count toward the same shift.` }, ctx };
  }
  if (hasPhrase(norm, "what time is it", "time now", "current time")) {
    return { reply: { text: `It’s ${fmtTime(world.now.toISOString())}.` }, ctx };
  }

  // ----- export -----
  if (has(toks, "export", "download", "backup")) {
    const format = has(toks, "backup") || hasPhrase(norm, "all data") ? "backup" : has(toks, "pdf", "print") ? "pdf" : "csv";
    const spec: PeriodSpec = extractPeriod(toks, norm, world) ?? { period: "today" };
    if (format !== "backup" && !txnsForPeriod(data.history, spec, data.settings, world.now).length) {
      return { reply: { text: `There are no sales ${periodPhrase(spec, world)} to export.` }, ctx };
    }
    const what = format === "backup" ? "a full backup of all your data" : `the ${periodPhrase(spec, world)} report as ${format.toUpperCase()}`;
    return { reply: { text: `Preparing ${what}.`, execute: { kind: "export", format, spec } }, ctx };
  }

  // ----- menu management -----
  const menuReply = menuManagement(raw, toks, norm, world, ctx, index);
  if (menuReply) return menuReply;

  // ----- table management -----
  if (has(toks, "add", "create", "new") && has(toks, "table") && !parseItems(extractTable(toks, data).rest, index).lines.length) {
    const m = /\btable\s+(?:called|named|for)?\s*["“]?([^"”]+?)["”]?$/i.exec(raw.trim());
    const name = m?.[1]?.trim().slice(0, 24);
    if (name) {
      if (data.tableList.some((t) => t.name.toLowerCase() === name.toLowerCase())) return { reply: { text: `There’s already a table called “${name}”.` }, ctx };
      return { reply: { text: `Added a new table “${name}”.`, execute: { kind: "addTable", name }, undoable: true }, ctx };
    }
    return { reply: { text: "What should the new table be called? Say for example “add table Takeout”." }, ctx };
  }
  if (has(toks, "remove", "delete") && has(toks, "table") && !parseItems(extractTable(toks, data).rest, index).lines.length) {
    const ref = extractTable(toks, data);
    if (ref.tableId === null) return { reply: { text: "Which table should I remove?", suggestions: data.tableList.filter((t) => t.custom).map((t) => `Remove table ${t.name}`) }, ctx };
    const t = data.tableList.find((x) => x.id === ref.tableId)!;
    if (!t.custom) return { reply: { text: `${tableName(data, t.id)} is a built-in table and can’t be removed.` }, ctx };
    if ((data.tables[t.id] ?? []).some((sp) => sp.items.length)) return { reply: { text: `${t.name} still has an open bill. Pay or clear it first.` }, ctx };
    return confirmReply(ctx, { kind: "removeTable", tableId: t.id }, `Remove the table “${t.name}”?`, "Remove", `Removed “${t.name}”.`);
  }

  // ----- everything below may target a table -----
  const ref = extractTable(toks, data);
  if (ref.missing && !data.tableList.some((t) => t.name === ref.missing)) {
    return { reply: { text: `There’s no Table ${ref.missing}. Your tables are ${data.tableList.map((t) => t.name).join(", ")}.`, tone: "warn" }, ctx };
  }
  const explicitTable = ref.tableId;
  const rest = ref.rest;
  const restNorm = rest.join(" ");

  // ----- open a table's order screen: "open table 3", "go to takeout" -----
  if (explicitTable !== null && /^(open|go to|go|take me to|switch to|bring up)\b/.test(norm) && !parseItems(rest, index).lines.length) {
    return { reply: { text: `Opening ${tableName(data, explicitTable)}.`, execute: { kind: "navigate", route: { name: "order", tableId: explicitTable } } }, ctx: rememberTable(ctx, explicitTable, world) };
  }

  // ----- restore a paid order (before queries: "restore the last order") -----
  if (has(toks, "restore", "reopen", "unpay") || hasPhrase(norm, "undo payment", "undo paid", "undo the payment")) {
    const candidates = data.history.filter((h) => explicitTable === null || h.table === explicitTable);
    const last = candidates[candidates.length - 1];
    if (!last) return { reply: { text: explicitTable !== null ? `I can’t find a paid order for ${tableName(data, explicitTable)}.` : "There are no paid orders to restore." }, ctx };
    if (!data.tableList.some((t) => t.id === last.table)) return { reply: { text: "That order’s table was removed, so it can’t be restored." }, ctx };
    return confirmReply(ctx, { kind: "restoreTxn", txnId: last.id },
      `Restore the ${fmtTime(last.ts)} order (${peso(last.total)}) back to ${tableName(data, last.table)}? It will be removed from sales.`, "Restore",
      `Restored to ${tableName(data, last.table)}.`, false,
      { kind: "bill", title: `${tableName(data, last.table)} · paid ${fmtTime(last.ts)}`, lines: last.items, total: last.total });
  }

  // ----- queries -----
  const q = queries(raw, toks, norm, rest, explicitTable, world, ctx, index);
  if (q) return q;

  // ----- pay -----
  const payWords = has(toks, "paid", "pay", "pays", "payment", "settle", "settled", "checkout", "billout") || hasPhrase(norm, "check out", "bill out", "close the bill", "close bill");
  if (payWords) {
    const tableId = explicitTable ?? contextTable(world, ctx);
    const cash = extractAmount(rest, ["cash", "received", "gave", "give", "tendered", "with", "change", "pera", "bayad"]) ?? numbersOtherThanTable(rest);
    const sp = extractSplit(rest);
    if (tableId === null) {
      return askTable(ctx, world, "Which table is paying?", (tid, w, c) => payReply(w, tid, sp.split, cash, c).reply);
    }
    return payReply(world, tableId, sp.split, cash, rememberTable(ctx, tableId, world));
  }

  // ----- new split -----
  if ((has(toks, "split", "separate") && has(toks, "bill", "check", "new", "another", "table", "split")) || hasPhrase(norm, "new bill", "another bill", "separate bill", "new check")) {
    const tableId = explicitTable ?? contextTable(world, ctx);
    if (tableId === null) return askTable(ctx, world, "Which table should I split?", (tid, w) => splitReply(w, tid));
    return { reply: splitReply(world, tableId), ctx: rememberTable(ctx, tableId, world) };
  }

  // ----- clear -----
  const clearWords = has(toks, "clear", "void", "empty") || (has(toks, "cancel") && has(toks, "order", "bill", "everything", "all", "table"));
  if (clearWords) {
    const items = parseItems(rest.filter((t) => !["clear", "void", "empty", "cancel"].includes(t)), index);
    if (!items.lines.length) {
      const tableId = explicitTable ?? contextTable(world, ctx);
      if (tableId === null) return askTable(ctx, world, "Which table should I clear?", (tid, w, c) => clearReply(w, tid, c).reply);
      return clearReply(world, tableId, rememberTable(ctx, tableId, world));
    }
  }

  // ----- remove items -----
  const removeWords = has(toks, "remove", "delete", "minus", "less", "drop", "cancel", "subtract", "deduct", "without") || hasPhrase(norm, "take off", "take away", "no more", "dont want");
  if (removeWords) {
    const cleaned = rest.filter((t) => !["remove", "delete", "minus", "less", "drop", "cancel", "subtract", "deduct", "take", "off", "away", "from", "no", "more", "not", "dont", "want", "the"].includes(t));
    const parsed = parseItems(cleaned, index);
    const tableId = explicitTable ?? contextTable(world, ctx);
    if (parsed.lines.length) {
      if (tableId === null) return askTable(ctx, world, "Which table should I remove that from?", (tid, w) => removeReply(w, tid, parsed.lines, cleaned));
      return { reply: removeReply(world, tableId, parsed.lines, cleaned), ctx: rememberTable(ctx, tableId, world) };
    }
  }

  // ----- set quantity: "make it 3", "change siomai to 3" -----
  const setQ = /\b(?:make (?:it|that|them)|change (?:it|that|.+?) to|set (?:.+?) to|should be|only) (\d+)\b/.exec(norm);
  if (setQ) {
    const qty = parseInt(setQ[1]!, 10);
    const tableId = explicitTable ?? contextTable(world, ctx);
    if (tableId !== null) {
      const split = splitFor(world, tableId);
      const named = findMenuItem(rest.filter((t) => !["make", "change", "set", "to", "should", "be", "only", "it", "that", "them", String(qty)].includes(t)), index);
      const target = named?.entry.name ?? ctx.lastLines[ctx.lastLines.length - 1]?.name;
      const items = world.data.tables[tableId]?.[split]?.items ?? [];
      const line = items.find((i) => i.name === target);
      if (line) {
        const plan: Plan = { kind: "setQty", tableId, split, name: line.name, qty };
        const delta = qty - line.qty;
        return {
          reply: {
            text: qty === 0 ? `Removed ${line.name} from ${tableName(data, tableId)}.` : `${line.name} on ${tableName(data, tableId)} is now ${qty}.`,
            execute: plan,
            undoable: true,
            card: billCard(world, tableId, split, delta > 0 ? [{ ...line, qty: delta }] : [], delta < 0 ? [{ name: line.name, qty: -delta }] : []),
          },
          ctx: { ...rememberTable(ctx, tableId, world), lastLines: qty > 0 ? [{ name: line.name, price: line.price, qty }] : ctx.lastLines },
        };
      }
    }
  }

  // ----- repeat: "another one", "same again", "same for table 4" -----
  const isRepeat = /^(another one|one more|same again|again|same|same order|repeat|repeat that|same for|same thing)\b/.test(restNorm) || hasPhrase(norm, "same for", "same order for", "same thing for");
  if (isRepeat && ctx.lastLines.length) {
    const tableId = explicitTable ?? contextTable(world, ctx);
    if (tableId === null) return askTable(ctx, world, "Which table is that for?", (tid, w, c) => addReply(w, c, tid, ctx.lastLines, []).reply);
    return addReply(world, rememberTable(ctx, tableId, world), tableId, ctx.lastLines, []);
  }

  // ----- add items (the default) -----
  const parsed = parseItems(rest, index);
  if (parsed.lines.length || (parsed.unknown.length && (explicitTable !== null || has(toks, "add", "order")))) {
    const lines = parsed.lines.map(toLine);
    const lowConfidence = parsed.lines.filter((l) => l.confidence < LOW_CONFIDENCE);
    const tableId = explicitTable ?? contextTable(world, ctx);
    if (tableId === null) {
      return askTable(ctx, world, lines.length ? `Which table is ${linesText(lines)} for?` : "Which table is this for?", (tid, w, c) =>
        addReply(w, c, tid, lines, parsed.unknown, lowConfidence).reply);
    }
    return addReply(world, rememberTable(ctx, tableId, world), tableId, lines, parsed.unknown, lowConfidence);
  }

  // ----- nothing matched -----
  const sug = suggestItems(raw, index);
  if (sug.length && toks.length <= 4) {
    return {
      reply: {
        text: `I’m not sure what you meant. Did you mean ${sug.map((s) => `“${s.name}”`).join(" or ")}?`,
        suggestions: sug.map((s) => s.name),
      },
      ctx,
    };
  }
  return {
    reply: {
      text: "Sorry, I didn’t catch that. You can say an order like “2 mami and a water for table 1”, or ask “how much did we sell today?”.",
      suggestions: ["What can you do?", "Which tables are open?", "Show the menu"],
      tone: "warn",
    },
    ctx,
  };
}

// ---------- intent handlers ----------

function toLine(p: ParsedLine): Line {
  return { name: p.item.name, price: p.item.price, qty: p.qty };
}

function titleCase(s: string) {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function tableSuggestions(data: AppData): string[] {
  return data.tableList.slice(0, 6).map((t) => (t.custom ? t.name : `Table ${t.name}`));
}

function numbersOtherThanTable(rest: string[]): number | undefined {
  // "table 3 paid 500": the table number is already removed; a leftover
  // number >= 20 is almost certainly the cash handed over.
  const n = rest.filter(isNumberToken).map(Number).filter((x) => x >= 20);
  return n.length === 1 ? n[0] : undefined;
}

function askTable(ctx: AgentContext, world: World, question: string, resume: (tid: number, w: World, c: AgentContext) => AgentReply): RespondResult {
  const pending: Pending = { kind: "needTable", resume };
  return { reply: { text: question, suggestions: tableSuggestions(world.data) }, ctx: { ...ctx, pending } };
}

function confirmReply(ctx: AgentContext, plan: Plan, question: string, yes: string, doneText: string, undoable = false, card?: Card): RespondResult {
  return {
    reply: { text: question, card, confirm: { plan, yes, doneText } },
    ctx: { ...ctx, pending: { kind: "confirm", plan, doneText, undoable } },
  };
}

function addReply(world: World, ctx: AgentContext, tableId: number, lines: Line[], unknown: string[], lowConfidence: ParsedLine[] = []): RespondResult {
  const data = world.data;
  const split = splitFor(world, tableId);
  const name = tableName(data, tableId);
  let nextCtx: AgentContext = { ...ctx, lastLines: lines.length ? lines : ctx.lastLines };

  if (!lines.length) {
    const u = unknown[0]!;
    const sug = suggestItems(u, menuIndex(data));
    nextCtx = { ...nextCtx, pending: { kind: "needPrice", name: u, qty: 1, tableId, split } };
    return {
      reply: {
        text: `“${u}” isn’t on the menu.${sug.length ? ` Did you mean ${sug.map((s) => s.name).join(" or ")}?` : ""} To add it as a custom item, tell me its price.`,
        suggestions: sug.map((s) => `${s.name} for ${name}`),
        tone: "warn",
      },
      ctx: nextCtx,
    };
  }

  const plan: Plan = { kind: "addItems", tableId, split, items: lines };
  const card = billCard(world, tableId, split, lines);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  let text = `Added to ${name}: ${linesText(lines)} (${peso(subtotal)}). Bill total ${peso(card.kind === "bill" ? card.total : 0)}.`;
  const speak = `Added ${spokenLines(lines)} to ${name}. Total ${pesoSpoken(card.kind === "bill" ? card.total : 0)}.`;
  if (unknown.length) {
    text += ` I couldn’t find ${unknown.map((u) => `“${u}”`).join(", ")} on the menu — tell me its price to add it as a custom item.`;
    nextCtx = { ...nextCtx, pending: null };
  }
  const needsConfirm = data.settings.agent.confirmAdds || lowConfidence.length > 0;
  if (needsConfirm) {
    const heard = lowConfidence.map((l) => `“${l.heard}” → ${l.item.name}`).join(", ");
    const q = `Add ${linesText(lines)} to ${name}?${heard ? ` (I matched ${heard}.)` : ""}`;
    const r = confirmReply(nextCtx, plan, q, "Add to bill", text, true, card);
    return { reply: { ...r.reply, speak: `Add ${spokenLines(lines)} to ${name}?` }, ctx: r.ctx };
  }
  if (unknown.length === 1) nextCtx = { ...nextCtx, pending: { kind: "needPrice", name: unknown[0]!, qty: 1, tableId, split } };
  return { reply: { text, speak, execute: plan, undoable: true, card }, ctx: nextCtx };
}

function removeReply(world: World, tableId: number, parsed: ParsedLine[], tokens: string[]): AgentReply {
  const data = world.data;
  const split = splitFor(world, tableId);
  const items = data.tables[tableId]?.[split]?.items ?? [];
  const name = tableName(data, tableId);
  const explicitQty = tokens.some((t) => isNumberToken(t) || ["a", "an", "one"].includes(t));
  const removals: { name: string; qty: number | "all" }[] = [];
  const missing: string[] = [];
  for (const p of parsed) {
    const line = items.find((i) => i.name === p.item.name);
    if (!line) {
      missing.push(p.item.name);
      continue;
    }
    removals.push({ name: line.name, qty: explicitQty ? Math.min(p.qty, line.qty) : "all" });
  }
  if (!removals.length) return { text: `${name} doesn’t have ${missing.join(" or ")} on its bill.`, card: billCard(world, tableId, split), tone: "warn" };
  const desc = removals.map((r) => (r.qty === "all" ? r.name : `${r.qty}× ${r.name}`)).join(", ");
  return {
    text: `Removed ${desc} from ${name}.${missing.length ? ` (${missing.join(", ")} wasn’t on the bill.)` : ""}`,
    execute: { kind: "removeItems", tableId, split, items: removals },
    undoable: true,
    card: billCard(world, tableId, split, [], removals),
  };
}

function payReply(world: World, tableId: number, splitSel: number | "all" | null, cash: number | undefined, ctx: AgentContext): RespondResult {
  const data = world.data;
  const name = tableName(data, tableId);
  const splits = data.tables[tableId] ?? [];
  const nonEmpty = splits.map((s, i) => ({ s, i })).filter((x) => x.s.items.length);
  if (!nonEmpty.length) return { reply: { text: `${name} has no open bill to pay.`, tone: "warn" }, ctx };

  let chosen: number[];
  if (splitSel === "all") chosen = nonEmpty.map((x) => x.i);
  else if (typeof splitSel === "number") {
    if (!splits[splitSel]?.items.length) return { reply: { text: `${name} doesn’t have a Split ${splitSel + 1} with items.` }, ctx };
    chosen = [splitSel];
  } else if (nonEmpty.length === 1) chosen = [nonEmpty[0]!.i];
  else if (tableId === world.currentTableId && splits[world.activeSplit]?.items.length) chosen = [world.activeSplit];
  else {
    return {
      reply: {
        text: `${name} has ${nonEmpty.length} separate bills: ${nonEmpty.map((x) => `Split ${x.i + 1} (${peso(splitTotal(x.s))})`).join(", ")}. Which one is paying?`,
        suggestions: [...nonEmpty.map((x) => `Split ${x.i + 1}`), "All of them"],
      },
      ctx: { ...ctx, pending: { kind: "needSplit", tableId, cash } },
    };
  }

  const total = chosen.reduce((s, i) => s + splitTotal(splits[i]), 0);
  const lines = chosen.flatMap((i) => splits[i]!.items);
  if (cash !== undefined && cash < total) {
    return { reply: { text: `Cash of ${peso(cash)} is short by ${peso(total - cash)}. ${name}’s total is ${peso(total)}.`, tone: "warn" }, ctx };
  }
  const changeText = cash !== undefined ? ` Cash ${peso(cash)}, change ${peso(cash - total)}.` : "";
  const splitText = splits.length > 1 ? (chosen.length > 1 ? " (all bills)" : ` (Split ${chosen[0]! + 1})`) : "";
  const card: Card = {
    kind: "bill",
    title: `${name}${splitText}`,
    lines,
    total,
    note: cash !== undefined ? `Cash ${peso(cash)} · Change ${peso(cash - total)}` : undefined,
  };
  return confirmReply(ctx, { kind: "pay", tableId, splits: chosen, cash }, `Mark ${name}${splitText} as paid? Total ${peso(total)}.${changeText}`,
    "Mark paid", `${name}${splitText} paid — ${peso(total)} recorded.${changeText}`, false, card);
}

function splitReply(world: World, tableId: number): AgentReply {
  const n = (world.data.tables[tableId] ?? []).length;
  return {
    text: `Started a new bill on ${tableName(world.data, tableId)} (Split ${Math.max(n, 1) + 1}). New items will go there when you open it.`,
    execute: { kind: "addSplit", tableId },
    undoable: true,
  };
}

function clearReply(world: World, tableId: number, ctx: AgentContext): RespondResult {
  const split = splitFor(world, tableId);
  const items = world.data.tables[tableId]?.[split]?.items ?? [];
  const name = tableName(world.data, tableId);
  if (!items.length) return { reply: { text: `${name} is already empty.` }, ctx };
  return confirmReply(ctx, { kind: "clear", tableId, split }, `Clear ${name}? This removes ${plural(items.reduce((s, i) => s + i.qty, 0), "item")} without recording a sale.`,
    "Clear bill", `${name} cleared.`, true, billCard(world, tableId, split));
}

function navigationTarget(toks: string[], norm: string): { route: import("../store/appStore").Route; text: string } | null {
  if (has(toks, "summary", "dashboard", "reports", "report") || hasPhrase(norm, "sales screen", "sales page")) return { route: { name: "summary" }, text: "Opening Summary." };
  if (has(toks, "settings", "setting", "preferences")) return { route: { name: "settings" }, text: "Opening Settings." };
  if (hasPhrase(norm, "edit menu", "menu editor", "edit the menu", "manage menu")) return { route: { name: "menu" }, text: "Opening the menu editor." };
  if (hasPhrase(norm, "what is new", "whats new", "changelog", "version history")) return { route: { name: "changelog" }, text: "Here’s what’s new." };
  if (has(toks, "privacy")) return { route: { name: "legal", doc: "privacy" }, text: "Opening the Privacy Policy." };
  if (has(toks, "terms")) return { route: { name: "legal", doc: "terms" }, text: "Opening the Terms of Use." };
  if (hasPhrase(norm, "about the app", "about app", "about screen", "about")) return toks.length <= 3 ? { route: { name: "about" }, text: "Opening About." } : null;
  if (has(toks, "home") || norm === "tables" || hasPhrase(norm, "go to tables", "show tables", "all tables", "back to tables")) return { route: { name: "tables" }, text: "Going to Tables." };
  return null;
}

function menuManagement(raw: string, toks: string[], norm: string, world: World, ctx: AgentContext, index: MenuIndex): RespondResult | null {
  const data = world.data;
  // Price change: "change the price of pares to 65", "set mami price 55", "pares is now 65 pesos"
  const priceChange =
    (has(toks, "price", "cost", "costs") && has(toks, "change", "set", "update", "make", "raise", "increase", "lower", "reduce", "new")) ||
    /\b(?:is now|now costs?|now) \d+\b/.test(norm);
  if (priceChange) {
    const nums = toks.filter(isNumberToken);
    const price = nums.length ? parseFloat(nums[nums.length - 1]!) : undefined;
    const itemToks = toks.filter((t) => !isNumberToken(t) && !["price", "cost", "costs", "change", "set", "update", "make", "raise", "increase", "lower", "reduce", "new", "now", "to", "is", "of", "the"].includes(t));
    const m = findMenuItem(itemToks, index);
    if (!m) return { reply: { text: "Which menu item’s price should I change?" }, ctx };
    if (price === undefined) return { reply: { text: `What should the new price of ${m.entry.name} be? It’s currently ${peso(m.entry.price)}.` }, ctx };
    if (price === m.entry.price) return { reply: { text: `${m.entry.name} is already ${peso(price)}.` }, ctx };
    return confirmReply(ctx, { kind: "setPrice", catId: m.entry.catId, itemId: m.entry.id, price },
      `Change ${m.entry.name} from ${peso(m.entry.price)} to ${peso(price)}? Bills already open keep their old price.`, "Change price", `${m.entry.name} is now ${peso(price)}.`, true);
  }

  if (has(toks, "menu")) {
    // Add: "add tapsilog to the menu for 95 under rice meals"
    if (has(toks, "add", "create", "new", "put")) {
      const m = /(?:add|create|put|new(?: item)?)\s+(?:an? |new |item )*(.+?)\s+(?:to|on|in|into)\s+(?:the\s+)?menu\b(.*)$/i.exec(raw);
      const name = m?.[1]?.replace(/^(an?|new|item)\s+/i, "").trim();
      const tail = m?.[2] ?? "";
      const priceM = /(\d+(?:\.\d+)?)/.exec(tail) ?? /(\d+(?:\.\d+)?)/.exec(raw);
      if (!name) return { reply: { text: "Tell me the item and price, like “add tapsilog to the menu for 95 under Rice Meals”." }, ctx };
      if (!priceM) return { reply: { text: `What’s the price of ${titleCase(name)}? Say “add ${name} to the menu for 95”.` }, ctx };
      const price = parseFloat(priceM[1]!);
      const catM = /\b(?:under|in|into|category)\s+(?:the\s+)?(.+?)(?:\s+(?:category|section))?\s*$/i.exec(tail.replace(/\bfor\s+\d+(\.\d+)?\s*(pesos?)?/i, "").trim());
      let catId: number | null = null;
      let newCategory: string | undefined;
      if (catM?.[1]) {
        catId = findCategory(prepareTokens(catM[1]), index);
        if (catId === null) newCategory = titleCase(catM[1].trim()).slice(0, 24);
      } else {
        newCategory = data.menu.find((c) => c.cat.toLowerCase() === "others") ? undefined : "Others";
        catId = data.menu.find((c) => c.cat.toLowerCase() === "others")?.id ?? null;
      }
      const display = titleCase(name).slice(0, 40);
      if (findMenuItem(display, index)?.entry.name.toLowerCase() === display.toLowerCase()) {
        return { reply: { text: `${display} is already on the menu.` }, ctx };
      }
      const catName = catId !== null ? data.menu.find((c) => c.id === catId)!.cat : newCategory!;
      return confirmReply(ctx, { kind: "addMenuItem", catId, newCategory: catId === null ? newCategory : undefined, name: display, price },
        `Add ${display} (${peso(price)}) to the menu under ${catName}?`, "Add to menu", `${display} added to the menu under ${catName}.`, true);
    }
    // Remove: "remove pastil from the menu"
    if (has(toks, "remove", "delete", "take")) {
      const itemToks = toks.filter((t) => !["remove", "delete", "take", "off", "from", "the", "menu"].includes(t));
      const m = findMenuItem(itemToks, index);
      if (!m) return { reply: { text: "Which item should I remove from the menu?" }, ctx };
      return confirmReply(ctx, { kind: "removeMenuItem", catId: m.entry.catId, itemId: m.entry.id },
        `Remove ${m.entry.name} from the menu? Past sales keep their records.`, "Remove item", `${m.entry.name} removed from the menu.`, true);
    }
  }
  return null;
}

function queries(raw: string, toks: string[], norm: string, rest: string[], explicitTable: number | null, world: World, ctx: AgentContext, index: MenuIndex): RespondResult | null {
  const data = world.data;
  const question = has(toks, "what", "how", "which", "who", "show", "list", "tell", "check", "whats", "any", "is", "are", "do", "did", "much", "many") || raw.trim().endsWith("?");

  // Open / unpaid tables
  if ((has(toks, "open", "unpaid", "occupied", "pending", "active", "busy") && has(toks, "table", "tables", "bills", "bill", "orders", "order")) || hasPhrase(norm, "who has not paid", "who hasnt paid", "not paid yet", "still open", "outstanding")) {
    const open = data.tableList
      .map((t) => ({ t, splits: data.tables[t.id] ?? [] }))
      .filter((x) => x.splits.some((s) => s.items.length));
    if (!open.length) return { reply: { text: "All tables are clear — no open bills." }, ctx };
    const rows = open.map((x) => {
      const total = x.splits.reduce((s, sp) => s + splitTotal(sp), 0);
      const n = x.splits.filter((s) => s.items.length).length;
      return { label: tableName(data, x.t.id), value: peso(total), sub: n > 1 ? `${n} bills` : undefined, total };
    });
    const sum = rows.reduce((s, r) => s + r.total, 0);
    return {
      reply: {
        text: `${plural(open.length, "table")} ${open.length === 1 ? "has" : "have"} open bills, ${peso(sum)} unpaid in total.`,
        card: { kind: "list", title: "Open bills", rows: rows.map(({ total: _t, ...r }) => r) },
      },
      ctx,
    };
  }

  // Sales / earnings
  const salesWords = has(toks, "sales", "sold", "sell", "earn", "earned", "earnings", "revenue", "income", "made", "kita", "benta", "gross");
  const totalSales = has(toks, "total") && !explicitTable && (has(toks, "today", "week", "month", "yesterday") || hasPhrase(norm, "all time"));
  if (salesWords || totalSales || hasPhrase(norm, "how much did we", "how are we doing", "how is business")) {
    const spec = extractPeriod(toks, norm, world) ?? { period: "today" };
    const txns = txnsForPeriod(data.history, spec, data.settings, world.now);
    const when = periodPhrase(spec, world);

    // A specific item or category: "how many pares did we sell today"
    const itemToks = rest.filter((t) => !["how", "many", "much", "did", "we", "sell", "sold", "sales", "of", "today", "yesterday", "week", "month", "this", "last", "all", "time", "total", "the", "have", "has", "been"].includes(t));
    const catId = has(toks, "many") || itemToks.length ? findCategory(itemToks, index) : null;
    const item = itemToks.length ? findMenuItem(itemToks, index) : null;
    if (catId !== null || item) {
      const cat = catId !== null ? data.menu.find((c) => c.id === catId) : null;
      const names = cat && (!item || item.entry.name.toLowerCase() === cat.cat.toLowerCase()) ? new Set(cat.items.map((i) => i.name)) : new Set([item!.entry.name]);
      const label = cat && names.size > 1 ? `${cat.cat} (all kinds)` : [...names][0]!;
      let qty = 0;
      let revenue = 0;
      const per = new Map<string, number>();
      for (const h of txns) for (const it of h.items) if (names.has(it.name)) {
        qty += it.qty;
        revenue += it.qty * it.price;
        per.set(it.name, (per.get(it.name) ?? 0) + it.qty);
      }
      return {
        reply: {
          text: qty ? `${label}: ${qty} sold ${when}, ${peso(revenue)} in sales.` : `No ${label} sold ${when} yet.`,
          card: per.size > 1 ? { kind: "list", title: `${label} · ${when}`, rows: [...per.entries()].sort((a, b) => b[1] - a[1]).map(([n, q]) => ({ label: n, value: `×${q}` })) } : undefined,
        },
        ctx,
      };
    }

    const s = summarize(txns);
    if (!s.orders) return { reply: { text: `No sales recorded ${when} yet.` }, ctx };
    const best = s.best[0];
    return {
      reply: {
        text: `Sales ${when}: ${peso(s.total)} from ${plural(s.orders, "order")} (${plural(s.itemsSold, "item")}).${best ? ` Best seller: ${best.name} ×${best.qty}.` : ""}`,
        speak: `Sales ${when}: ${pesoSpoken(s.total)} from ${plural(s.orders, "order")}.`,
        card: {
          kind: "stats",
          title: `${periodLabel(spec)} sales`,
          stats: [
            { label: "Earnings", value: peso(s.total) },
            { label: "Orders", value: String(s.orders) },
            { label: "Items", value: String(s.itemsSold) },
          ],
          rows: s.best.slice(0, 3).map((b) => ({ label: b.name, value: `×${b.qty}` })),
        },
        suggestions: spec.period === "today" ? ["Sales this week", "Best seller this month"] : ["Sales today"],
      },
      ctx,
    };
  }

  // Best sellers
  if (has(toks, "best", "top", "popular", "bestseller", "bestsellers", "favorite", "most")) {
    const spec = extractPeriod(toks, norm, world) ?? { period: "today" };
    const s = summarize(txnsForPeriod(data.history, spec, data.settings, world.now));
    const when = periodPhrase(spec, world);
    if (!s.best.length) return { reply: { text: `No sales ${when} yet, so no best seller.` }, ctx };
    return {
      reply: {
        text: `Best seller ${when}: ${s.best[0]!.name} ×${s.best[0]!.qty}.`,
        card: { kind: "list", title: `Top items · ${when}`, rows: s.best.slice(0, 5).map((b, i) => ({ label: `${i + 1}. ${b.name}`, value: `×${b.qty}`, sub: peso(b.revenue) })) },
      },
      ctx,
    };
  }

  // Order count
  if (hasPhrase(norm, "how many orders", "how many transactions", "how many customers", "number of orders")) {
    const spec = extractPeriod(toks, norm, world) ?? { period: "today" };
    const n = txnsForPeriod(data.history, spec, data.settings, world.now).length;
    return { reply: { text: `${plural(n, "paid order")} ${periodPhrase(spec, world)}.` }, ctx };
  }

  // Last orders
  if (hasPhrase(norm, "last order", "latest order", "recent orders", "last sale", "last payment", "last transaction")) {
    const last = data.history.slice(-5).reverse();
    if (!last.length) return { reply: { text: "No paid orders yet." }, ctx };
    return {
      reply: {
        text: `The last paid order was ${tableName(data, last[0]!.table)} at ${fmtTime(last[0]!.ts)} for ${peso(last[0]!.total)}.`,
        card: { kind: "list", title: "Recent orders", rows: last.map((h) => ({ label: `${fmtTime(h.ts)} · ${tableName(data, h.table)}`, value: peso(h.total), sub: h.items.map((i) => `${i.qty}× ${i.name}`).join(", ") })) },
      },
      ctx,
    };
  }

  // Table status: "what's on table 3", "how much is table 2", "table 3 total"
  if (explicitTable !== null) {
    const contentLeft = parseItems(rest, index).lines.length;
    const statusWords = has(toks, "bill", "total", "status", "check", "what", "whats", "show", "much", "owe", "balance", "order", "orders") && !has(toks, "add", "paid", "pay");
    if ((statusWords || (question && !contentLeft)) && !contentLeft) {
      return { reply: statusReply(world, explicitTable), ctx: rememberTable(ctx, explicitTable, world) };
    }
  } else if (hasPhrase(norm, "what is on this table", "this table", "current bill", "the bill", "how much is the bill") && contextTable(world, ctx) !== null && question) {
    const tid = contextTable(world, ctx)!;
    return { reply: statusReply(world, tid), ctx };
  }

  // Price of an item: "how much is pares with egg", "price of mami"
  if ((hasPhrase(norm, "how much", "price of", "cost of", "how much does") || has(toks, "price", "prices", "cost")) && explicitTable === null) {
    const itemToks = rest.filter((t) => !["how", "much", "is", "the", "price", "prices", "of", "cost", "does", "a", "an", "what", "whats"].includes(t));
    const m = findMenuItem(itemToks, index);
    if (m) return { reply: { text: `${m.entry.name} is ${peso(m.entry.price)}.` }, ctx };
    const catId = findCategory(itemToks, index);
    if (catId !== null) {
      const cat = data.menu.find((c) => c.id === catId)!;
      return { reply: { text: `${cat.cat} prices:`, card: { kind: "list", title: cat.cat, rows: cat.items.map((i) => ({ label: i.name, value: peso(i.price) })) } }, ctx };
    }
  }

  // Menu listing
  if ((has(toks, "menu") && (question || toks.length <= 3)) || hasPhrase(norm, "what do you have", "what do we have", "what do we sell", "what do we serve", "list items", "list the items")) {
    const catId = findCategory(toks.filter((t) => t !== "menu"), index);
    const cats = catId !== null ? data.menu.filter((c) => c.id === catId) : data.menu;
    return {
      reply: {
        text: catId !== null ? `Here’s ${cats[0]!.cat}:` : `The menu has ${plural(data.menu.reduce((s, c) => s + c.items.length, 0), "item")} in ${plural(data.menu.length, "category", "categories")}.`,
        card: { kind: "list", title: catId !== null ? cats[0]!.cat : "Menu", rows: cats.flatMap((c) => c.items.map((i) => ({ label: i.name, value: peso(i.price), sub: catId === null ? c.cat : undefined }))) },
      },
      ctx,
    };
  }

  // Table list
  if (hasPhrase(norm, "how many tables", "what tables", "list tables", "list the tables")) {
    return { reply: { text: `You have ${plural(data.tableList.length, "table")}: ${data.tableList.map((t) => (t.custom ? t.name : t.name)).join(", ")}.` }, ctx };
  }

  // Date / business day
  if (hasPhrase(norm, "what day is it", "what is the date", "today date", "what date")) {
    return { reply: { text: `Today’s business day is ${fmtDayLabel(parseISODate(businessDayKey(world.now, data.settings)))}.` }, ctx };
  }
  return null;
}

function statusReply(world: World, tableId: number): AgentReply {
  const data = world.data;
  const splits = (data.tables[tableId] ?? []).filter((s) => s.items.length);
  const name = tableName(data, tableId);
  if (!splits.length) return { text: `${name} is empty.`, suggestions: [`Pares for ${name}`] };
  if (splits.length === 1) {
    const card = billCard(world, tableId, (data.tables[tableId] ?? []).indexOf(splits[0]!));
    return { text: `${name}: ${linesText(splits[0]!.items)}. Total ${peso(splitTotal(splits[0]))}.`, speak: `${name} total is ${pesoSpoken(splitTotal(splits[0]))}.`, card };
  }
  const total = splits.reduce((s, sp) => s + splitTotal(sp), 0);
  return {
    text: `${name} has ${splits.length} bills totalling ${peso(total)}.`,
    card: { kind: "list", title: name, rows: (data.tables[tableId] ?? []).map((sp, i) => ({ label: `Split ${i + 1}`, value: peso(splitTotal(sp)), sub: linesText(sp.items) || "empty" })) },
  };
}

function helpReply(): AgentReply {
  return {
    text: "Here’s what I can do. Everything works offline.",
    card: {
      kind: "list",
      title: "Try saying",
      rows: [
        { label: "“2 pares with egg and rice for table 3”", sub: "Take orders — several items at once" },
        { label: "“and a water” · “make it 3” · “same for table 4”", sub: "Follow-ups remember the last table" },
        { label: "“remove 1 siomai from table 2”", sub: "Change a bill" },
        { label: "“table 3 paid 500 cash”", sub: "Settle a bill and get the change" },
        { label: "“what’s on table 1?” · “which tables are open?”", sub: "Check bills" },
        { label: "“how much did we sell today?” · “best seller this week”", sub: "Sales answers" },
        { label: "“change the price of mami to 55”", sub: "Edit the menu" },
        { label: "“split table 2” · “add table Takeout”", sub: "Manage tables and bills" },
        { label: "“export today’s report as pdf” · “undo”", sub: "Reports and corrections" },
      ],
    },
    suggestions: ["Which tables are open?", "How much did we sell today?", "Show the menu"],
  };
}
