import { useEffect } from "react";
import { useApp } from "../store/appStore";
import { fmtElapsed, minutesSince, tableCount, tableOpenedAt, tableTotal, tableUnserved } from "../lib/bill";
import { txnsForPeriod } from "../lib/businessDay";
import { peso, plural } from "../lib/format";
import { backupDue } from "../lib/money";
import { exportAllData } from "../store/exports";
import { haptic } from "../platform/haptics";
import { TopBar } from "../ui/components";
import { IconClock, IconDownload, IconGear, IconPlus, IconX, LogoMark } from "../ui/Icons";

/** Minutes after which a table with unserved items is flagged as waiting long. */
const LONG_WAIT_MIN = 20;
import { useMinuteTick } from "../ui/hooks";

export function TablesScreen() {
  useMinuteTick();
  const data = useApp((s) => s.data);
  const settled = useApp((s) => s.justSettledTableId);
  const { openTable, openDialog, push } = useApp.getState();

  useEffect(() => {
    if (settled === null) return;
    const t = setTimeout(() => useApp.setState({ justSettledTableId: null }), 1000);
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
          <LogoMark size={36} />
          <div className="brand-text">
            <h1>Order Board</h1>
            <div className="sub">{data.settings.businessName || "Tables and orders"}</div>
          </div>
        </div>
        <button className="icon-btn" aria-label="Settings" onClick={() => push({ name: "settings" })}>
          <IconGear />
        </button>
      </TopBar>
      <main className="screen-body with-nav">
        {backupDue(data.settings, data.history) && (
          <div className="card banner" role="status">
            <span className="sico green">
              <IconDownload />
            </span>
            <div className="banner-text">
              <b>Save a backup?</b>
              <span>
                {data.settings.lastBackupAt ? `Your last backup was ${plural(Math.floor(minutesSince(data.settings.lastBackupAt) / 1440), "day")} ago.` : "You haven’t saved a backup yet."} All sales live only on this phone.
              </span>
              <div className="banner-actions">
                <button className="btn btn-green btn-small" onClick={() => void exportAllData()}>
                  Back up now
                </button>
                <button className="btn btn-ghost btn-small" onClick={() => useApp.getState().snoozeBackup(3)}>
                  Later
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="card today-card" aria-label="Today at a glance">
          <div>
            <div className="stat-n green">{peso(todayTotal)}</div>
            <div className="stat-l">Sales today</div>
          </div>
          <div>
            <div className={`stat-n${openTotal ? " red" : ""}`}>{peso(openTotal)}</div>
            <div className="stat-l">{openTables.length ? `Unpaid · ${plural(openTables.length, "table")}` : "Unpaid"}</div>
          </div>
          <div>
            <div className="stat-n">{today.length}</div>
            <div className="stat-l">Orders paid</div>
          </div>
        </div>

        <div className="grid-tables">
          {data.tableList.map((t) => {
            const splits = data.tables[t.id];
            const count = tableCount(splits);
            const open = count > 0;
            const bills = (splits ?? []).filter((sp) => sp.items.length).length;
            const label = t.custom ? t.name : `Table ${t.name}`;
            const openedAt = open ? tableOpenedAt(splits) : null;
            const toServe = open ? tableUnserved(splits) : 0;
            const longWait = !!openedAt && toServe > 0 && minutesSince(openedAt) >= LONG_WAIT_MIN;
            return (
              <div key={t.id} style={{ position: "relative" }}>
                <button
                  className={`tcard${open ? " open" : ""}${longWait ? " waiting" : ""}${settled === t.id ? " settled" : ""}`}
                  onClick={() => {
                    haptic.tap();
                    openTable(t.id);
                  }}
                  aria-label={`${label}${open ? `, ${peso(tableTotal(splits))}` : ", empty"}${toServe ? `, ${toServe} to serve` : ""}`}
                >
                  <div className="tcard-top">
                    <div style={{ minWidth: 0 }}>
                      <div className="tcard-kicker">{t.custom ? "Order" : "Table"}</div>
                      {t.custom ? <div className="tcard-name">{t.name}</div> : <div className="tcard-num">{t.name}</div>}
                    </div>
                    {open && <span className={`pill${toServe ? "" : " ok"}`}>{toServe ? `${toServe} to serve` : "Served"}</span>}
                  </div>
                  <div className="tcard-bottom">
                    {open ? (
                      <>
                        <div className="tcard-amt">{peso(tableTotal(splits))}</div>
                        <div className="tcard-meta">
                          {plural(count, "item")}
                          {bills > 1 ? ` · ${bills} bills` : ""}
                        </div>
                        {openedAt && (
                          <div className={`tcard-wait${longWait ? " long" : ""}`}>
                            <IconClock /> {fmtElapsed(openedAt)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="status">
                        <i /> Available
                      </span>
                    )}
                  </div>
                </button>
                {t.custom && !open && (
                  <button className="tcard-remove" aria-label={`Remove ${t.name}`} onClick={() => openDialog({ type: "confirm-remove-table", tableId: t.id, name: t.name })}>
                    <IconX />
                  </button>
                )}
              </div>
            );
          })}
          <button className="tcard add" onClick={() => openDialog({ type: "add-table" })}>
            <IconPlus />
            Add table
          </button>
        </div>
      </main>
    </div>
  );
}
