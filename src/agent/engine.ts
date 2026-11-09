// Ask Agent — offline conversational engine.
//
// respond() is a pure function: (input, world snapshot, context) -> reply.
// It never mutates app data; it returns a Plan that the executor applies,
// either immediately (safe, undoable changes like adding items) or after the
// user confirms (payments, clearing, menu edits).

import type { AppData, MoneyMethod, TableDef } from "../data/types";
import { fmtElapsed, minutesSince, splitTotal, tableDisplayName, tableOpenedAt, tableTotal, tableUnserved } from "../lib/bill";
import { backupDue, expensesForPeriod, findAccount, isSoldOut, moneyBreakdown, utangAccounts, utangBalance } from "../lib/money";
import { howTo, isTaglish, smallTalk } from "./knowledge";
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
import type { AgentContext, AgentInput, AgentReply, Card, Line, Pending, Plan, Resumed, World } from "./types";

const CONTEXT_TTL_MS = 3 * 60 * 1000;
const LOW_CONFIDENCE = 0.8;

const PRICE_FILLER = new Set(["it", "its", "is", "the", "price", "pesos", "peso", "php", "each", "per", "piece", "for", "just", "only", "around", "about", "po", "lang", "na", "ay"]);

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
    tableId,
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

export function respond(input: AgentInput, world: World, ctx: AgentContext, opts: { split?: boolean } = {}): RespondResult {
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
      if (tableId !== null) {
        const out = pending.resume(tableId, world, cleared);
        return isResumed(out) ? { reply: out.reply, ctx: rememberTable(out.ctx, tableId, world) } : { reply: out, ctx: rememberTable(cleared, tableId, world) };
      }
      if (toks.some((t) => NO.has(t)) && toks.length <= 3) return { reply: { text: "Okay, cancelled." }, ctx: cleared };
      if (ref.missing) return { reply: { text: `There’s no Table ${ref.missing}. Which table should I use?`, suggestions: tableSuggestions(world.data) }, ctx };
      return respond(raw, world, cleared);
    }
    if (pending.kind === "needPrice") {
      // Only a bare price ("50", "₱50", "it's 50 pesos") answers the question;
      // anything else is a new request and the question is dropped.
      const rest = toks.filter((t) => !PRICE_FILLER.has(t));
      const price = rest.length === 1 && isNumberToken(rest[0]) && parseFloat(rest[0]!) > 0 ? parseFloat(rest[0]!) : undefined;
      if (price !== undefined) {
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
    if (pending.kind === "needName") {
      if (toks.some((t) => NO.has(t)) && toks.length <= 3) return { reply: { text: "Okay, cancelled." }, ctx: cleared };
      const name = nameFromAnswer(raw);
      if (name && toks.length <= 4) {
        const out = pending.resume(name, world, cleared);
        return isResumed(out) ? out : { reply: out, ctx: cleared };
      }
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
  const tl = isTaglish(raw);
  world = { ...world, tl };

  if (toks.length <= 3 && toks.every((t) => YES.has(t) || NO.has(t) || t === "po")) {
    return { reply: { text: "There’s nothing waiting for a yes or no right now. Tell me an order, or ask about a table or your sales.", suggestions: ["Which tables are open?", "Sales today"] }, ctx };
  }

  // ----- several commands in one message -----
  if (opts.split !== false) {
    const multi = multiCommand(toks, world, ctx);
    if (multi) return multi;
  }

  // ----- social / meta -----
  if (has(toks, "help", "commands", "examples") && toks.length <= 3 || hasPhrase(norm, "what can you do", "how to use", "what can i say", "what else can you do", "anong kaya mo", "what kaya mo")) {
    return { reply: helpReply(), ctx };
  }
  // Names: "ako si Rommel", "my name is Rommel", "call me Kuya"; "ano pangalan ko?"
  const intro = /^(?:ako si|ako ay si|my name is|my names|call me|tawagin mo akong|tawagin mo ako ng|tawagin mo kong|pangalan ko ay|pangalan ko|ang pangalan ko ay|im|i am)\s+([a-zñ][a-zñ'.-]*(?:\s+[a-zñ][a-zñ'.-]*)?)\s*(?:po|na lang|nalang)?$/.exec(norm);
  if (intro && !(/^(?:im|i am)\b/.test(norm) && NOT_A_NAME.test(intro[1]!))) {
    const name = intro[1]!.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    return {
      reply: {
        text: tl ? `Ikinagagalak kitang makilala, ${name}!` : `Nice to meet you, ${name}!`,
        execute: { kind: "setOwnerName", name },
        meta: { kind: "chat", topic: "myname", tl, bisaya: false, name },
      },
      ctx,
    };
  }
  // (Tokens are normalized: "what's" → "what", "ano/anong" → "what".)
  if (hasPhrase(norm, "what is my name", "what my name", "do you know my name", "know my name", "what pangalan ko", "sino ako", "kilala mo ba ako", "who am i", "unsa akong ngalan")) {
    const n = data.settings.agent.ownerName;
    return {
      reply: {
        text: n ? (tl ? `Ikaw si ${n}!` : `You’re ${n}!`) : tl ? "Hindi mo pa sinasabi — sabihin mo lang “ako si …”." : "You haven’t told me yet — just say “my name is …”.",
        meta: { kind: "chat", topic: "whatsmyname", tl, bisaya: false, name: n },
      },
      ctx,
    };
  }
  const chat = smallTalk(norm, raw, world.now.getHours());
  if (chat) {
    let text = tl ? chat.tl : chat.en;
    if (chat.status) {
      const top = insights(world)[0];
      text += ` ${statusLine(world, tl)}${top ? ` ${top.text}` : ""}`;
      if (/^(hi|hello|hey|good|magandang|kumusta|kamusta|musta|uy|oy|yo)/.test(norm) && !tl) text = text.replace("I’m here.", "Ready to take orders.");
    }
    return { reply: { text, suggestions: chat.status ? ["Which tables are open?", "Any tips?"] : undefined, meta: { kind: "chat", topic: chat.topic ?? "other", tl, bisaya: !!chat.bisaya, name: data.settings.agent.ownerName } }, ctx };
  }
  const topic = howTo(norm, raw);
  if (topic) {
    return { reply: { text: tl && topic.tl ? topic.tl : topic.en, link: topic.link, suggestions: topic.try }, ctx };
  }
  if (has(toks, "tips", "tip", "insight", "insights", "updates", "update", "status", "balita", "lagay") || hasPhrase(norm, "anything i should know", "what should i know", "how is tonight", "how is it going", "kumusta ang gabi", "kumusta benta", "kamusta benta", "musta benta")) {
    if (!has(toks, "table") || has(toks, "tips", "tip")) return { reply: tipsReply(world, tl), ctx };
  }

  // ----- corrections: "no, table 4", "mami pala" -----
  const corr = correctionReply(toks, norm, world, ctx, index);
  if (corr) return corr;

  // ----- undo -----
  // "undo", "undo table 4", "ibalik table 4" (the last change on that table only).
  if ((/^(undo|revert|scratch that|take that back|undo that|undo last|ibalik|bawiin)\b/.test(norm) || norm === "oops") && !hasPhrase(norm, "undo payment", "undo paid", "undo the payment")) {
    const ut = extractTable(toks, data);
    if (ut.tableId !== null) return { reply: { text: "Undone.", execute: { kind: "undo", tableId: ut.tableId } }, ctx: rememberTable(ctx, ut.tableId, world) };
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
  const navVerb = has(toks, "go", "open", "show", "navigate", "switch", "take", "view", "display", "bring", "start", "begin", "use");
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
  // ----- sold out -----
  const sold = soldOutReply(raw, toks, world, ctx, index);
  if (sold) return sold;

  // ----- expenses / profit -----
  const exp = expenseReply(raw, toks, norm, world, ctx);
  if (exp) return exp;

  // "add to table 3" with nothing else: remember the table and ask what to add.
  {
    const r0 = extractTable(toks, data);
    if (r0.tableId !== null && has(toks, "add", "order") && r0.rest.every((t) => ["add", "order", "to", "for", "sa", "on", "something", "items", "item", "po", "please", "the", "an", "a", "new"].includes(t))) {
      return { reply: { text: `What should I add to ${tableName(data, r0.tableId)}?`, suggestions: data.menu.slice(0, 4).map((c) => c.items[0]?.name ?? c.cat) }, ctx: rememberTable(ctx, r0.tableId, world) };
    }
  }

  if (has(toks, "add", "create", "new") && has(toks, "table") && !parseItems(extractTable(toks, data).rest, index).lines.length) {
    const m = /\btable\s+(?:called|named|for)?\s*["“]?([^"”]+?)["”]?$/i.exec(raw.trim());
    const name = m?.[1]?.trim().slice(0, 24);
    if (name) {
      if (data.tableList.some((t) => t.name.toLowerCase() === name.toLowerCase())) return { reply: { text: `There’s already a table called “${name}”.` }, ctx };
      return { reply: { text: `Added a new table “${name}”.`, execute: { kind: "addTable", name }, undoable: true }, ctx };
    }
    return { reply: { text: "What should the new table be called? Say for example “add table Takeout”." }, ctx };
  }
  const TABLE_ADMIN_WORDS = new Set(["remove", "delete", "the", "a", "table", "please", "po", "custom", "this", "that"]);
  if (has(toks, "remove", "delete") && has(toks, "table") && extractTable(toks, data).rest.every((t) => TABLE_ADMIN_WORDS.has(t))) {
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

  // ----- utang (credit) -----
  const ut = utangReply(raw, toks, norm, world, ctx, explicitTable, rest);
  if (ut) return ut;

  // ----- serving & waiting -----
  const sv = serveReply(raw, toks, world, ctx, index, explicitTable, rest);
  if (sv) return sv;

  // ----- notes on an item already on the bill -----
  const nt = setNoteReply(toks, world, ctx, index, explicitTable, rest);
  if (nt) return nt;

  // ----- money: profit, gcash/maya/cash totals -----
  const money = moneyReply(toks, norm, world, ctx, explicitTable);
  if (money) return money;

  // ----- move a bill to another table: "move table 2 to table 4" -----
  if (has(toks, "move", "transfer", "lipat") && explicitTable !== null) {
    const to = secondTable(rest, data, explicitTable);
    if (to === null) {
      return askTable(ctx, world, `Move ${tableName(data, explicitTable)}’s bill to which table?`, (tid, w, c) => moveReply(w, explicitTable, tid, c));
    }
    return moveReply(world, explicitTable, to, rememberTable(ctx, to, world));
  }

  // ----- change for an amount: "change for 500 on table 2", "sukli sa 1000" -----
  if (has(toks, "change") && !has(toks, "price", "menu", "theme", "name", "hours", "mode", "to", "cost") && rest.some(isNumberToken)) {
    const cash = Math.max(...rest.filter(isNumberToken).map(Number));
    const tableId = explicitTable ?? contextTable(world, ctx);
    if (tableId === null) return askTable(ctx, world, `Change from ${peso(cash)} for which table?`, (tid, w) => changeReply(w, tid, cash));
    return { reply: changeReply(world, tableId, cash), ctx: rememberTable(ctx, tableId, world) };
  }

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
    const method: MoneyMethod = has(toks, "gcash") ? "gcash" : has(toks, "maya") ? "maya" : "cash";
    const cash = method === "cash" ? extractAmount(rest, ["cash", "received", "gave", "give", "tendered", "with", "change", "pera", "bayad"]) ?? numbersOtherThanTable(rest) : undefined;
    const sp = extractSplit(rest);
    if (tableId === null) {
      return askTable(ctx, world, "Which table is paying?", (tid, w, c) => payReply(w, tid, sp.split, cash, c, method));
    }
    return payReply(world, tableId, sp.split, cash, rememberTable(ctx, tableId, world), method);
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
      if (tableId === null) return askTable(ctx, world, "Which table should I clear?", (tid, w, c) => clearReply(w, tid, c));
      return clearReply(world, tableId, rememberTable(ctx, tableId, world));
    }
  }

  // ----- remove items -----
  const removeWords = has(toks, "remove", "delete", "minus", "less", "drop", "cancel", "subtract", "deduct", "without") || hasPhrase(norm, "take off", "take away", "no more", "dont want");
  if (removeWords) {
    const cleaned = rest.filter((t) => !["remove", "delete", "minus", "less", "drop", "cancel", "subtract", "deduct", "take", "off", "away", "from", "no", "more", "not", "dont", "want", "the"].includes(t));
    const parsed = parseItems(cleaned, index);
    let tableId = explicitTable ?? contextTable(world, ctx);
    if (parsed.lines.length && explicitTable === null) {
      // "cancel pares" with no table: use the table that actually has it.
      const hasAll = (tid: number) => parsed.lines.every((p) => (data.tables[tid] ?? []).some((sp) => sp.items.some((i) => i.name === p.item.name)));
      if (tableId === null || !hasAll(tableId)) {
        const holders = data.tableList.map((t) => t.id).filter(hasAll);
        if (holders.length === 1) tableId = holders[0]!;
        else if (holders.length > 1) {
          const what = parsed.lines.map((p) => p.item.name).join(" and ");
          return askTable(ctx, world, `${what} is on ${holders.map((h) => tableName(data, h)).join(" and ")}. Which table?`, (tid, w) => removeReply(w, tid, parsed.lines, cleaned));
        }
      }
    }
    if (parsed.lines.length) {
      if (tableId === null) return askTable(ctx, world, "Which table should I remove that from?", (tid, w) => removeReply(w, tid, parsed.lines, cleaned));
      return { reply: removeReply(world, tableId, parsed.lines, cleaned), ctx: rememberTable(ctx, tableId, world) };
    }
  }

  // ----- swap an item: "change pares to mami" -----
  const sw = swapReply(toks, world, ctx, index, explicitTable, rest);
  if (sw) return sw;

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
  const isRepeat = /^(another (?:one|1)|(?:one|1) more|same again|again|same|same order|repeat|repeat that|same for|same thing)\b/.test(restNorm) || hasPhrase(norm, "same for", "same order for", "same thing for");
  if (isRepeat && ctx.lastLines.length) {
    const tableId = explicitTable ?? contextTable(world, ctx);
    if (tableId === null) return askTable(ctx, world, "Which table is that for?", (tid, w, c) => addReply(w, c, tid, ctx.lastLines, []));
    return addReply(world, rememberTable(ctx, tableId, world), tableId, ctx.lastLines, []);
  }

  // ----- add items (the default) -----
  const noted = extractNotes(rest, index);
  const parsed = parseItems(noted.rest, index);
  if (noted.notes.length && parsed.lines.length) attachNotes(parsed.lines, noted.rest, noted.notes);
  // An unknown phrase only becomes a custom-item offer when it clearly is an
  // order: a short name with a quantity or an "add/order" verb.
  const orderish = parsed.unknownItems.length === 1 && parsed.unknownItems[0]!.text.split(" ").length <= 3 &&
    (parsed.unknownItems[0]!.explicitQty || has(toks, "add", "order", "give", "get", "want") ||
      (explicitTable !== null && !has(toks, "what", "how", "why", "when", "where", "who", "which", "whats")));
  if (parsed.lines.length || orderish) {
    const lines = parsed.lines.map(toLine);
    const lowConfidence = parsed.lines.filter((l) => l.confidence < LOW_CONFIDENCE);
    const tableId = explicitTable ?? contextTable(world, ctx);
    if (tableId === null) {
      return askTable(ctx, world, lines.length ? `Which table is ${linesText(lines)} for?` : "Which table is this for?", (tid, w, c) =>
        addReply(w, c, tid, lines, parsed.unknown, lowConfidence, parsed.unknownItems[0]?.qty ?? 1));
    }
    return addReply(world, rememberTable(ctx, tableId, world), tableId, lines, parsed.unknown, lowConfidence, parsed.unknownItems[0]?.qty ?? 1);
  }

  // ----- nothing matched -----
  const sug = suggestItems(raw, index);
  if (sug.length && toks.length <= 4) {
    return {
      reply: {
        text: `I’m not sure what you meant. Did you mean ${sug.map((s) => `“${s.name}”`).join(" or ")}?`,
        suggestions: sug.map((s) => s.name),
        tone: "warn",
      },
      ctx,
    };
  }
  return {
    reply: {
      text: "Sorry, I didn’t understand that. Try an order like “2 mami and a water for table 1”, or a question like “how much did we sell today?”.",
      suggestions: ["What can you do?", "Which tables are open?", "Show the menu"],
      tone: "warn",
      meta: { kind: "unknown", tl, tableName: explicitTable !== null ? tableName(data, explicitTable) : undefined },
    },
    ctx,
  };
}

// ---------- intent handlers ----------

function toLine(p: ParsedLine): Line {
  const note = (p as ParsedLine & { note?: string }).note;
  return { name: p.item.name, price: p.item.price, qty: p.qty, ...(note ? { note } : {}) };
}

/** Gives each note to the item said just before it ("2 pares walang sibuyas, 1 mami"). */
function attachNotes(lines: ParsedLine[], toks: string[], notes: { at: number; text: string }[]) {
  let cursor = 0;
  const starts = lines.map((l) => {
    const first = l.heard.split(" ")[0] ?? "";
    const i = toks.indexOf(first, cursor);
    if (i >= 0) cursor = i + 1;
    return i < 0 ? cursor : i;
  });
  for (const n of notes) {
    let k = 0;
    for (let i = 0; i < lines.length; i++) if (starts[i]! < n.at) k = i;
    const l = lines[k] as ParsedLine & { note?: string };
    l.note = l.note ? `${l.note}, ${n.text}` : noteText(n.text);
  }
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

function isResumed(x: AgentReply | Resumed): x is Resumed {
  return typeof (x as Resumed).reply === "object" && (x as Resumed).ctx !== undefined;
}

function askTable(ctx: AgentContext, world: World, question: string, resume: (tid: number, w: World, c: AgentContext) => AgentReply | Resumed): RespondResult {
  const pending: Pending = { kind: "needTable", resume };
  return { reply: { text: question, suggestions: tableSuggestions(world.data) }, ctx: { ...ctx, pending } };
}

function confirmReply(ctx: AgentContext, plan: Plan, question: string, yes: string, doneText: string, undoable = false, card?: Card): RespondResult {
  return {
    reply: { text: question, card, confirm: { plan, yes, doneText } },
    ctx: { ...ctx, pending: { kind: "confirm", plan, doneText, undoable } },
  };
}

function addReply(world: World, ctx: AgentContext, tableId: number, lines: Line[], unknown: string[], lowConfidence: ParsedLine[] = [], unknownQty = 1): RespondResult {
  const data = world.data;
  const split = splitFor(world, tableId);
  const name = tableName(data, tableId);
  let nextCtx: AgentContext = { ...ctx, lastLines: lines.length ? lines : ctx.lastLines };

  if (!lines.length) {
    const u = unknown[0]!;
    const sug = suggestItems(u, menuIndex(data));
    nextCtx = { ...nextCtx, pending: { kind: "needPrice", name: u, qty: unknownQty, tableId, split } };
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
  const soldOut = lines.filter((l) => data.menu.some((c) => c.items.some((i) => i.name === l.name && i.price === l.price && isSoldOut(i, data.settings, world.now))));
  const needsConfirm = data.settings.agent.confirmAdds || lowConfidence.length > 0 || soldOut.length > 0;
  if (needsConfirm) {
    const heard = lowConfidence.map((l) => `“${l.heard}” → ${l.item.name}`).join(", ");
    const out = soldOut.length ? `${soldOut.map((l) => l.name).join(" and ")} ${soldOut.length > 1 ? "are" : "is"} marked sold out. ` : "";
    const q = `${out}Add ${linesText(lines)} to ${name}${out ? " anyway" : ""}?${heard ? ` (I matched ${heard}.)` : ""}`;
    const r = confirmReply(nextCtx, plan, q, "Add to bill", text, true, card);
    return { reply: { ...r.reply, speak: `Add ${spokenLines(lines)} to ${name}?` }, ctx: r.ctx };
  }
  if (unknown.length === 1 && unknown[0]!.split(" ").length <= 3) nextCtx = { ...nextCtx, pending: { kind: "needPrice", name: unknown[0]!, qty: unknownQty, tableId, split } };
  nextCtx = { ...nextCtx, lastAdd: { tableId, split, lines, at: world.now.getTime() } };
  const meta = unknown.length ? undefined : ({ kind: "added", table: name, items: linesText(lines), units: lines.reduce((u, l) => u + l.qty, 0), total: card.kind === "bill" ? card.total : 0, tl: !!world.tl } as const);
  return { reply: { text, speak, execute: plan, undoable: true, card, meta }, ctx: nextCtx };
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
  const after = billCard(world, tableId, split, [], removals);
  return {
    meta: missing.length ? undefined : { kind: "removed", table: name, items: desc, total: after.kind === "bill" ? after.total : 0, tl: !!world.tl },
    text: `Removed ${desc} from ${name}.${missing.length ? ` (${missing.join(", ")} wasn’t on the bill.)` : ""}`,
    execute: { kind: "removeItems", tableId, split, items: removals },
    undoable: true,
    card: billCard(world, tableId, split, [], removals),
  };
}

function payReply(world: World, tableId: number, splitSel: number | "all" | null, cash: number | undefined, ctx: AgentContext, method: MoneyMethod | "utang" = "cash", customer?: string): RespondResult {
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
      ctx: { ...ctx, pending: method === "cash" ? { kind: "needSplit", tableId, cash } : null },
    };
  }

  const total = chosen.reduce((s, i) => s + splitTotal(splits[i]), 0);
  const lines = chosen.flatMap((i) => splits[i]!.items);
  if (cash !== undefined && cash < total) {
    return { reply: { text: `Cash of ${peso(cash)} is short by ${peso(total - cash)}. ${name}’s total is ${peso(total)}.`, tone: "warn" }, ctx };
  }
  const changeText = cash !== undefined ? ` Cash ${peso(cash)}, change ${peso(cash - total)}.` : "";
  const splitText = splits.length > 1 ? (chosen.length > 1 ? " (all bills)" : ` (Split ${chosen[0]! + 1})`) : "";
  if (method === "utang" && customer) {
    const owes = findAccount(data.history, customer)?.balance ?? 0;
    // Done right away (no "are you sure?"): "undo" brings the bill back.
    return {
      reply: {
        text: `${name}${splitText} — ${peso(total)} added to ${customer}’s utang.${owes ? ` Total owed: ${peso(owes + total)}.` : ""}`,
        execute: { kind: "pay", tableId, splits: chosen, method, customer },
        undoable: true,
        meta: { kind: "utang", table: name, total, customer, tl: !!world.tl },
        card: { kind: "bill", title: `${name}${splitText} · utang`, lines, total, note: `Utang · ${customer}`, tableId },
      },
      ctx,
    };
  }
  const via = method === "gcash" ? " via GCash" : method === "maya" ? " via Maya" : "";
  const card: Card = {
    kind: "bill",
    title: `${name}${splitText}`,
    lines,
    total,
    note: cash !== undefined ? `Cash ${peso(cash)} · Change ${peso(cash - total)}` : undefined,
  };
  // Payments happen right away (no "are you sure?"); "undo" or "undo table N" reopens the bill.
  return {
    reply: {
      text: `${name}${splitText} paid${via} — ${peso(total)} recorded.${changeText}`,
      speak: `${name} paid${via}, ${pesoSpoken(total)}.${cash !== undefined ? ` Change ${pesoSpoken(cash - total)}.` : ""}`,
      execute: { kind: "pay", tableId, splits: chosen, cash, ...(method !== "cash" ? { method } : {}) },
      undoable: true,
      meta: (() => {
        const dt = dayTotals(world);
        const stillOpen = openTables(data).filter((o) => o.t.id !== tableId || chosen.length < nonEmpty.length).length;
        return { kind: "paid" as const, table: name, total, method: method === "utang" ? "cash" : method, change: cash !== undefined ? cash - total : undefined, todayBefore: dt.today, yesterday: dt.yesterday, ordersBefore: dt.orders, stillOpen, tl: !!world.tl };
      })(),
      card: method !== "cash" ? ({ ...card, note: `Paid${via}` } as Card) : { ...card, note: card.note ?? "Paid · cash" },
    },
    ctx,
  };
}

function secondTable(rest: string[], data: AppData, from: number): number | null {
  const ref = extractTable(rest, data);
  if (ref.tableId !== null && ref.tableId !== from) return ref.tableId;
  // "move table 2 to 4": the second table without the word "table"
  for (let i = 0; i < rest.length - 1; i++) {
    if (!["to", "into", "sa", "onto", "with"].includes(rest[i]!)) continue;
    const name = rest[i + 1]!;
    const tb = data.tableList.find((t) => t.id !== from && prepareTokens(t.name).join(" ") === name);
    if (tb) return tb.id;
  }
  return null;
}

function moveReply(world: World, from: number, to: number, ctx: AgentContext): RespondResult {
  const data = world.data;
  if (!data.tableList.some((t) => t.id === to)) return { reply: { text: "That table doesn’t exist.", tone: "warn" }, ctx };
  if (from === to) return { reply: { text: "That’s the same table." }, ctx };
  const bills = (data.tables[from] ?? []).filter((s) => s.items.length);
  if (!bills.length) return { reply: { text: `${tableName(data, from)} has no open bill to move.`, tone: "warn" }, ctx };
  const total = bills.reduce((s, b) => s + splitTotal(b), 0);
  const targetBusy = (data.tables[to] ?? []).some((s) => s.items.length);
  return confirmReply(ctx, { kind: "moveTable", from, to },
    `Move ${tableName(data, from)}’s ${bills.length > 1 ? `${bills.length} bills` : "bill"} (${peso(total)}) to ${tableName(data, to)}?${targetBusy ? ` ${tableName(data, to)} already has a bill; it will be kept as a separate split.` : ""}`,
    "Move bill", `Moved to ${tableName(data, to)}.`, true,
    { kind: "bill", title: `${tableName(data, from)} → ${tableName(data, to)}`, lines: bills.flatMap((b) => b.items), total, tableId: to });
}

function changeReply(world: World, tableId: number, cash: number): AgentReply {
  const data = world.data;
  const name = tableName(data, tableId);
  const splits = (data.tables[tableId] ?? []).filter((s) => s.items.length);
  if (!splits.length) return { text: `${name} has no open bill.`, tone: "warn" };
  const split = splitFor(world, tableId);
  const total = splits.length > 1 ? splitTotal((data.tables[tableId] ?? [])[split]) || splitTotal(splits[0]) : splitTotal(splits[0]);
  const diff = cash - total;
  const text = diff >= 0 ? `${name} total is ${peso(total)}. From ${peso(cash)}, the change is ${peso(diff)}.` : `${name} total is ${peso(total)}. ${peso(cash)} is short by ${peso(-diff)}.`;
  return {
    text,
    speak: diff >= 0 ? `Change is ${pesoSpoken(diff)}.` : `Short by ${pesoSpoken(-diff)}.`,
    tone: diff >= 0 ? undefined : "warn",
    suggestions: diff >= 0 ? [`${name} paid ${cash}`] : [],
  };
}

function compareReply(toks: string[], world: World): AgentReply {
  const data = world.data;
  const today = businessDayKey(world.now, data.settings);
  let a: PeriodSpec;
  let b: PeriodSpec;
  let aName: string;
  let bName: string;
  if (has(toks, "month", "monthly")) {
    const d = parseISODate(today);
    const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    a = { period: "month" };
    b = { period: "custom", from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) };
    aName = "This month";
    bName = "Last month";
  } else if (has(toks, "week", "weekly")) {
    const dow = (parseISODate(today).getDay() + 6) % 7;
    const mon = addDays(today, -dow);
    a = { period: "week" };
    b = { period: "custom", from: addDays(mon, -7), to: addDays(mon, -1) };
    aName = "This week";
    bName = "Last week";
  } else {
    a = { period: "today" };
    b = { period: "custom", from: addDays(today, -1), to: addDays(today, -1) };
    aName = "Today";
    bName = "Yesterday";
  }
  const sa = summarize(txnsForPeriod(data.history, a, data.settings, world.now));
  const sb = summarize(txnsForPeriod(data.history, b, data.settings, world.now));
  const diff = sa.total - sb.total;
  const pct = sb.total > 0 ? Math.round((diff / sb.total) * 100) : null;
  const trend = diff === 0 ? "the same as" : `${peso(Math.abs(diff))} ${diff > 0 ? "more than" : "less than"}`;
  return {
    text: `${aName}: ${peso(sa.total)} (${plural(sa.orders, "order")}). ${bName}: ${peso(sb.total)} (${plural(sb.orders, "order")}). That’s ${trend} ${bName.toLowerCase()}${pct !== null && diff !== 0 ? ` (${diff > 0 ? "+" : "−"}${Math.abs(pct)}%)` : ""}.`,
    card: {
      kind: "stats",
      title: `${aName} vs ${bName.toLowerCase()}`,
      stats: [
        { label: aName, value: peso(sa.total) },
        { label: bName, value: peso(sb.total) },
        { label: "Change", value: pct === null ? (diff ? peso(diff) : "—") : `${diff >= 0 ? "+" : "−"}${Math.abs(pct)}%` },
      ],
      rows: [
        { label: "Orders", value: `${sa.orders} vs ${sb.orders}` },
        { label: "Avg order", value: `${peso(sa.orders ? sa.total / sa.orders : 0)} vs ${peso(sb.orders ? sb.total / sb.orders : 0)}` },
      ],
    },
  };
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
  if (hasPhrase(norm, "utang list", "utang screen", "credit list", "utang page")) return { route: { name: "utang" }, text: "Opening the utang list." };
  if (hasPhrase(norm, "talk mode", "voice mode", "voice conversation", "hands free mode", "usap tayo", "lets talk", "let us talk", "conversation mode")) return { route: { name: "talk" }, text: "Starting Talk mode." };
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
      // "add menu item kwek kwek 20", "new menu item tapsilog for 95 under rice meals"
      const alt = /(?:add|create|new|put)\s+(?:an?\s+)?(?:new\s+)?menu\s+item\s+(.+?)\s*(?:for|at|=|price|presyo)?\s*(?:₱|php)?\s*(\d+(?:\.\d+)?)\s*(?:pesos?)?(.*)$/i.exec(raw);
      const m = alt ? ([alt[0], alt[1], ` for ${alt[2]}${alt[3] ?? ""}`] as unknown as RegExpExecArray) : /(?:add|create|put|new(?: item)?)\s+(?:an? |new |item )*(.+?)\s+(?:to|on|in|into)\s+(?:the\s+)?menu\b(.*)$/i.exec(raw);
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

  // Comparisons: "compare today and yesterday", "this week vs last week"
  if (has(toks, "compare", "compared", "vs", "versus") || hasPhrase(norm, "than yesterday", "than last week", "better than", "worse than")) {
    return { reply: compareReply(toks, world), ctx };
  }

  // Average order value
  if (has(toks, "average", "avg", "aov") || hasPhrase(norm, "per order", "per customer")) {
    const spec = extractPeriod(toks, norm, world) ?? { period: "today" };
    const s = summarize(txnsForPeriod(data.history, spec, data.settings, world.now));
    const when = periodPhrase(spec, world);
    if (!s.orders) return { reply: { text: `No paid orders ${when} yet.` }, ctx };
    return {
      reply: {
        text: `Average order ${when}: ${peso(s.total / s.orders)} across ${plural(s.orders, "order")}, about ${(s.itemsSold / s.orders).toFixed(1)} items each.`,
        card: { kind: "stats", title: `Averages · ${when}`, stats: [{ label: "Avg order", value: peso(s.total / s.orders) }, { label: "Orders", value: String(s.orders) }, { label: "Items/order", value: (s.itemsSold / s.orders).toFixed(1) }] },
      },
      ctx,
    };
  }

  // Busiest hours: "what time is busiest", "peak hour"
  if (has(toks, "busiest", "peak", "rush") || hasPhrase(norm, "busy hours", "busiest time", "what time do we sell")) {
    const spec = extractPeriod(toks, norm, world) ?? { period: "custom", from: addDays(businessDayKey(world.now, data.settings), -29), to: businessDayKey(world.now, data.settings) };
    const txns = txnsForPeriod(data.history, spec, data.settings, world.now);
    if (!txns.length) return { reply: { text: "There aren’t enough sales yet to find your busiest hours." }, ctx };
    const byHour = new Map<number, { orders: number; total: number }>();
    for (const h of txns) {
      const hr = new Date(h.ts).getHours();
      const b = byHour.get(hr) ?? { orders: 0, total: 0 };
      b.orders++;
      b.total += h.total;
      byHour.set(hr, b);
    }
    const ranked = [...byHour.entries()].sort((a, b) => b[1].orders - a[1].orders || b[1].total - a[1].total);
    const label = (hr: number) => `${formatMinutesAsTime(hr * 60).replace(":00", "")}–${formatMinutesAsTime(((hr + 1) % 24) * 60).replace(":00", "")}`;
    const when = spec.period === "custom" && spec.from !== spec.to && !extractPeriod(toks, norm, world) ? "over the last 30 days" : periodPhrase(spec, world);
    return {
      reply: {
        text: `Your busiest hour ${when} is ${label(ranked[0]![0])} with ${plural(ranked[0]![1].orders, "order")}.`,
        card: { kind: "list", title: `Busiest hours · ${when}`, rows: ranked.slice(0, 5).map(([hr, b]) => ({ label: label(hr), value: peso(b.total), sub: plural(b.orders, "order") })) },
      },
      ctx,
    };
  }

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
    text: "Here’s what I can do — all offline, in English or Taglish. You can also ask me how to do anything in the app, like “paano mag-utang?”.",
    card: {
      kind: "list",
      title: "Try saying",
      rows: [
        { label: "“2 pares with egg, 1 mami walang sibuyas for table 3”", sub: "Orders, several items and notes at once" },
        { label: "“2 pares for table 1 and 3 siomai for table 2”", sub: "Several tables in one go" },
        { label: "“no, table 4” · “mami pala” · “make it 3”", sub: "Fix the last order" },
        { label: "“table 3 paid 500” · “table 2 paid gcash”", sub: "Pay with cash, GCash or Maya" },
        { label: "“table 2 utang ni Ben” · “Ben paid 100” · “sino may utang?”", sub: "Utang (pay later)" },
        { label: "“served na table 2” · “sino naghihintay?”", sub: "Serving and wait times" },
        { label: "“ubos na ang pastil” · “pastil available na”", sub: "Sold out for today" },
        { label: "“gastos 300 sa yelo” · “profit today”", sub: "Expenses and profit" },
        { label: "“how much did we sell today?” · “compare today and yesterday”", sub: "Sales answers and insights" },
        { label: "“any tips?” · “kumusta benta?”", sub: "What needs attention right now" },
        { label: "“move table 2 to table 4” · “split table 2”", sub: "Move or split bills" },
        { label: "“change the price of mami to 55” · “export today as pdf”", sub: "Menu and reports" },
        { label: "“talk mode”", sub: "Hands-free voice conversation" },
      ],
    },
    suggestions: ["Any tips?", "Which tables are open?", "Paano mag-backup?"],
  };
}

