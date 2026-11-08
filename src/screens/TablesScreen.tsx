import { motion } from "motion/react";
import { useEffect } from "react";
import { useApp } from "../store/appStore";
import { tableCount, tableTotal } from "../lib/bill";
import { txnsForPeriod } from "../lib/businessDay";
import { peso, plural } from "../lib/format";
import { haptic } from "../platform/haptics";
import { TopBar } from "../ui/components";
import { IconGear, IconPlus, IconX } from "../ui/Icons";
import { useMinuteTick } from "../ui/hooks";

export function TablesScreen() {
  useMinuteTick();
  const data = useApp((s) => s.data);
  const settled = useApp((s) => s.justSettledTableId);
  const { openTable, openDialog, push } = useApp.getState();

  useEffect(() => {
    if (settled === null) return;
    const t = setTimeout(() => useApp.setState({ justSettledTableId: null }), 1100);
    return () => clearTimeout(t);
  }, [settled]);

  const today = txnsForPeriod(data.history, { period: "today" }, data.settings);
  const todayTotal = today.reduce((s, h) => s + h.total, 0);
  const openTables = data.tableList.filter((t) => tableCount(data.tables[t.id]) > 0);
  const openTotal = openTables.reduce((s, t) => s + tableTotal(data.tables[t.id]), 0);

  return (
    <div className="screen">
      <TopBar>
        <div className="brand">
          <div className="kicker">{data.settings.businessName || "Street Food"}</div>
          <h1>Order Board</h1>
        </div>
        <div className="topbar-actions">
          <div className="chip">
            Today <b>{peso(todayTotal)}</b>
          </div>
          <button className="icon-btn" aria-label="Settings" onClick={() => push({ name: "settings" })}>
            <IconGear />
          </button>
        </div>
      </TopBar>
      <main className="screen-body">
        {openTables.length > 0 && (
          <div className="open-summary">
            <div className="mini-stat">
              <div className="n">{openTables.length}</div>
              <div className="l">Open {openTables.length === 1 ? "table" : "tables"}</div>
            </div>
            <div className="mini-stat">
              <div className="n">{peso(openTotal)}</div>
              <div className="l">Unpaid</div>
            </div>
            <div className="mini-stat">
              <div className="n">{today.length}</div>
              <div className="l">Paid today</div>
            </div>
          </div>
        )}
        <div className="grid-tables">
          {data.tableList.map((t, i) => {
            const splits = data.tables[t.id];
            const count = tableCount(splits);
            const occupied = count > 0;
            const bills = (splits ?? []).filter((sp) => sp.items.length).length;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.025, type: "spring", stiffness: 380, damping: 30 }}
                style={{ position: "relative" }}
              >
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  className={`ticket ${occupied ? "occupied" : "empty"}${settled === t.id ? " settled" : ""}`}
                  onClick={() => {
                    haptic.tap();
                    openTable(t.id);
                  }}
                  aria-label={`${t.custom ? t.name : `Table ${t.name}`}${occupied ? `, ${peso(tableTotal(splits))}` : ", empty"}`}
                >
                  {t.custom ? (
                    <>
                      <div className="ticket-label">Order</div>
                      <div className="ticket-name">{t.name}</div>
                    </>
                  ) : (
                    <>
                      <div className="ticket-label">Table</div>
                      <div className="ticket-num">{t.name}</div>
                    </>
                  )}
                  {occupied ? (
                    <>
                      <div className="ticket-status">{peso(tableTotal(splits))}</div>
                      <div className="ticket-sub">
                        {plural(count, "item")}
                        {bills > 1 ? ` · ${bills} bills` : ""}
                      </div>
                    </>
                  ) : (
                    <div className="ticket-status">Empty · tap to start</div>
                  )}
                </motion.button>
                {t.custom && !occupied && (
                  <button
                    className="ticket-delete"
                    aria-label={`Remove ${t.name}`}
                    onClick={() => openDialog({ type: "confirm-remove-table", tableId: t.id, name: t.name })}
                  >
                    <IconX />
                  </button>
                )}
              </motion.div>
            );
          })}
          <motion.button layout whileTap={{ scale: 0.96 }} className="ticket empty add-new" onClick={() => openDialog({ type: "add-table" })}>
            <IconPlus />
            <div className="add-new-label">Add table</div>
          </motion.button>
        </div>
      </main>
    </div>
  );
}
