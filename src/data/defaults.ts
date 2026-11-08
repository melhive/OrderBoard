import type { AppData, MenuCategory, Settings, TableDef } from "./types";

export const DEFAULT_MENU: MenuCategory[] = [
  { id: 1, cat: "Pares", items: [
    { id: 1, name: "Pares", price: 60 },
    { id: 2, name: "Pares w/ Rice", price: 75 },
    { id: 3, name: "Pares w/ Egg", price: 75 },
    { id: 4, name: "Pares w/ Egg & Rice", price: 90 },
  ]},
  { id: 2, cat: "Mami", items: [
    { id: 5, name: "Mami", price: 50 },
    { id: 6, name: "Mami w/ Rice", price: 65 },
    { id: 7, name: "Mami w/ Egg", price: 65 },
    { id: 8, name: "Mami w/ Egg & Rice", price: 90 },
  ]},
  { id: 3, cat: "Pastil", items: [
    { id: 9, name: "Pastil", price: 50 },
    { id: 10, name: "Pastil w/ Egg", price: 65 },
  ]},
  { id: 4, cat: "Siomai", items: [
    { id: 11, name: "Siomai", price: 25 },
  ]},
  { id: 5, cat: "Drinks", items: [
    { id: 12, name: "Softdrinks", price: 25, aliases: ["soda", "coke", "sprite", "royal", "soft drink"] },
    { id: 13, name: "Water", price: 20, aliases: ["mineral water", "bottled water"] },
  ]},
  { id: 6, cat: "Add-ons", items: [
    { id: 14, name: "Rice", price: 15 },
    { id: 15, name: "Egg", price: 15 },
  ]},
];

export const DEFAULT_TABLES: TableDef[] = [
  { id: 1, name: "1", custom: false },
  { id: 2, name: "2", custom: false },
  { id: 3, name: "3", custom: false },
  { id: 4, name: "4", custom: false },
];

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  businessName: "",
  workStart: "18:00",
  workEnd: "02:00",
  haptics: true,
  agent: { voiceReplies: true, confirmAdds: false, handsFree: false },
  acceptedLegalVersion: null,
  backupReminder: true,
  lastBackupAt: null,
  backupSnoozeUntil: null,
};

export function freshData(): AppData {
  return {
    tables: { "1": [], "2": [], "3": [], "4": [] },
    tableList: DEFAULT_TABLES.map((t) => ({ ...t })),
    nextCustomId: 5,
    menu: structuredClone(DEFAULT_MENU),
    nextMenuCatId: 7,
    nextMenuItemId: 16,
    settings: structuredClone(DEFAULT_SETTINGS),
    expenses: [],
    history: [],
  };
}