// =====================================================================
// v18 skills: conversation, how-to, corrections, multi-commands, utang,
// payment methods, sold out, notes, serving, expenses, profit, tips.
// =====================================================================

const DAY_MS = 24 * 3600e3;

/** Sales today and yesterday (business days), for the persona's remarks. */
function dayTotals(world: World): { today: number; orders: number; yesterday: number } {
  const d = world.data;
  const t = summarize(txnsForPeriod(d.history, todaySpec(), d.settings, world.now));
  const y = addDays(businessDayKey(world.now, d.settings), -1);
  const ys = summarize(txnsForPeriod(d.history, { period: "custom", from: y, to: y }, d.settings, world.now));
  return { today: t.total, orders: t.orders, yesterday: ys.total };
}

/** "I'm tired", "I'm hungry" are not names. */
const NOT_A_NAME = /^(?:tired|hungry|busy|bored|sleepy|sorry|here|back|done|ok|okay|fine|good|great|sad|happy|pagod|gutom|so|not|a|the|ready|going|leaving|closing|off)\b/;

function todaySpec(): PeriodSpec {
  return { period: "today" };
}

function openTables(data: AppData) {
  return data.tableList
    .map((t) => ({ t, splits: data.tables[t.id] ?? [] }))
    .filter((x) => x.splits.some((s) => s.items.length));
}

