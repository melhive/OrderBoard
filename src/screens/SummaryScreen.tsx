import { AnimatePresence, motion } from "motion/react";
import { useApp } from "../store/appStore";
import type { Period, Txn } from "../data/types";
import { tableDisplayName } from "../lib/bill";
import { businessDayKey, groupByDay, isSingleDay, parseISODate, periodLabel, summarize, txnsForPeriod } from "../lib/businessDay";
import { fmtDayLabel, fmtLongDate, fmtTime, peso, plural } from "../lib/format";
import { METHOD_LABEL, expensesForPeriod, methodOf, moneyBreakdown, utangAccounts, utangBalance } from "../lib/money";
import { TopBar } from "../ui/components";
import { IconCalendar, IconCash, IconChevron, IconDownload, IconPlus, IconTrash, IconUndo, IconX } from "../ui/Icons";
import { useMinuteTick } from "../ui/hooks";

const PERIODS: { p: Period; label: string }[] = [
  { p: "today", label: "Today" },
  { p: "week", label: "This week" },
  { p: "month", label: "This month" },
  { p: "all", label: "All time" },
];

const expand = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.22, ease: [0.3, 0.7, 0.2, 1] as const },
};

function TxnList({ txns }: { txns: Txn[] }) {
  const tableList = useApp((s) => s.data.tableList);
  const expanded = useApp((s) => s.expandedTxnId);
  const { toggleTxn, askRestoreTxn, askDeleteTxn } = useApp.getState();
  return (
    <>
      {txns
        .slice()
        .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b.id - a.id))
        .map((h) => {
          const open = expanded === h.id;
          const n = h.items.reduce((s, i) => s + i.qty, 0);
          const m = methodOf(h);
          const owed = utangBalance(h);
          return (
            <div key={h.id} className="txn">
              <button className="txn-row" onClick={() => toggleTxn(h.id)} aria-expanded={open}>
                <span className="time">{fmtTime(h.ts)}</span>
                <span className="desc">
                  <b>{tableDisplayName(tableList, h.table)}</b>
                  <small>
                    {m !== "cash" && <span className={`mtag ${m}`}>{m === "utang" ? `Utang · ${h.customer}` : METHOD_LABEL[m]}</span>}
                    {plural(n, "item")} · {h.items.map((i) => i.name).join(", ")}
                  </small>
                </span>
                <span className="amt">{peso(h.total)}</span>
                <span className={`chev${open ? " open" : ""}`}>
                  <IconChevron />
                </span>
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div className="txn-detail" {...expand}>
                    <div className="txn-detail-inner">
                      {h.items.map((it, i) => (
                        <div key={i} className="txn-item">
                          <span>
                            {it.qty}× {it.name}
                            {it.note && <small className="lnote"> · {it.note}</small>}
                          </span>
                          <span>{peso(it.price * it.qty)}</span>
                        </div>
                      ))}
                      {m === "utang" && (
                        <div className="txn-item">
                          <span>Utang · {h.customer}</span>
                          <span>{owed > 0 ? `${peso(owed)} still owed` : "Paid off"}</span>
                        </div>
                      )}
                      {h.cash !== undefined && (
                        <div className="txn-item">
                          <span>Cash {peso(h.cash)}</span>
                          <span>Change {peso(Math.max(0, h.cash - h.total))}</span>
                        </div>
                      )}
                      <div className="txn-actions">
                        <button className="btn btn-secondary btn-small" onClick={() => askRestoreTxn(h.id)}>
                          <IconUndo /> Restore to table
                        </button>
                        <button className="btn btn-danger btn-small" onClick={() => askDeleteTxn(h.id)}>
                          <IconTrash /> Delete order
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
    </>
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
  const money = moneyBreakdown(data.history, data.expenses, spec, hours);
  const expenses = expensesForPeriod(data.expenses, spec, hours).slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const accounts = utangAccounts(data.history).filter((a) => a.balance > 0);
  const owedTotal = accounts.reduce((s, a) => s + a.balance, 0);
  const collected = money.collected.cash + money.collected.gcash + money.collected.maya;
  const appActions = useApp.getState();

  const customLabel =
    spec.period === "custom" && spec.from && spec.to
      ? spec.from === spec.to
        ? fmtDayLabel(parseISODate(spec.from))
        : `${fmtDayLabel(parseISODate(spec.from))} – ${fmtDayLabel(parseISODate(spec.to))}`
      : "Pick dates";

  return (
    <div className="screen">
      <TopBar title="Summary" sub={`Business day · ${fmtLongDate(parseISODate(todayKey))}`} />
      <main className="screen-body with-nav">
        <div className="period-bar">
          <div className="chips" role="tablist" aria-label="Period">
            {PERIODS.map(({ p, label }) => (
              <button key={p} role="tab" aria-selected={spec.period === p} className={`chip${spec.period === p ? " active" : ""}`} onClick={() => setPeriod(p)}>
                {label}
              </button>
            ))}
            <button role="tab" aria-selected={spec.period === "custom"} className={`chip${spec.period === "custom" ? " active" : ""}`} onClick={() => openDialog({ type: "pick-date" })}>
              <IconCalendar /> {customLabel}
            </button>
          </div>
        </div>

        <motion.div key={`${spec.period}${spec.from}${spec.to}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <div className="card hero">
            <div className="label">{periodLabel(spec)} earnings</div>
            <div className="value">{peso(summary.total)}</div>
            <div className="stats">
              <div>
                <div className="stat-n">{summary.orders}</div>
                <div className="stat-l">Orders</div>
              </div>
              <div>
                <div className="stat-n">{summary.itemsSold}</div>
                <div className="stat-l">Items sold</div>
              </div>
              <div>
                <div className="stat-n">{peso(summary.orders ? summary.total / summary.orders : 0)}</div>
                <div className="stat-l">Avg order</div>
              </div>
            </div>
          </div>

          <div className="section-title">Money</div>
          <div className="card money">
            {(["cash", "gcash", "maya"] as const).map((k) =>
              k === "cash" || money.sales[k] ? (
                <div key={k} className="money-row">
                  <span>{METHOD_LABEL[k]}</span>
                  <b>{peso(money.sales[k])}</b>
                </div>
              ) : null,
            )}
            {money.sales.utang > 0 && (
              <div className="money-row">
                <span>Sold on utang</span>
                <b className="gold">{peso(money.sales.utang)}</b>
              </div>
            )}
            {collected > 0 && (
              <div className="money-row">
                <span>Utang collected</span>
                <b className="green">+{peso(collected)}</b>
              </div>
            )}
            <div className="money-row">
              <span>Expenses</span>
              <b className={money.expenses ? "red" : ""}>{money.expenses ? `−${peso(money.expenses)}` : peso(0)}</b>
            </div>
            <div className="money-row total">
              <span>Profit</span>
              <b className={money.profit < 0 ? "red" : "green"}>{money.profit < 0 ? `−${peso(-money.profit)}` : peso(money.profit)}</b>
            </div>
            <div className="money-note">Profit = sales − expenses. Money received {peso(money.received)}.</div>
            {expenses.length > 0 && (
              <div className="expense-list">
                {expenses.map((e) => (
                  <div key={e.id} className="expense">
                    <span className="time">{single ? fmtTime(e.ts) : fmtDayLabel(new Date(e.ts))}</span>
                    <span className="what">{e.what}</span>
                    <span className="amt">−{peso(e.amount)}</span>
                    <button
                      className="icon-btn"
                      aria-label={`Delete expense ${e.what}`}
                      onClick={() => {
                        appActions.checkpoint("expense");
                        appActions.deleteExpense(e.id);
                        appActions.showToast({ text: `Expense “${e.what}” deleted`, action: { label: "Undo", run: () => useApp.getState().undo() } });
                      }}
                    >
                      <IconX />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn-secondary btn-small add-expense" onClick={() => openDialog({ type: "add-expense" })}>
              <IconPlus /> Add expense
            </button>
          </div>

          {(accounts.length > 0 || data.history.some((h) => methodOf(h) === "utang")) && (
            <button className="card utang-link" onClick={() => appActions.push({ name: "utang" })}>
              <span className="sico gold">
                <IconCash />
              </span>
              <span className="smain">
                <b>Utang</b>
                <span>{accounts.length ? `${peso(owedTotal)} unpaid · ${plural(accounts.length, "person", "people")}` : "Everyone has paid"}</span>
              </span>
              <span className="strail">
                <IconChevron />
              </span>
            </button>
          )}

          <div className="section-title">Best sellers</div>
          {best.length ? (
            <div className="card list">
              {best.map((b, i) => (
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
              ))}
            </div>
          ) : (
            <div className="card empty-state">No sales in this period yet.</div>
          )}

          {single && txns.length > 0 && (
            <>
              <div className="section-title">Transactions · {txns.length}</div>
              <div className="card list">
                <TxnList txns={txns} />
              </div>
            </>
          )}

          {!single && days.length > 0 && (
            <>
              <div className="section-title">Daily breakdown</div>
              <div className="card list">
                {days.map((d) => {
                  const open = expandedDay === d.key;
                  return (
                    <div key={d.key} className="day">
                      <button className="day-row" onClick={() => toggleDay(d.key)} aria-expanded={open}>
                        <span className="dl">{fmtDayLabel(d.date)}</span>
                        <span className="track">
                          <motion.span className="fill" initial={{ width: 0 }} animate={{ width: `${Math.max(3, Math.round((d.total / maxDay) * 100))}%` }} transition={{ duration: 0.5, ease: "easeOut" }} />
                        </span>
                        <span className="da">{peso(d.total)}</span>
                        <span className={`chev${open ? " open" : ""}`}>
                          <IconChevron />
                        </span>
                      </button>
                      <AnimatePresence initial={false}>
                        {open && (
                          <motion.div className="day-txns" {...expand}>
                            <div className="day-txns-inner">
                              <TxnList txns={txns.filter((h) => businessDayKey(new Date(h.ts), hours) === d.key)} />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </motion.div>

        <div className="section-title">Reports</div>
        <div className="actions-row">
          <button className="btn btn-green" disabled={!txns.length && !expenses.length} onClick={() => openDialog({ type: "export-menu" })}>
            <IconDownload /> Export
          </button>
          <button className="btn btn-secondary" disabled={!hasToday} onClick={() => askResetToday()}>
            Reset today
          </button>
        </div>
        {!txns.length && <div className="hint center">No sales recorded in this period — nothing to export.</div>}
      </main>
    </div>
  );
}
