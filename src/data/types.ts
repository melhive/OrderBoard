// Core data model. Field names intentionally match the legacy (v1–v15) saved
// format so old backups and old localStorage data import without conversion.

export interface OrderItem {
  name: string;
  price: number;
  qty: number;
  /** Kitchen note for this line, e.g. "walang sibuyas". Lines with different notes don't merge. */
  note?: string;
  /** How many of qty have been served (open bills only). */
  served?: number;
}

/** One separately-payable bill at a table. Most tables have exactly one. */
export interface Split {
  items: OrderItem[];
  /** ISO time the first item was added; drives the wait timer. */
  openedAt?: string;
}

/** How a bill was settled. Missing means cash (all v1–v17 records). */
export type PayMethod = "cash" | "gcash" | "maya" | "utang";
export type MoneyMethod = Exclude<PayMethod, "utang">;

/** A payment toward an utang (credit) sale. */
export interface UtangPayment {
  ts: string;
  amount: number;
  method: MoneyMethod;
}

/** Money spent running the stall (ingredients, gas, ice…). */
export interface Expense {
  id: number;
  /** ISO time it was recorded; grouped by business day. */
  ts: string;
  amount: number;
  what: string;
}

export interface TableDef {
  id: number;
  name: string;
  /** Built-in numbered tables are not custom; user-added ones are and can be removed. */
  custom: boolean;
}

/** A paid bill, recorded in sales history. */
export interface Txn {
  id: number;
  table: number;
  items: OrderItem[];
  total: number;
  /** ISO timestamp of payment. */
  ts: string;
  /** Cash received, when entered. */
  cash?: number;
  /** Missing = cash. */
  method?: PayMethod;
  /** Who owes it, for utang sales. */
  customer?: string;
  /** Payments made toward an utang sale. */
  payments?: UtangPayment[];
}

export interface MenuItem {
  id: number;
  name: string;
  price: number;
  /** Other names staff or customers use for this item; helps Ask Agent understand orders. */
  aliases?: string[];
  /** Business-day key (YYYY-MM-DD) on which it was marked sold out; it is available again the next business day. */
  soldOut?: string;
}

export interface MenuCategory {
  id: number;
  cat: string;
  items: MenuItem[];
}

export type ThemePref = "dark" | "light" | "system";

export interface AgentSettings {
  /** Speak replies aloud in voice mode. */
  voiceReplies: boolean;
  /** Ask before adding items (off = add immediately with an Undo button). */
  confirmAdds: boolean;
  /** Keep listening after each spoken reply (hands-free conversation). */
  handsFree: boolean;
}

export interface Settings {
  theme: ThemePref;
  businessName: string;
  /** "HH:MM" 24h */
  workStart: string;
  workEnd: string;
  haptics: boolean;
  agent: AgentSettings;
  /** Version of the Terms/Privacy the user accepted on first launch. */
  acceptedLegalVersion: string | null;
  /** Remind to save a backup when the last one is old. */
  backupReminder: boolean;
  /** ISO time of the last "Export all data". */
  lastBackupAt: string | null;
  /** ISO time until which the backup reminder is hidden. */
  backupSnoozeUntil: string | null;
}

/** Everything except sales history. Saved as one record. */
export interface Workspace {
  tables: Record<string, Split[]>;
  tableList: TableDef[];
  nextCustomId: number;
  menu: MenuCategory[];
  nextMenuCatId: number;
  nextMenuItemId: number;
  settings: Settings;
  expenses: Expense[];
}

export interface AppData extends Workspace {
  history: Txn[];
}

export type Period = "today" | "week" | "month" | "all" | "custom";