/** One-line status of the night, used by greetings and Talk mode. */
export function statusLine(world: World, tl = false): string {
  const data = world.data;
  const s = summarize(txnsForPeriod(data.history, todaySpec(), data.settings, world.now));
  const open = openTables(data);
  const unpaid = open.reduce((sum, x) => sum + tableTotal(x.splits), 0);
  if (tl) {
    const a = s.orders ? `${peso(s.total)} na ang benta mula sa ${s.orders} order` : "Wala pang benta ngayon";
    const b = open.length ? `, ${open.length} table ang bukas (${peso(unpaid)} hindi pa bayad)` : ", walang bukas na table";
    return `${a}${b}.`;
  }
  const a = s.orders ? `So far today: ${peso(s.total)} from ${plural(s.orders, "order")}` : "No sales yet today";
  const b = open.length ? `, ${plural(open.length, "table")} open (${peso(unpaid)} unpaid)` : ", no open tables";
  return `${a}${b}.`;
}

export interface Tip {
  kind: "wait" | "long" | "soldout" | "fast" | "pace" | "utang" | "backup";
  text: string;
  tableId?: number;
  /** Lower comes first. */
  rank: number;
}

/** Things worth knowing right now — shown in Ask and spoken in Talk mode. */
export function insights(world: World): Tip[] {
  const data = world.data;
  const now = world.now;
  const tips: Tip[] = [];
  for (const { t, splits } of openTables(data)) {
    const opened = tableOpenedAt(splits);
    if (!opened) continue;
    const mins = minutesSince(opened, now);
    const toServe = tableUnserved(splits);
    const name = tableName(data, t.id);
    if (toServe > 0 && mins >= 15) tips.push({ kind: "wait", rank: 100 - mins, tableId: t.id, text: `${name} has been waiting ${fmtElapsed(opened, now)} with ${plural(toServe, "item")} not served.` });
    else if (toServe === 0 && mins >= 45) tips.push({ kind: "long", rank: 200 - mins, tableId: t.id, text: `${name} has been open ${fmtElapsed(opened, now)} and everything is served — ready to bill out?` });
  }
  const sold = data.menu.flatMap((c) => c.items).filter((i) => isSoldOut(i, data.settings, now));
  if (sold.length) tips.push({ kind: "soldout", rank: 400, text: `Sold out today: ${sold.map((i) => i.name).join(", ")}.` });

  const today = summarize(txnsForPeriod(data.history, todaySpec(), data.settings, now));
  const top = today.best[0];
  if (top && top.qty >= 5) tips.push({ kind: "fast", rank: 500, text: `${top.name} is your best seller tonight — ${top.qty} sold so far.` });

  // Pace vs yesterday at the same time.
  const yKey = addDays(businessDayKey(now, data.settings), -1);
  const cutoff = now.getTime() - DAY_MS;
  const ySoFar = data.history.filter((h) => businessDayKey(new Date(h.ts), data.settings) === yKey && Date.parse(h.ts) <= cutoff).reduce((s, h) => s + h.total, 0);
  if (ySoFar > 0 && today.orders > 0) {
    const diff = today.total - ySoFar;
    tips.push({ kind: "pace", rank: 600, text: diff >= 0 ? `You’re ${peso(diff)} ahead of yesterday at this time.` : `You’re ${peso(-diff)} behind yesterday at this time.` });
  }
  for (const a of utangAccounts(data.history)) {
    if (a.balance > 0 && a.since && now.getTime() - Date.parse(a.since) >= 7 * DAY_MS) {
      tips.push({ kind: "utang", rank: 700, text: `${a.name} still owes ${peso(a.balance)} (oldest from ${Math.floor((now.getTime() - Date.parse(a.since)) / DAY_MS)} days ago).` });
    }
  }
  if (backupDue(data.settings, data.history, now)) tips.push({ kind: "backup", rank: 800, text: data.settings.lastBackupAt ? "Your last backup is over a week old — say “back up now”." : "You haven’t saved a backup yet — say “back up now”." });
  return tips.sort((a, b) => a.rank - b.rank);
}

