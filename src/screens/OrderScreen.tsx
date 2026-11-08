import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../store/appStore";
import type { MenuItem } from "../data/types";
import { splitCount, splitTotal, tableDisplayName } from "../lib/bill";
import { peso, plural } from "../lib/format";
import { haptic } from "../platform/haptics";
import { TopBar, BackButton } from "../ui/components";
import { IconCheck, IconMinus, IconPlus, IconSearch, IconSplit, IconX } from "../ui/Icons";

const PAID_FLASH_MS = 380;

/** Bills a customer is likely to hand over for a given total. */
export function quickCashOptions(total: number): number[] {
  if (total <= 0) return [];
  const out = new Set<number>([total]);
  for (const step of [50, 100, 500, 1000]) {
    const v = Math.ceil(total / step) * step;
    if (v > total) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

function MenuTile({ item, qty, onAdd }: { item: MenuItem; qty: number; onAdd: () => void }) {
  const [pulse, setPulse] = useState(0);
  return (
    <motion.button
      className="menu-tile"
      whileTap={{ scale: 0.95 }}
      onClick={() => {
        setPulse((p) => p + 1);
        onAdd();
      }}
      aria-label={`Add ${item.name}, ${peso(item.price)}${qty ? `, ${qty} on bill` : ""}`}
    >
      {pulse > 0 && (
        <motion.span
          key={pulse}
          aria-hidden
          style={{ position: "absolute", inset: 0, background: "var(--chili)", borderRadius: 12, pointerEvents: "none" }}
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      )}
      <span className="name" style={{ position: "relative" }}>{item.name}</span>
      <span className="price" style={{ position: "relative" }}>{peso(item.price)}</span>
      <AnimatePresence>
        {qty > 0 && (
          <motion.span
            key="badge"
            className="qty-badge"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 600, damping: 26 }}
          >
            {qty}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export function OrderScreen({ tableId }: { tableId: number }) {
  const data = useApp((s) => s.data);
  const activeSplitRaw = useApp((s) => s.activeSplit);
  const sheetOpen = useApp((s) => s.sheetOpen);
  const cashInput = useApp((s) => s.cashInput);
  const app = useApp.getState();
  const [query, setQuery] = useState("");
  const [paying, setPaying] = useState(false);
  const payLock = useRef(false);

  const table = data.tableList.find((t) => t.id === tableId);
  const splits = data.tables[tableId]?.length ? data.tables[tableId]! : [{ items: [] }];
  const activeSplit = Math.min(activeSplitRaw, splits.length - 1);
  const split = splits[activeSplit]!;
  const total = splitTotal(split);
  const count = splitCount(split);
  const multi = splits.length > 1;
  const name = tableDisplayName(data.tableList, tableId);

  const qtyByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of split.items) m.set(`${it.name}|${it.price}`, (m.get(`${it.name}|${it.price}`) ?? 0) + it.qty);
    return m;
  }, [split]);

  const q = query.trim().toLowerCase();
  const menu = q
    ? data.menu
        .map((c) => ({ ...c, items: c.items.filter((i) => i.name.toLowerCase().includes(q) || c.cat.toLowerCase().includes(q) || i.aliases?.some((a) => a.toLowerCase().includes(q))) }))
        .filter((c) => c.items.length)
    : data.menu;

  const cashNum = parseFloat(cashInput);
  const hasCash = cashInput !== "" && Number.isFinite(cashNum);
  const change = hasCash ? cashNum - total : 0;

  if (!table) {
    return (
      <div className="screen no-nav">
        <TopBar>
          <BackButton label="Tables" />
        </TopBar>
        <main className="screen-body">
          <div className="empty-state">This table no longer exists.</div>
        </main>
      </div>
    );
  }

  const add = (item: MenuItem) => {
    haptic.tap();
    app.addItem(tableId, item.name, item.price, 1, activeSplit);
  };

  const pay = () => {
    if (payLock.current || !split.items.length) return;
    payLock.current = true;
    setPaying(true);
    setTimeout(() => {
      payLock.current = false;
      setPaying(false);
      const s = useApp.getState();
      const txn = s.markPaid(tableId, activeSplit, hasCash ? cashNum : undefined);
      if (txn) {
        const changeText = hasCash && cashNum >= txn.total ? ` · change ${peso(cashNum - txn.total)}` : "";
        s.showToast({
          text: `${name}${multi ? ` split ${activeSplit + 1}` : ""} paid ${peso(txn.total)}${changeText}`,
          tone: "success",
          action: { label: "Undo", run: () => useApp.getState().restoreTxn(txn.id) },
        });
      }
    }, PAID_FLASH_MS);
  };

  return (
    <div className="screen no-nav">
      <TopBar>
        <BackButton label="Tables" />
        <div className="topbar-actions">
          <button className="pill-btn" onClick={() => app.addSplit(tableId)} aria-label="Add a separate bill">
            <IconSplit /> Split
          </button>
          <div className="chip">
            <b>{name}</b>
          </div>
        </div>
      </TopBar>

      {multi && (
        <div className="split-bar">
          <div className="split-bar-inner" role="tablist" aria-label="Bills">
            {splits.map((sp, i) => (
              <button key={i} role="tab" aria-selected={i === activeSplit} className={`split-chip${i === activeSplit ? " active" : ""}`} onClick={() => app.setActiveSplit(i)}>
                Split {i + 1}
                {sp.items.length > 0 && <span className="amt">{peso(splitTotal(sp))}</span>}
                {sp.items.length === 0 && (
                  <span
                    className="split-x"
                    role="button"
                    aria-label={`Remove split ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      app.removeSplit(tableId, i);
                    }}
                  >
                    <IconX />
                  </span>
                )}
              </button>
            ))}
            <button className="split-chip add" onClick={() => app.addSplit(tableId)}>
              <IconPlus width={14} height={14} /> Split
            </button>
          </div>
        </div>
      )}

      <main className="screen-body order-body">
        <div className="menu-search-wrap">
          <IconSearch />
          <input className="menu-search" type="search" placeholder="Search menu" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search menu" />
        </div>
        {menu.map((cat) => (
          <section key={cat.id}>
            <div className="cat-label">{cat.cat}</div>
            <div className="grid-menu">
              {cat.items.map((it) => (
                <MenuTile key={it.id} item={it} qty={qtyByName.get(`${it.name}|${it.price}`) ?? 0} onAdd={() => add(it)} />
              ))}
            </div>
          </section>
        ))}
        {q && !menu.length && <div className="empty-state">No menu items match “{query}”.</div>}
        <div className="cat-label">Other</div>
        <div className="grid-menu">
          <motion.button whileTap={{ scale: 0.95 }} className="menu-tile custom" onClick={() => app.openDialog({ type: "custom-item", tableId })}>
            <span className="name">+ Custom item</span>
          </motion.button>
        </div>
      </main>

      {createPortal(
        <>
      <AnimatePresence>
        {sheetOpen && (
          <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => app.setSheet(false)} />
        )}
      </AnimatePresence>
      <section className={`sheet${sheetOpen ? " open" : ""}`} aria-label="Bill">
        <button className="sheet-handle" onClick={() => app.setSheet(!sheetOpen)} aria-expanded={sheetOpen} aria-label={sheetOpen ? "Collapse bill" : "Show bill"}>
          <div className="sheet-summary">
            <span className="count">
              {plural(count, "item")} · {multi ? `Split ${activeSplit + 1}` : name}
            </span>
            <motion.span key={total} className="amount" initial={{ scale: total ? 1.14 : 1 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
              {peso(total)}
            </motion.span>
          </div>
        </button>
        <div className="sheet-body">
          {split.items.length === 0 ? (
            <div className="bill-empty">No items yet — tap the menu to add.</div>
          ) : (
            <AnimatePresence initial={false}>
              {split.items.map((it, idx) => (
                <motion.div
                  key={`${it.name}|${it.price}`}
                  className="bill-line"
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <div className="lname">
                    {it.name}
                    <small>{peso(it.price)} each</small>
                  </div>
                  <div className="qty-stepper">
                    <button aria-label={`Remove one ${it.name}`} onClick={() => app.changeQty(tableId, activeSplit, idx, -1)}>
                      <IconMinus />
                    </button>
                    <span className="qty">{it.qty}</span>
                    <button aria-label={`Add one ${it.name}`} onClick={() => app.changeQty(tableId, activeSplit, idx, 1)}>
                      <IconPlus />
                    </button>
                  </div>
                  <div className="lsub">{peso(it.price * it.qty)}</div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
        <div className="sheet-footer">
          <div className="cash-row">
            <label className="cash-input-wrap">
              <span className="cash-currency">₱</span>
              <input
                className="cash-input"
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="Cash received"
                aria-label="Cash received"
                value={cashInput}
                onChange={(e) => app.setCashInput(e.target.value)}
                onFocus={() => app.setSheet(true)}
              />
            </label>
            {hasCash && <span className={`change ${change < 0 ? "short" : "ok"}`}>{change < 0 ? `Short ${peso(-change)}` : `Change ${peso(change)}`}</span>}
          </div>
          {sheetOpen && total > 0 && (
            <div className="quick-cash" aria-label="Quick cash amounts">
              {quickCashOptions(total).map((v) => (
                <button key={v} onClick={() => app.setCashInput(String(v))}>
                  {v === total ? "Exact" : peso(v)}
                </button>
              ))}
            </div>
          )}
          <div className="sheet-actions">
            <button className="btn btn-secondary" disabled={!split.items.length || paying} onClick={() => app.openDialog({ type: "confirm-clear", tableId })}>
              {multi ? "Clear split" : "Clear"}
            </button>
            <motion.button
              className={`btn btn-primary${paying ? " paid" : ""}`}
              disabled={!split.items.length}
              onClick={pay}
              animate={paying ? { scale: [1, 1.05, 1] } : { scale: 1 }}
              transition={{ duration: 0.36 }}
            >
              <IconCheck /> {paying ? "Paid" : `Paid ${peso(total)}`}
            </motion.button>
          </div>
        </div>
      </section>
        </>,
        document.body,
      )}
    </div>
  );
}
