import type { AppData, ThemePref } from "../data/types";
import type { PeriodSpec } from "../lib/businessDay";
import type { Route } from "../store/appStore";

export interface Line {
  name: string;
  price: number;
  qty: number;
}

/** A concrete change the agent wants to make. Executed by executor.ts. */
export type Plan =
  | { kind: "addItems"; tableId: number; split: number; items: Line[] }
  | { kind: "removeItems"; tableId: number; split: number; items: { name: string; qty: number | "all" }[] }
  | { kind: "setQty"; tableId: number; split: number; name: string; qty: number }
  | { kind: "pay"; tableId: number; splits: number[]; cash?: number }
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
}

export type Pending =
  | { kind: "confirm"; plan: Plan; doneText: string; undoable: boolean }
  | { kind: "needTable"; resume: (tableId: number, world: World, ctx: AgentContext) => AgentReply }
  | { kind: "needPrice"; name: string; qty: number; tableId: number; split: number }
  | { kind: "needSplit"; tableId: number; cash?: number };

export interface AgentContext {
  lastTableId: number | null;
  lastTableAt: number;
  lastLines: Line[];
  pending: Pending | null;
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