function tipsReply(world: World, tl: boolean): AgentReply {
  const tips = insights(world);
  const head = statusLine(world, tl);
  if (!tips.length) return { text: `${head} ${tl ? "Wala akong ibang dapat ipaalam — maayos ang lahat!" : "Nothing needs your attention right now."}` };
  return {
    text: `${head} ${tl ? "Ilang paalala:" : "A few things:"}`,
    speak: `${head} ${tips.slice(0, 2).map((t) => t.text).join(" ")}`,
    card: { kind: "list", title: tl ? "Mga paalala" : "Heads up", rows: tips.slice(0, 6).map((t) => ({ label: t.text })) },
  };
}

// ---------- multi-command ----------

const CONNECTORS = new Set(["and", ",", "then", "tapos", "also", "plus", "at", "after", "that", "next", "pati", "tsaka"]);
const PREPS = new Set(["for", "sa", "para", "to", "on", "at", "in"]);

interface TableHit {
  start: number;
  end: number;
  id: number;
}

function findTableRefs(toks: string[], data: AppData): TableHit[] {
  const hits: TableHit[] = [];
  const byName = (cand: string[]) => data.tableList.find((tb) => {
    const n = tableNameTokens(tb);
    return n.length === cand.length && n.every((x, k) => x === cand[k]);
  });
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i]!;
    const m = /^t(\d+)$/.exec(w);
    if (m) {
      const tb = byName([m[1]!]);
      if (tb) hits.push({ start: i, end: i + 1, id: tb.id });
      continue;
    }
    if (w === "table" || w === "tbl" || w === "mesa" || w === "tables") {
      let j = i + 1;
      if (toks[j] === "number" || toks[j] === "no") j++;
      for (let len = 3; len >= 1; len--) {
        const cand = toks.slice(j, j + len);
        if (cand.length < len) continue;
        const tb = byName(cand);
        if (tb) {
          hits.push({ start: i, end: j + len, id: tb.id });
          i = j + len - 1;
          break;
        }
      }
      continue;
    }
    for (const tb of data.tableList) {
      if (!tb.custom) continue;
      const n = tableNameTokens(tb);
      if (n.length && n.every((x, k) => toks[i + k] === x)) {
        hits.push({ start: i, end: i + n.length, id: tb.id });
        i += n.length - 1;
        break;
      }
    }
  }
  return hits;
}

