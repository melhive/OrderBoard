import { AnimatePresence, motion } from "motion/react";
import { useApp } from "../store/appStore";
import type { Period, Txn } from "../data/types";
import { tableDisplayName } from "../lib/bill";
import { businessDayKey, groupByDay, isSingleDay, parseISODate, periodLabel, summarize, txnsForPeriod } from "../lib/businessDay";
import { fmtDayLabel, fmtLongDate, fmtTime, peso, plural } from "../lib/format";
import { TopBar } from "../ui/components";
import { IconCalendar, IconChevron, IconTrash, IconUndo } from "../ui/Icons";
import { useMinuteTick } from "../ui/hooks";

const PERIODS: { p: Period; label: string }[] = [
  { p: "today", label: "Today" },
  { p: "week", label: "Week" },
  { p: "month", label: "Month" },
  { p: "all", label: "All time" },
];

const expand = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.2 },
};

function TxnList({ txns }: { txns: Txn[] }) {
  const tableList = useApp((s) => s.data.tableList);
  const expanded = useApp((s) => s.expandedTxnId);
  const { toggleTxn, askRestoreTxn, askDeleteTxn } = useApp.getState();
  return (
    <div>
      {txns
        .slice()
        .reverse()
        .map((h) => {
          const open = expanded === h.id;
          const n = h.items.reduce((s, i) => s + i.qty, 0);
          return (
            <div key={h.id} className="txn-wrap">
              <button className="txn-row" onClick={() => toggleTxn(h.id)} aria-expanded={open}>
                <span className="time">{fmtTime(h.ts)}</span>
                <span className="desc">
                  <b>{tableDisplayName(tableList, h.table)}</b> · {plural(n, "item")}
                </span>
                <span className="amt">{peso(h.total)}</span>
                <span className={`chev${open ? " open" : ""}`}>
                  <IconChevron />
                </span>
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div className="txn-detail" {...expand}>
                    {h.items.map((it, i) => (
                      <div key={i} className="txn-item">
                        <span>
                          {it.qty}× {it.name}
                        </span>
                        <span>{peso(it.price * it.qty)}</span>
                      </div>
                    ))}
                    {h.cash !== undefined && (
                      <div className="txn-item">
                        <span>Cash {peso(h.cash)}</span>
                        <span>Change {peso(Math.max(0, h.cash - h.total))}</span>
                      </div>
                    )}
                    <div className="txn-actions">
                      <button className="btn btn-shell btn-small" onClick={() => askRestoreTxn(h.id)}>
                        <IconUndo /> Restore to table
                      </button>
                      <button className="btn btn-danger-outline btn-small" onClick={() => askDeleteTxn(h.id)}>
                        <IconTrash /> Delete order
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
    </div>
  );
}

export function SummaryScreen() {
  useMinuteTick();
  const data = useApp((s) => s.data);
  const spec = useApp((s) => s.summary);
  const expandedDay = useApp((s) => s.expandedDayKey);
  const { setPeriod, openDialog, toggleDay, askResetToday } = useApp.getState();

  const hours = data.settings;
  const txns = txnsForPeriod(data.history, spec, hours);
  const summary = summarize(txns);
  const single = isSingleDay(spec);
  const days = single ? [] : groupByDay(txns, hours);
  const maxDay = days.reduce((m, d) => Math.max(m, d.total), 1);
  const hasToday = txnsForPeriod(data.history, { period: "today" }, hours).length > 0;
  const best = summary.best.slice(0, 5);
  const maxBest = best[0]?.qty ?? 1;
  const todayKey = businessDayKey(new Date(), hours);

  const customLabel =
    spec.period === "custom" && spec.from && spec.to
      ? spec.from === spec.to
        ? fmtDayLabel(parseISODate(spec.from))
        : `${fmtDayLabel(parseISODate(spec.from))} – ${fmtDayLabel(parseISODate(spec.to))}`
      : "Pick dates";

  return (
    <div className="screen">
      <TopBar>
        <div className="brand">
          <div className="kicker">{fmtLongDate(parseISODate(todayKey))}</div>
          <h1>Summary</h1>
        </div>
      </TopBar>
      <main className="screen-body">
        <div className="period-tabs" role="tablist" aria-label="Period">
          {PERIODS.map(({ p, label }) => (
            <button key={p} role="tab" aria-selected={spec.period === p} className={`period-tab${spec.period === p ? " active" : ""}`} onClick={() => setPeriod(p)}>
              {label}
            </button>
          ))}
          <button role="tab" aria-selected={spec.period === "custom"} className={`period-tab${spec.period === "custom" ? " active" : ""}`} onClick={() => openDialog({ type: "pick-date" })}>
            <IconCalendar /> {customLabel}
          </button>
        </div>

        <motion.div key={`${spec.period}${spec.from}${spec.to}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          <div className="summary-hero">
            <div className="label">{periodLabel(spec)} earnings</div>
            <div className="value">{peso(summary.total)}</div>
          </div>
          <div className="stat-row">
            <div className="stat-box">
              <div className="n">{summary.orders}</div>
              <div className="l">Orders</div>
            </div>
            <div className="stat-box">
              <div className="n">{summary.itemsSold}</div>
              <div className="l">Items sold</div>
            </div>
            <div className="stat-box">
              <div className="n">{peso(summary.orders ? summary.total / summary.orders : 0)}</div>
              <div className="l">Avg order</div>
            </div>
          </div>

          <div className="cat-label">Best sellers</div>
          {best.length ? (
            best.map((b, i) => (
              <div key={b.name} className="best-row">
                <span className="rank">{i + 1}</span>
                <div className="n">
                  {b.name}
                  <div className="bar">
                    <i style={{ width: `${Math.round((b.qty / maxBest) * 100)}%` }} />
                  </div>
                </div>
                <span className="q">
                  ×{b.qty}
                  <small>{peso(b.revenue)}</small>
                </span>
              </div>
            ))
          ) : (
            <div className="empty-state">No sales in this period yet.</div>
          )}

          {single && txns.length > 0 && (
            <>
              <div className="cat-label">Transactions</div>
              <TxnList txns={txns} />
            </>
          )}

          {!single && days.length > 0 && (
            <>
              <div className="cat-label">Daily breakdown</div>
              {days.map((d) => {
                const open = expandedDay === d.key;
                return (
                  <div key={d.key} className="day-wrap">
                    <button className="day-row" onClick={() => toggleDay(d.key)} aria-expanded={open}>
                      <span className="dl">{fmtDayLabel(d.date)}</span>
                      <span className="track">
                        <motion.span className="fill" style={{ display: "block" }} initial={{ width: 0 }} animate={{ width: `${Math.round((d.total / maxDay) * 100)}%` }} transition={{ duration: 0.5, ease: "easeOut" }} />
                      </span>
                      <span className="da">{peso(d.total)}</span>
                      <span className={`chev${open ? " open" : ""}`}>
                        <IconChevron />
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div className="day-txns" {...expand}>
                          <TxnList txns={txns.filter((h) => businessDayKey(new Date(h.ts), hours) === d.key)} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </>
          )}
        </motion.div>

        <div className="cat-label">Reports</div>
        <div className="summary-actions">
          <button className="btn btn-leaf" disabled={!txns.length} onClick={() => openDialog({ type: "export-menu" })}>
            Export
          </button>
          <button className="btn btn-shell" disabled={!hasToday} onClick={() => askResetToday()}>
            Reset today
          </button>
        </div>
        {!txns.length && <div className="hint center">No sales recorded in this period — nothing to export.</div>}
      </main>
    </div>
  );
}
