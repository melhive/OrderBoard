// Core data model. Field names intentionally match the legacy (v1–v15) saved
// format so old backups and old localStorage data import without conversion.

export interface OrderItem {
  name: string;
  price: number;
  qty: number;
}

/** One separately-payable bill at a table. Most tables have exactly one. */
export interface Split {
  items: OrderItem[];
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
}

export interface MenuItem {
  id: number;
  name: string;
  price: number;
  /** Other names staff or customers use for this item; helps Ask Agent understand orders. */
  aliases?: string[];
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
}

export interface AppData extends Workspace {
  history: Txn[];
}

export type Period = "today" | "week" | "month" | "all" | "custom";