function trimConnectors(seg: string[]): string[] {
  let a = 0;
  let b = seg.length;
  while (a < b && CONNECTORS.has(seg[a]!)) a++;
  while (b > a && CONNECTORS.has(seg[b - 1]!)) b--;
  return seg.slice(a, b);
}

function segmentFailed(r: RespondResult): boolean {
  if (r.ctx.pending && r.ctx.pending.kind !== "confirm") return true;
  if (!r.reply.execute && !r.reply.confirm && (r.reply.tone === "warn" || r.reply.tone === "error")) return true;
  return false;
}

/** "2 pares for table 1 and 3 mami for table 2", "table 3 paid, table 4 paid", "add … then …". */
function multiCommand(toks: string[], world: World, ctx: AgentContext): RespondResult | null {
  const refs = findTableRefs(toks, world.data);
  let segs: string[][] = [];
  if (refs.length >= 2 && new Set(refs.map((r) => r.id)).size >= 2) {
    const leading = toks.slice(0, refs[0]!.start).every((t) => CONNECTORS.has(t) || PREPS.has(t));
    if (leading) {
      refs.forEach((r, k) => segs.push(toks.slice(r.start, refs[k + 1]?.start ?? toks.length)));
    } else {
      let prev = 0;
      refs.forEach((r, k) => {
        const end = k === refs.length - 1 ? toks.length : r.end;
        segs.push(toks.slice(prev, end));
        prev = end;
      });
    }
  } else {
    let prev = 0;
    for (let i = 0; i < toks.length; i++) {
      const isThen = (toks[i] === "then" || toks[i] === "tapos") && i > 0;
      const afterThat = toks[i] === "after" && toks[i + 1] === "that";
      if (isThen || afterThat) {
        segs.push(toks.slice(prev, i));
        prev = afterThat ? i + 2 : i + 1;
      }
    }
    if (!segs.length) return null;
    segs.push(toks.slice(prev));
  }
  segs = segs.map(trimConnectors).filter((s) => s.length);
  if (segs.length < 2) return null;

  let c = ctx;
  const results: RespondResult[] = [];
  for (const seg of segs) {
    const r = respond(seg.join(" "), world, c, { split: false });
    if (segmentFailed(r)) return null;
    results.push(r);
    c = { ...r.ctx, pending: null };
  }
  const plans = results.flatMap((r) => (r.reply.execute ? [r.reply.execute] : r.reply.confirm ? [r.reply.confirm.plan] : []));
  if (!plans.length) {
    return { reply: { text: results.map((r) => r.reply.text).join(" "), card: [...results].reverse().find((r) => r.reply.card)?.reply.card }, ctx: c };
  }
  const needConfirm = results.some((r) => r.reply.confirm);
  const batch: Plan = { kind: "batch", plans };
  const rows = results.map((r, i) => ({ label: `${i + 1}. ${r.reply.confirm ? r.reply.confirm.doneText : r.reply.text}` }));
  if (needConfirm) {
    return confirmReply(c, batch, `Do these ${results.length} things?`, "Do all", results.map((r) => (r.reply.confirm ? r.reply.confirm.doneText : r.reply.text)).join(" "), true, { kind: "list", title: "Plan", rows });
  }
  return { reply: { text: results.map((r) => r.reply.text).join(" "), execute: batch, undoable: true, card: { kind: "list", title: "Done", rows } }, ctx: c };
}

// ---------- corrections ----------

