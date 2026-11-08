// Utang (credit) list: who owes what, with payment recording.

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useApp } from "../store/appStore";
import { tableDisplayName } from "../lib/bill";
import { fmtDayLabel, fmtTime, peso, plural } from "../lib/format";
import { METHOD_LABEL, utangAccounts, utangBalance, utangPaid, type UtangAccount } from "../lib/money";
import { TopBar } from "../ui/components";
import { IconCash, IconChevron } from "../ui/Icons";

function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

function Account({ a }: { a: UtangAccount }) {
  const [open, setOpen] = useState(false);
  const tableList = useApp((s) => s.data.tableList);
  const { openDialog } = useApp.getState();
  const shown = open ? a.all.slice().reverse() : [];
  return (
    <div className="txn">
      <button className="txn-row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="desc">
          <b>{a.name}</b>
          <small>
            {a.balance > 0 ? `${plural(a.open.length, "unpaid order")} · since ${a.since ? daysAgo(a.since) : ""}` : `Paid off · ${plural(a.all.length, "order")}`}
          </small>
        </span>
        <span className={`amt${a.balance > 0 ? " gold" : ""}`}>{a.balance > 0 ? peso(a.balance) : "✓"}</span>
        <span className={`chev${open ? " open" : ""}`}>
          <IconChevron />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="txn-detail" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
            <div className="txn-detail-inner">
              {shown.map((t) => (
                <div key={t.id} className="utang-entry">
                  <div className="txn-item">
                    <span>
                      <b>{fmtDayLabel(new Date(t.ts))}</b> · {fmtTime(t.ts)} · {tableDisplayName(tableList, t.table)}
                    </span>
                    <span>{peso(t.total)}</span>
                  </div>
                  <div className="txn-item sub">
                    <span>{t.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</span>
                    <span>{utangBalance(t) > 0 ? `${peso(utangBalance(t))} left` : "Paid"}</span>
                  </div>
                  {(t.payments ?? []).map((p, i) => (
                    <div key={i} className="txn-item sub green">
                      <span>
                        Paid {fmtDayLabel(new Date(p.ts))} · {METHOD_LABEL[p.method]}
                      </span>
                      <span>−{peso(p.amount)}</span>
                    </div>
                  ))}
                </div>
              ))}
              {a.balance > 0 && (
                <div className="txn-actions">
                  <button className="btn btn-primary btn-small" onClick={() => openDialog({ type: "utang-pay", customer: a.name })}>
                    <IconCash /> Record payment
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function UtangScreen() {
  const history = useApp((s) => s.data.history);
  const accounts = utangAccounts(history);
  const owing = accounts.filter((a) => a.balance > 0);
  const paid = accounts.filter((a) => a.balance <= 0);
  const total = owing.reduce((s, a) => s + a.balance, 0);
  const collected = history.reduce((s, t) => s + utangPaid(t), 0);
  return (
    <div className="screen">
      <TopBar back="Summary" title="Utang" sub={owing.length ? `${peso(total)} unpaid · ${plural(owing.length, "person", "people")}` : "No unpaid utang"} />
      <main className="screen-body">
        <p className="intro">To list a bill as utang, open the table, choose <b>Utang</b> under the total and enter the customer’s name. Payments are applied to their oldest orders first.</p>
        <div className="section-title">Still owing</div>
        {owing.length ? (
          <div className="card list">
            {owing.map((a) => (
              <Account key={a.key} a={a} />
            ))}
          </div>
        ) : (
          <div className="card empty-state">Nobody owes you right now. 🎉</div>
        )}
        {paid.length > 0 && (
          <>
            <div className="section-title">Paid off</div>
            <div className="card list">
              {paid.map((a) => (
                <Account key={a.key} a={a} />
              ))}
            </div>
          </>
        )}
        {collected > 0 && <div className="hint center">{peso(collected)} collected from utang so far.</div>}
      </main>
    </div>
  );
}
