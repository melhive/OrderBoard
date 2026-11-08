// Persistence: IndexedDB through Dexie. Sales history is stored one row per
// transaction (it grows forever); everything else is one "workspace" record.

import Dexie, { type Table } from "dexie";
import { freshData } from "./defaults";
import { LEGACY_STORAGE_KEY, looksLikeAppData, normalizeAppData } from "./migrate";
import type { AppData, Txn, Workspace } from "./types";

interface KV {
  key: string;
  value: unknown;
}

class OrderBoardDB extends Dexie {
  kv!: Table<KV, string>;
  history!: Table<Txn, number>;
  constructor() {
    super("order-board");
    this.version(1).stores({ kv: "key", history: "id, ts" });
  }
}

export const db = new OrderBoardDB();

const WORKSPACE_KEY = "workspace";

export type LoadSource = "indexeddb" | "legacy" | "fresh";

export async function loadAppData(): Promise<{ data: AppData; source: LoadSource }> {
  const row = await db.kv.get(WORKSPACE_KEY);
  if (row && row.value) {
    const history = await db.history.orderBy("id").toArray();
    return { data: normalizeAppData({ ...(row.value as object), history }), source: "indexeddb" };
  }

  // First run of the new app on this device: bring over the old app's data.
  let legacyRaw: string | null = null;
  try {
    legacyRaw = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY) ?? null;
  } catch {
    legacyRaw = null;
  }
  if (legacyRaw) {
    try {
      const parsed: unknown = JSON.parse(legacyRaw);
      if (looksLikeAppData(parsed)) {
        const data = normalizeAppData(parsed);
        await replaceAll(data);
        // Keep the old copy (renamed) as a safety net instead of deleting it.
        try {
          localStorage.setItem(LEGACY_STORAGE_KEY + "_migrated", legacyRaw);
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          /* storage full or blocked: leaving the original in place is fine */
        }
        return { data, source: "legacy" };
      }
    } catch {
      /* corrupt legacy data: fall through to a fresh start */
    }
  }

  const data = freshData();
  await replaceAll(data);
  return { data, source: "fresh" };
}

export function workspaceOf(data: AppData): Workspace {
  const { history: _history, ...ws } = data;
  return ws;
}

export async function saveWorkspace(ws: Workspace): Promise<void> {
  await db.kv.put({ key: WORKSPACE_KEY, value: ws });
}

export async function putTxn(txn: Txn): Promise<void> {
  await db.history.put(txn);
}

export async function deleteTxns(ids: number[]): Promise<void> {
  await db.history.bulkDelete(ids);
}

export async function replaceAll(data: AppData): Promise<void> {
  await db.transaction("rw", db.kv, db.history, async () => {
    await db.kv.put({ key: WORKSPACE_KEY, value: workspaceOf(data) });
    await db.history.clear();
    await db.history.bulkPut(data.history);
  });
}

/** Ask the browser not to evict our data under storage pressure (Android). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