const CORR_START = /^(no|nope|hindi|mali|wrong|oops|sorry|actually|i mean|i meant|i said|correction|teka|ay|not that)\b/;
const CORR_ANY = /\b(pala|instead|i mean|i meant)\b/;
const CORR_WORDS = new Set(["no", "nope", "hindi", "mali", "wrong", "oops", "sorry", "actually", "i", "mean", "meant", "said", "correction", "teka", "ay", "pala", "instead", "not", "that", "it", "is", "should", "be", "sa", "for", "to", "dapat", ",", "po", "yung", "ang", "make", "na", "on", "was", "the"]);

function correctionReply(toks: string[], norm: string, world: World, ctx: AgentContext, index: MenuIndex): RespondResult | null {
  const last = ctx.lastAdd;
  if (!last || world.now.getTime() - last.at > CONTEXT_TTL_MS) return null;
  if (!CORR_START.test(norm) && !CORR_ANY.test(norm)) return null;
  // "no more water", "remove …": that's a removal, not a correction.
  if (has(toks, "more", "remove", "delete", "minus", "less", "drop", "cancel", "take", "without", "paid", "pay")) return null;
  const data = world.data;
  const ref = extractTable(toks, data);
  const words = ref.rest.filter((t) => !CORR_WORDS.has(t));
  const parsed = parseItems(words, index);
  const newTable = ref.tableId !== null && ref.tableId !== last.tableId ? ref.tableId : null;
  if (newTable === null && !parsed.lines.length) return null;
  if (!data.tableList.some((t) => t.id === last.tableId)) return null;

  const from = tableName(data, last.tableId);
  if (newTable !== null && !parsed.lines.length) {
    const split = splitFor(world, newTable);
    const plan: Plan = {
      kind: "batch",
      plans: [
        { kind: "removeItems", tableId: last.tableId, split: last.split, items: last.lines.map((l) => ({ name: l.name, qty: l.qty })) },
        { kind: "addItems", tableId: newTable, split, items: last.lines },
      ],
    };
    return {
      reply: { text: `Got it — moved ${linesText(last.lines)} from ${from} to ${tableName(data, newTable)}.`, execute: plan, undoable: true, card: billCard(world, newTable, split, last.lines) },
      ctx: { ...rememberTable(ctx, newTable, world), lastAdd: { ...last, tableId: newTable, split, at: world.now.getTime() } },
    };
  }

  const target = newTable ?? last.tableId;
  const targetSplit = newTable !== null ? splitFor(world, newTable) : last.split;
  const newLines = parsed.lines.map(toLine);
  let replace = last.lines;
  if (last.lines.length > 1) {
    const cat = parsed.lines[0]!.item.catId;
    const same = last.lines.find((l) => index.entries.find((e) => e.name === l.name)?.catId === cat);
    replace = [same ?? last.lines[last.lines.length - 1]!];
  }
  const explicitQty = words.some((t) => isNumberToken(t));
  if (!explicitQty && newLines.length === 1 && replace.length === 1) newLines[0] = { ...newLines[0]!, qty: replace[0]!.qty };
  const plan: Plan = {
    kind: "batch",
    plans: [
      { kind: "removeItems", tableId: last.tableId, split: last.split, items: replace.map((l) => ({ name: l.name, qty: l.qty })) },
      { kind: "addItems", tableId: target, split: targetSplit, items: newLines },
    ],
  };
  const kept = last.lines.filter((l) => !replace.includes(l));
  const card = target === last.tableId ? billCard(world, target, targetSplit, newLines, replace.map((l) => ({ name: l.name, qty: l.qty }))) : billCard(world, target, targetSplit, newLines);
  return {
    reply: { text: `Got it — changed ${linesText(replace)} to ${linesText(newLines)}${newTable !== null ? ` on ${tableName(data, target)}` : ""}.`, execute: plan, undoable: true, card },
    ctx: { ...rememberTable(ctx, target, world), lastLines: newLines, lastAdd: { tableId: target, split: targetSplit, lines: target === last.tableId ? [...kept, ...newLines] : newLines, at: world.now.getTime() } },
  };
}

/** "change pares to mami on table 2", "palitan ng mami ang pares" */
function swapReply(toks: string[], world: World, ctx: AgentContext, index: MenuIndex, explicitTable: number | null, rest: string[]): RespondResult | null {
  if (!has(toks, "change", "palitan", "replace", "swap", "switch")) return null;
  if (rest.some(isNumberToken)) return null;
  const at = rest.findIndex((t, i) => i > 0 && ["to", "with", "into", "ng", "for"].includes(t));
  if (at < 0) return null;
  const strip = (xs: string[]) => xs.filter((t) => !["change", "palitan", "replace", "swap", "switch", "the", "ang", "yung", "sa", "on", "it"].includes(t));
  const left = findMenuItem(strip(rest.slice(0, at)), index);
  const right = findMenuItem(strip(rest.slice(at + 1)), index);
  if (!left || !right || left.entry.name === right.entry.name) return null;
  const tableId = explicitTable ?? contextTable(world, ctx);
  if (tableId === null) return null;
  const split = splitFor(world, tableId);
  // "palitan ng mami ang pares" puts the new item first.
  const items = world.data.tables[tableId]?.[split]?.items ?? [];
  let oldName = left.entry.name;
  let newEntry = right.entry;
  if (!items.some((i) => i.name === oldName) && items.some((i) => i.name === right.entry.name)) {
    oldName = right.entry.name;
    newEntry = left.entry;
  }
  const line = items.find((i) => i.name === oldName);
  if (!line) return { reply: { text: `${tableName(world.data, tableId)} doesn’t have ${oldName} on its bill.`, tone: "warn" }, ctx };
  const newLine: Line = { name: newEntry.name, price: newEntry.price, qty: line.qty, ...(line.note ? { note: line.note } : {}) };
  const plan: Plan = { kind: "batch", plans: [{ kind: "setQty", tableId, split, name: line.name, qty: 0 }, { kind: "addItems", tableId, split, items: [newLine] }] };
  return {
    reply: { text: `Changed ${line.qty}× ${line.name} to ${newEntry.name} on ${tableName(world.data, tableId)}.`, execute: plan, undoable: true, card: billCard(world, tableId, split, [newLine], [{ name: line.name, qty: "all" }]) },
    ctx: { ...rememberTable(ctx, tableId, world), lastLines: [newLine] },
  };
}

// ---------- names (utang) ----------

const NAME_STOP = new Set(["table", "utang", "paid", "pay", "payment", "na", "po", "sa", "ng", "gcash", "maya", "cash", "today", "the", "lahat", "all", "full", "pesos", "peso", "for", "and", "ang", "yung", "nya", "niya", "ko", "mo", "credit", "owes", "owe", "list", "is", "has", "how", "much", "magkano", "lang", "pa", "ba"]);

function titleName(words: string[]): string {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** A known utang customer mentioned anywhere, else a name after ni/kay/si/for/to. */
function customerFrom(raw: string, world: World): { name: string; known: boolean } | null {
  const lower = ` ${raw.toLowerCase().replace(/[^a-zñ0-9\s'.-]/g, " ")} `;
  const known = utangAccounts(world.data.history).sort((a, b) => b.name.length - a.name.length);
  for (const a of known) if (lower.includes(` ${a.key} `)) return { name: a.name, known: true };
  const m = /\b(?:ni|kay|si|for|to|under|named|name is|pangalan|customer)\s+([a-zñ][a-zñ.'-]*(?:\s+[a-zñ][a-zñ.'-]*){0,2})/i.exec(raw);
  if (!m) return null;
  const words: string[] = [];
  for (const w of m[1]!.toLowerCase().split(/\s+/)) {
    if (NAME_STOP.has(w) || /^\d/.test(w)) break;
    words.push(w);
  }
  if (!words.length) return null;
  return { name: titleName(words), known: false };
}

function askName(ctx: AgentContext, question: string, resume: (name: string, w: World, c: AgentContext) => AgentReply | Resumed): RespondResult {
  return { reply: { text: question }, ctx: { ...ctx, pending: { kind: "needName", resume } } };
}

/** Parses a reply to "whose utang?" into a name. */
const NAME_ANSWER_STOP = new Set(["table", "split", "paid", "pay", "add", "remove", "cancel", "clear", "undo", "move", "open", "order", "bill", "menu", "gcash", "maya", "cash", "help", "served", "note", "expense", "sold", "soldout"]);

