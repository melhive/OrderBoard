// Applies agent Plans to the app store. Every mutating plan records an undo
// checkpoint first, so "undo" (or the Undo button) reverts it exactly.

import { currentRoute, useApp } from "../store/appStore";
import type { Plan } from "./types";
import { exportAllData, exportReport } from "../store/exports";

export interface ExecResult {
  ok: boolean;
  /** Overrides the reply text (e.g. when undo had nothing to undo). */
  text?: string;
}

export function executePlan(plan: Plan): ExecResult {
  const app = useApp.getState();
  const d = app.data;
  switch (plan.kind) {
    case "undo": {
      const label = app.undo();
      return label ? { ok: true, text: "Done — I undid the last change." } : { ok: false, text: "There’s nothing to undo." };
    }
    case "navigate": {
      const r = plan.route;
      if (r.name === "order") app.openTable(r.tableId);
      else if (r.name === "tables" || r.name === "summary") app.goTab(r.name);
      else {
        // Leave the chat, then open the screen (Back returns to where you were).
        if (currentRoute(app).name === "ask") app.back();
        useApp.getState().push(r);
      }
      return { ok: true };
    }
    case "setTheme":
      app.setTheme(plan.theme);
      return { ok: true };
    case "export":
      if (plan.format === "backup") void exportAllData();
      else exportReport(plan.format, plan.spec);
      return { ok: true };
    default:
      break;
  }

  app.checkpoint(plan.kind);
  switch (plan.kind) {
    case "addItems": {
      ensureTable(plan.tableId);
      for (const it of plan.items) app.addItem(plan.tableId, it.name, it.price, it.qty, plan.split);
      return { ok: true };
    }
    case "removeItems": {
      for (const r of plan.items) {
        const line = useApp.getState().data.tables[plan.tableId]?.[plan.split]?.items.find((i) => i.name === r.name);
        if (!line) continue;
        app.setLineQty(plan.tableId, plan.split, r.name, r.qty === "all" ? 0 : Math.max(0, line.qty - r.qty));
      }
      return { ok: true };
    }
    case "setQty":
      app.setLineQty(plan.tableId, plan.split, plan.name, plan.qty);
      return { ok: true };
    case "pay": {
      // Pay highest index first so earlier indexes stay valid.
      const order = [...plan.splits].sort((a, b) => b - a);
      for (const i of order) app.markPaid(plan.tableId, i, order.length === 1 ? plan.cash : undefined);
      return { ok: true };
    }
    case "clear":
      app.setData((dd) => ({
        ...dd,
        tables: { ...dd.tables, [plan.tableId]: (dd.tables[plan.tableId] ?? []).map((sp, i) => (i === plan.split ? { items: [] } : sp)) },
      }));
      return { ok: true };
    case "addSplit":
      ensureTable(plan.tableId);
      app.setData((dd) => ({ ...dd, tables: { ...dd.tables, [plan.tableId]: [...(dd.tables[plan.tableId]?.length ? dd.tables[plan.tableId]! : [{ items: [] }]), { items: [] }] } }));
      return { ok: true };
    case "addTable":
      app.addTable(plan.name);
      return { ok: true };
    case "moveTable":
      app.setData((dd) => {
        const moving = (dd.tables[plan.from] ?? []).filter((sp) => sp.items.length);
        const staying = (dd.tables[plan.to] ?? []).filter((sp) => sp.items.length);
        return { ...dd, tables: { ...dd.tables, [plan.from]: [], [plan.to]: [...staying, ...moving.map((sp) => ({ items: sp.items.map((i) => ({ ...i })) }))] } };
      });
      return { ok: true };
    case "removeTable":
      app.removeTable(plan.tableId);
      return { ok: true };
    case "setPrice": {
      const cat = d.menu.find((c) => c.id === plan.catId);
      const item = cat?.items.find((i) => i.id === plan.itemId);
      if (!item) return { ok: false, text: "That item no longer exists." };
      app.saveMenuItem(plan.catId, plan.itemId, { name: item.name, price: plan.price, aliases: item.aliases });
      return { ok: true };
    }
    case "addMenuItem": {
      let catId = plan.catId;
      if (catId === null) {
        app.saveCategory(null, plan.newCategory ?? "Others");
        const menu = useApp.getState().data.menu;
        catId = menu[menu.length - 1]!.id;
      }
      app.saveMenuItem(catId, null, { name: plan.name, price: plan.price, aliases: [] });
      return { ok: true };
    }
    case "removeMenuItem":
      app.deleteMenuItem(plan.catId, plan.itemId);
      return { ok: true };
    case "restoreTxn":
      app.restoreTxn(plan.txnId);
      return { ok: true };
    case "setBusinessName":
      app.updateSettings({ businessName: plan.name });
      return { ok: true };
    case "setHours":
      app.updateSettings({ workStart: plan.start, workEnd: plan.end });
      return { ok: true };
  }
}

function ensureTable(tableId: number) {
  const s = useApp.getState();
  if (!s.data.tables[tableId] || s.data.tables[tableId]!.length === 0) {
    s.setData((dd) => ({ ...dd, tables: { ...dd.tables, [tableId]: [{ items: [] }] } }));
  }
}
