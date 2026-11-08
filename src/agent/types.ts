import type { AppData, MoneyMethod, ThemePref } from "../data/types";
import type { PeriodSpec } from "../lib/businessDay";
import type { Route } from "../store/appStore";

export interface Line {
  name: string;
  price: number;
  qty: number;
  note?: string;
}

/** A concrete change the agent wants to make. Executed by executor.ts. */
export type Plan =
  | { kind: "addItems"; tableId: number; split: number; items: Line[] }
  | { kind: "removeItems"; tableId: number; split: number; items: { name: string; qty: number | "all" }[] }
  | { kind: "setQty"; tableId: number; split: number; name: string; qty: number }
  | { kind: "pay"; tableId: number; splits: number[]; cash?: number; method?: MoneyMethod | "utang"; customer?: string }
  | { kind: "payUtang"; customer: string; amount: number; method: MoneyMethod }
  | { kind: "setSoldOut"; catId: number; itemId: number; soldOut: boolean }
  | { kind: "setNote"; tableId: number; split: number; name: string; note: string }
  | { kind: "serve"; tableId: number; split?: number; names?: string[] }
  | { kind: "addExpense"; amount: number; what: string }
  /** Several plans applied together as one undoable step. */
  | { kind: "batch"; plans: Plan[] }
  | { kind: "clear"; tableId: number; split: number }
  | { kind: "addSplit"; tableId: number }
  | { kind: "addTable"; name: string }
  | { kind: "removeTable"; tableId: number }
  | { kind: "navigate"; route: Route }
  | { kind: "setTheme"; theme: ThemePref }
  | { kind: "setPrice"; catId: number; itemId: number; price: number }
  | { kind: "addMenuItem"; catId: number | null; newCategory?: string; name: string; price: number }
  | { kind: "removeMenuItem"; catId: number; itemId: number }
  | { kind: "restoreTxn"; txnId: number }
  | { kind: "setBusinessName"; name: string }
  | { kind: "setHours"; start: string; end: string }
  | { kind: "export"; format: "csv" | "pdf" | "backup"; spec: PeriodSpec }
  | { kind: "moveTable"; from: number; to: number }
  | { kind: "undo" };

export type Card =
  | { kind: "bill"; title: string; lines: Line[]; total: number; highlight?: string[]; note?: string; tableId?: number }
  | { kind: "stats"; title: string; stats: { label: string; value: string }[]; rows?: { label: string; value: string }[] }
  | { kind: "list"; title: string; rows: { label: string; value?: string; sub?: string }[] };

export interface AgentReply {
  text: string;
  /** Shorter wording for text-to-speech; defaults to text. */
  speak?: string;
  card?: Card;
  /** Apply immediately. */
  execute?: Plan;
  /** Ask first; executed when the user confirms. */
  confirm?: { plan: Plan; yes: string; doneText: string };
  /** Show an Undo button after executing. */
  undoable?: boolean;
  suggestions?: string[];
  tone?: "normal" | "warn" | "error";
  /** A button that opens a screen (how-to answers). */
  link?: { label: string; route: Route };
}

export type Pending =
  | { kind: "confirm"; plan: Plan; doneText: string; undoable: boolean }
  | { kind: "needTable"; resume: (tableId: number, world: World, ctx: AgentContext) => AgentReply | Resumed }
  | { kind: "needPrice"; name: string; qty: number; tableId: number; split: number }
  | { kind: "needSplit"; tableId: number; cash?: number }
  | { kind: "needName"; resume: (name: string, world: World, ctx: AgentContext) => AgentReply | Resumed };

/** A follow-up that also changes the conversation (e.g. leaves a confirmation pending). */
export interface Resumed {
  reply: AgentReply;
  ctx: AgentContext;
}

/** The last order the agent added, so "no, table 4" or "mami pala" can correct it. */
export interface LastAdd {
  tableId: number;
  split: number;
  lines: Line[];
  at: number;
}

export interface AgentContext {
  lastTableId: number | null;
  lastTableAt: number;
  lastLines: Line[];
  pending: Pending | null;
  lastAdd?: LastAdd | null;
}

export interface World {
  data: AppData;
  /** Table whose order screen is open, if any. */
  currentTableId: number | null;
  activeSplit: number;
  now: Date;
}

export type AgentInput = string | { type: "confirm" } | { type: "cancel" };

export const emptyContext = (): AgentContext => ({ lastTableId: null, lastTableAt: 0, lastLines: [], pending: null });