export function nameFromAnswer(raw: string): string | null {
  const words = raw.trim().replace(/[^A-Za-zÑñ\s'.-]/g, " ").split(/\s+/).filter(Boolean);
  // A command instead of a name ("split table 2", "table 4 paid") isn't an answer.
  if (/\d/.test(raw) || words.some((w) => NAME_ANSWER_STOP.has(w.toLowerCase()))) return null;
  const cleaned = words.filter((w) => !["si", "ni", "kay", "it", "is", "its", "name", "the", "for", "to", "po", "utang", "ni", "yung"].includes(w.toLowerCase()));
  if (!cleaned.length || cleaned.length > 4) return null;
  return titleName(cleaned.map((w) => w.toLowerCase()));
}

// ---------- utang ----------

function utangReply(raw: string, toks: string[], norm: string, world: World, ctx: AgentContext, explicitTable: number | null, rest: string[]): RespondResult | null {
  const data = world.data;
  const cust = customerFrom(raw, world);
  const utangWord = has(toks, "utang", "credit", "owe", "owes", "owed", "debt", "tab");
  const payWord = has(toks, "paid", "pay", "pays", "payment", "settle", "settled");
  const question = has(toks, "who", "sino", "how", "much", "many", "what", "list", "show", "check", "whats") || raw.trim().endsWith("?");

  // Payment toward utang: "Ben paid 100", "nagbayad si Ben ng 200 gcash", "bayad ni Ben lahat"
  if (payWord && explicitTable === null && cust?.known && (utangWord || !question)) {
    const account = findAccount(data.history, cust.name)!;
    if (account.balance <= 0) return { reply: { text: `${account.name} doesn’t owe anything right now.` }, ctx };
    const nums = rest.filter(isNumberToken).map(Number);
    const all = has(toks, "all", "lahat", "full", "everything", "buo", "fully");
    const amount = all || !nums.length ? account.balance : Math.min(Math.max(...nums), account.balance);
    const method = has(toks, "gcash") ? "gcash" : has(toks, "maya") ? "maya" : "cash";
    const left = account.balance - amount;
    // Recorded right away (no "are you sure?"); "undo" takes it back.
    return {
      reply: {
        text: `${account.name} paid ${peso(amount)}${method !== "cash" ? ` via ${method === "gcash" ? "GCash" : "Maya"}` : ""}. ${left > 0 ? `${peso(left)} still owed.` : "All paid off!"}`,
        execute: { kind: "payUtang", customer: account.name, amount, method },
        undoable: true,
      },
      ctx,
    };
  }
  if (!utangWord) return null;

  // Charge a table's bill to someone's utang: "table 2 utang ni Ben", "ilista mo kay Ben table 3"
  const tableId = explicitTable ?? (question ? null : contextTable(world, ctx));
  if (tableId !== null && !question) {
    const sp = extractSplit(rest);
    // "utang table 2 Juan": a name left over once the table and utang words are gone.
    const leftover = sp.rest.filter((w) => !NAME_STOP.has(w) && !/^\d/.test(w) && !["put", "on", "add", "charge", "ilista", "mo", "si", "ni", "kay", "under", "bill", "si"].includes(w));
    const nameGuess = !cust && leftover.length >= 1 && leftover.length <= 3 && !parseItems(leftover, menuIndex(data)).lines.length ? titleName(leftover) : null;
    if (!cust && nameGuess) return payReply(world, tableId, sp.split, undefined, rememberTable(ctx, tableId, world), "utang", nameGuess);
    if (!cust) {
      return askName(ctx, `Whose utang is ${tableName(data, tableId)}’s bill? Tell me the customer’s name.`, (name, w, c) => payReply(w, tableId, sp.split, undefined, c, "utang", name));
    }
    return payReply(world, tableId, sp.split, undefined, rememberTable(ctx, tableId, world), "utang", cust.name);
  }

  // Questions: "sino may utang?", "how much does Ben owe?"
  if (cust?.known) {
    const a = findAccount(data.history, cust.name)!;
    if (a.balance <= 0) return { reply: { text: `${a.name} has no unpaid utang.` }, ctx };
    return {
      reply: {
        text: `${a.name} owes ${peso(a.balance)} from ${plural(a.open.length, "order")}${a.since ? `, the oldest on ${fmtDayLabel(new Date(a.since))}` : ""}.`,
        card: { kind: "list", title: `${a.name}’s utang`, rows: a.open.map((t) => ({ label: `${fmtDayLabel(new Date(t.ts))} · ${tableName(data, t.table)}`, value: peso(utangBalance(t)), sub: linesText(t.items) })) },
        suggestions: [`${a.name} paid ${a.balance}`],
        link: { label: "Open utang list", route: { name: "utang" } },
      },
      ctx,
    };
  }
  const owing = utangAccounts(data.history).filter((a) => a.balance > 0);
  if (!owing.length) return { reply: { text: "Nobody owes you right now.", link: { label: "Open utang list", route: { name: "utang" } } }, ctx };
  const total = owing.reduce((s, a) => s + a.balance, 0);
  void norm;
  return {
    reply: {
      text: `${plural(owing.length, "person", "people")} ${owing.length === 1 ? "owes" : "owe"} you ${peso(total)} in total.`,
      card: { kind: "list", title: "Utang", rows: owing.map((a) => ({ label: a.name, value: peso(a.balance), sub: a.since ? `since ${fmtDayLabel(new Date(a.since))}` : undefined })) },
      link: { label: "Open utang list", route: { name: "utang" } },
    },
    ctx,
  };
}

// ---------- sold out ----------

const SOLD_FILLER = new Set(["soldout", "na", "ang", "yung", "is", "are", "we", "out", "of", "wala", "nang", "ng", "available", "again", "back", "in", "stock", "restock", "restocked", "meron", "may", "mayroon", "ulit", "the", "on", "now", "po", "mark", "set", "as", "it", "item", "menu", "have", "today", "tonight", "pa", "ba", "still", "do", "any", "left", "what", "which", "whats", "list", "show", "items"]);

function soldOutReply(raw: string, toks: string[], world: World, ctx: AgentContext, index: MenuIndex): RespondResult | null {
  const data = world.data;
  const lower = raw.toLowerCase();
  const outWord = has(toks, "soldout") || /\b(wala na(ng)?|out of)\b/.test(lower);
  const backWord = /\b(available|in stock|back in stock|restock(ed)?|meron na ulit|meron ulit|may .+ na ulit|mayroon na ulit|back on the menu)\b/.test(lower);
  const question = /\?\s*$/.test(raw) || /^(is|are|do we have|meron pa ba|may .+ pa ba|mayroon pa ba|what|which|anong|ano)\b/.test(lower.trim());
  if (!outWord && !backWord) return null;
  if (has(toks, "table") || has(toks, "tables")) return null;
  const itemToks = toks.filter((t) => !SOLD_FILLER.has(t));
  const m = itemToks.length ? findMenuItem(itemToks, index) : null;
  const soldNow = data.menu.flatMap((c) => c.items).filter((i) => isSoldOut(i, data.settings, world.now));
  if (!m) {
    if (question || !itemToks.length) {
      return { reply: { text: soldNow.length ? `Sold out today: ${soldNow.map((i) => i.name).join(", ")}.` : "Nothing is marked sold out today." }, ctx };
    }
    return outWord && has(toks, "soldout") ? { reply: { text: "Which menu item is sold out?" }, ctx } : null;
  }
  const item = data.menu.find((c) => c.id === m.entry.catId)?.items.find((i) => i.id === m.entry.id);
  if (!item) return null;
  const isOut = isSoldOut(item, data.settings, world.now);
  if (question) return { reply: { text: isOut ? `${item.name} is marked sold out today.` : `${item.name} is available.` }, ctx };
  const soldOut = outWord && !backWord;
  if (soldOut === isOut) return { reply: { text: soldOut ? `${item.name} is already marked sold out.` : `${item.name} is already available.` }, ctx };
  const tl = isTaglish(raw);
  return {
    reply: {
      text: soldOut
        ? tl ? `Sige, ubos na ang ${item.name} ngayon. Sasabihan kita kapag may umorder.` : `Marked ${item.name} as sold out for today. I’ll warn you if someone orders it.`
        : tl ? `Okay, available na ulit ang ${item.name}.` : `${item.name} is available again.`,
      execute: { kind: "setSoldOut", catId: m.entry.catId, itemId: m.entry.id, soldOut },
      undoable: true,
    },
    ctx,
  };
}

// ---------- notes ----------

const NOTE_TRIGGERS = new Set(["walang", "no", "without", "less", "konti", "konting", "kaunti", "kaunting", "extra", "hindi", "not", "separate", "hiwalay", "maanghang", "spicy", "mild", "well", "light", "heavy", "malamig", "mainit", "cold", "hot"]);
const NOTE_STOP = new Set(["and", ",", "for", "sa", "to", "para", "on", "table", "tables", "at", "tapos", "then", "plus", "also"]);

interface NoteHit {
  at: number;
  text: string;
  len: number;
}

/** Finds kitchen notes like "walang sibuyas", "extra sabaw", "no onions" (words that aren't menu items). */
export function extractNotes(toks: string[], index: MenuIndex): { notes: NoteHit[]; rest: string[] } {
  const notes: NoteHit[] = [];
  const rest: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const next = toks[i + 1];
    const standalone = t === "maanghang" || t === "spicy" || t === "mild";
    if (NOTE_TRIGGERS.has(t) && (standalone || (next && !isNumberToken(next) && !index.vocab.has(next) && !NOTE_STOP.has(next) && next !== "more" && next !== "na"))) {
      const words = [t];
      let j = i + 1;
      while (j < toks.length && !isNumberToken(toks[j]) && !index.vocab.has(toks[j]!) && !NOTE_STOP.has(toks[j]!) && words.length < 4) words.push(toks[j++]!);
      if (standalone || words.length >= 2) {
        notes.push({ at: rest.length, text: words.join(" "), len: words.length });
        i = j - 1;
        continue;
      }
    }
    rest.push(t);
  }
  return { notes, rest };
}

function noteText(n: string): string {
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function setNoteReply(toks: string[], world: World, ctx: AgentContext, index: MenuIndex, explicitTable: number | null, rest: string[]): RespondResult | null {
  const noteWord = has(toks, "note", "notes", "bilin", "paalala", "request");
  const { notes, rest: itemToks } = extractNotes(rest.filter((t) => !["note", "notes", "bilin", "paalala", "request", "add", "put", "set", "for", "on", "sa", "ang", "yung", "the"].includes(t)), index);
  if (!noteWord && !notes.length) return null;
  const tableId = explicitTable ?? contextTable(world, ctx);
  if (tableId === null) return noteWord ? askTable(ctx, world, "Which table is that note for?", () => ({ text: "Okay — now tell me the note again with the item, like “note pares walang sibuyas”." })) : null;
  const split = splitFor(world, tableId);
  const items = world.data.tables[tableId]?.[split]?.items ?? [];
  const parsed = parseItems(itemToks, index);
  const explicitQty = itemToks.some(isNumberToken);
  // Item not on the bill (or a quantity given): this is an order with a note, not a note on an existing line.
  if (!noteWord && (explicitQty || has(toks, "add", "order") || !parsed.lines.length || !parsed.lines.every((l) => items.some((i) => i.name === l.item.name)))) return null;
  let text = notes.map((n) => n.text).join(", ");
  if (!text) text = itemToks.filter((t) => !parsed.lines.some((l) => l.heard.split(" ").includes(t))).join(" ");
  if (!text) return { reply: { text: "What should the note say? For example “note pares walang sibuyas”." }, ctx };
  const target = parsed.lines[0]?.item.name ?? (items.length === 1 ? items[0]!.name : null);
  if (!target || !items.some((i) => i.name === target)) {
    return { reply: { text: items.length ? `Which item is “${text}” for? ${tableName(world.data, tableId)} has ${items.map((i) => i.name).join(", ")}.` : `${tableName(world.data, tableId)} has no items yet.`, tone: "warn" }, ctx };
  }
  return {
    reply: { text: `Noted: ${target} on ${tableName(world.data, tableId)} — “${noteText(text)}”.`, execute: { kind: "setNote", tableId, split, name: target, note: noteText(text) }, undoable: true },
    ctx: rememberTable(ctx, tableId, world),
  };
}

// ---------- serving ----------

function serveReply(raw: string, toks: string[], world: World, ctx: AgentContext, index: MenuIndex, explicitTable: number | null, rest: string[]): RespondResult | null {
  const data = world.data;
  const lower = raw.toLowerCase();
  const waitQ = has(toks, "waiting", "naghihintay", "longest", "matagal", "nag-aantay", "naghihintay") || (has(toks, "served", "serve") && has(toks, "not", "hindi", "yet", "pa", "which", "who", "sino", "what"));
  if (waitQ && !(explicitTable !== null && !has(toks, "not", "hindi", "yet", "pa"))) {
    const rows = openTables(data)
      .map(({ t, splits }) => ({ t, opened: tableOpenedAt(splits), toServe: tableUnserved(splits) }))
      .filter((x) => x.toServe > 0 || has(toks, "longest", "matagal", "waiting"))
      .sort((a, b) => (a.opened ?? "z").localeCompare(b.opened ?? "z"));
    if (!rows.length) return { reply: { text: "Everyone has been served. 👍" }, ctx };
    return {
      reply: {
        text: `${plural(rows.filter((r) => r.toServe).length, "table")} still waiting for food.${rows[0]!.opened ? ` ${tableName(data, rows[0]!.t.id)} has waited longest (${fmtElapsed(rows[0]!.opened, world.now)}).` : ""}`,
        card: { kind: "list", title: "Waiting", rows: rows.map((r) => ({ label: tableName(data, r.t.id), value: r.opened ? fmtElapsed(r.opened, world.now) : "", sub: r.toServe ? `${plural(r.toServe, "item")} to serve` : "All served" })) },
      },
      ctx,
    };
  }
  if (!has(toks, "served", "serve")) return null;
  if (has(toks, "what", "whats", "which") || /what do (we|you) serve/.test(lower)) return null;
  const tableId = explicitTable ?? contextTable(world, ctx);
  if (tableId === null) return askTable(ctx, world, "Which table was served?", (tid, w) => serveAll(w, tid, []));
  const parsed = parseItems(rest.filter((t) => !["served", "serve", "na", "already", "is", "are", "all", "lahat", "the", "ang", "yung", "been", "has", "have", "mark", "as"].includes(t)), index);
  return { reply: serveAll(world, tableId, parsed.lines.map((l) => l.item.name)), ctx: rememberTable(ctx, tableId, world) };
}

function serveAll(world: World, tableId: number, names: string[]): AgentReply {
  const splits = world.data.tables[tableId] ?? [];
  const name = tableName(world.data, tableId);
  if (!tableUnserved(splits)) return { text: splits.some((s) => s.items.length) ? `Everything on ${name} is already served.` : `${name} has no order.` };
  const known = names.filter((n) => splits.some((s) => s.items.some((i) => i.name === n)));
  return {
    text: known.length ? `Marked ${known.join(", ")} on ${name} as served.` : `Marked everything on ${name} as served.`,
    execute: { kind: "serve", tableId, ...(known.length ? { names: known } : {}) },
    undoable: true,
  };
}

// ---------- expenses & profit ----------

const EXPENSE_FILLER = new Set(["expense", "expenses", "spent", "spend", "bought", "buy", "purchase", "purchased", "for", "sa", "ng", "on", "of", "pesos", "peso", "add", "record", "new", "a", "an", "the", "worth", "ko", "kami", "we", "i", "today", "po", "na", "ang", "an", "paid", "pay", "pambili", "pang"]);

function expenseReply(raw: string, toks: string[], norm: string, world: World, ctx: AgentContext): RespondResult | null {
  if (!has(toks, "expense", "expenses", "spent", "spend", "bought", "purchase", "purchased", "spending")) return null;
  const data = world.data;
  const question = has(toks, "how", "much", "what", "whats", "list", "show", "total", "magkano") || raw.trim().endsWith("?");
  const nums = toks.filter(isNumberToken).map(Number).filter((n) => n > 0);
  if (nums.length && !question) {
    const amount = nums[0]!;
    const what = titleName(toks.filter((t) => !EXPENSE_FILLER.has(t) && !isNumberToken(t)).slice(0, 5)) || "Expense";
    const todayTotal = expensesForPeriod(data.expenses, todaySpec(), data.settings, world.now).reduce((s, e) => s + e.amount, 0) + amount;
    return {
      reply: { text: `Saved expense: ${peso(amount)} for ${what}. Expenses today: ${peso(todayTotal)}.`, execute: { kind: "addExpense", amount, what }, undoable: true },
      ctx,
    };
  }
  const spec = extractPeriod(toks, norm, world) ?? todaySpec();
  const list = expensesForPeriod(data.expenses, spec, data.settings, world.now);
  const when = periodPhrase(spec, world);
  if (!list.length) return { reply: { text: `No expenses recorded ${when}. Say “expense 300 for ice” to add one.` }, ctx };
  const total = list.reduce((s, e) => s + e.amount, 0);
  return {
    reply: {
      text: `Expenses ${when}: ${peso(total)} (${plural(list.length, "item")}).`,
      card: { kind: "list", title: `Expenses · ${when}`, rows: list.slice(-12).reverse().map((e) => ({ label: e.what, value: peso(e.amount), sub: `${fmtDayLabel(new Date(e.ts))} ${fmtTime(e.ts)}` })) },
    },
    ctx,
  };
}

function moneyReply(toks: string[], norm: string, world: World, ctx: AgentContext, explicitTable: number | null): RespondResult | null {
  const profitQ = has(toks, "profit", "net", "profits");
  const methodQ = has(toks, "gcash", "maya") && !has(toks, "paid", "pay") && explicitTable === null;
  const cashQ = has(toks, "cash") && has(toks, "how", "much", "total") && explicitTable === null && !has(toks, "change");
  if (!profitQ && !methodQ && !cashQ) return null;
  const data = world.data;
  const spec = extractPeriod(toks, norm, world) ?? todaySpec();
  const m = moneyBreakdown(data.history, data.expenses, spec, data.settings, world.now);
  const when = periodPhrase(spec, world);
  const collected = m.collected.cash + m.collected.gcash + m.collected.maya;
  const text = profitQ
    ? `Profit ${when}: ${m.profit < 0 ? "−" : ""}${peso(Math.abs(m.profit))} — sales ${peso(m.salesTotal)} minus expenses ${peso(m.expenses)}.`
    : `${when.charAt(0).toUpperCase() + when.slice(1)}: Cash ${peso(m.sales.cash)}, GCash ${peso(m.sales.gcash)}, Maya ${peso(m.sales.maya)}${m.sales.utang ? `, Utang ${peso(m.sales.utang)}` : ""}.`;
  return {
    reply: {
      text,
      card: {
        kind: "stats",
        title: `Money · ${when}`,
        stats: [
          { label: "Sales", value: peso(m.salesTotal) },
          { label: "Expenses", value: peso(m.expenses) },
          { label: "Profit", value: `${m.profit < 0 ? "−" : ""}${peso(Math.abs(m.profit))}` },
        ],
        rows: [
          { label: "Cash", value: peso(m.sales.cash) },
          { label: "GCash", value: peso(m.sales.gcash) },
          { label: "Maya", value: peso(m.sales.maya) },
          ...(m.sales.utang ? [{ label: "Sold on utang", value: peso(m.sales.utang) }] : []),
          ...(collected ? [{ label: "Utang collected", value: peso(collected) }] : []),
          { label: "Money received", value: peso(m.received) },
        ],
      },
    },
    ctx,
  };
}
