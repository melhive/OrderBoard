import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../store/appStore";
import type { MenuItem, MoneyMethod } from "../data/types";
import { fmtElapsed, splitCount, splitTotal, tableDisplayName, tableOpenedAt, tableTotal, unservedCount } from "../lib/bill";
import { peso, plural } from "../lib/format";
import { isSoldOut, utangAccounts } from "../lib/money";
import { haptic } from "../platform/haptics";
import { Segmented, TopBar } from "../ui/components";
import { useMinuteTick } from "../ui/hooks";
import { IconCheck, IconChevron, IconMinus, IconPencil, IconPlus, IconSearch, IconSparkle, IconSplit, IconX } from "../ui/Icons";

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

function MenuTile({ item, qty, soldOut, onAdd, onToggleSoldOut }: { item: MenuItem; qty: number; soldOut: boolean; onAdd: () => void; onToggleSoldOut: () => void }) {
  const [pulse, setPulse] = useState(0);
  return (
    <button
      className={`mtile${qty ? " has-qty" : ""}${soldOut ? " sold-out" : ""}`}
      onClick={() => {
        if (!soldOut) setPulse((p) => p + 1);
        onAdd();
      }}
      // Long-press (Android fires contextmenu) toggles sold out.
      onContextMenu={(e) => {
        e.preventDefault();
        onToggleSoldOut();
      }}
      aria-label={`Add ${item.name}, ${peso(item.price)}${soldOut ? ", sold out" : ""}${qty ? `, ${qty} on bill` : ""}`}
    >
      {pulse > 0 && <motion.span key={pulse} className="flash" aria-hidden initial={{ opacity: 0.32 }} animate={{ opacity: 0 }} transition={{ duration: 0.35, ease: "easeOut" }} />}
      <span className="name">{item.name}</span>
      <span className="price">{soldOut ? <span className="soldout-tag">Sold out</span> : peso(item.price)}</span>
      <AnimatePresence>
        {qty > 0 && (
          <motion.span key="b" className="qty-badge" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: "spring", stiffness: 700, damping: 30 }}>
            {qty}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

const METHODS: { value: MoneyMethod | "utang"; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "maya", label: "Maya" },
  { value: "utang", label: "Utang" },
];

export function OrderScreen({ tableId }: { tableId: number }) {
  useMinuteTick();
  const data = useApp((s) => s.data);
  const activeSplitRaw = useApp((s) => s.activeSplit);
  const sheetOpen = useApp((s) => s.sheetOpen);
  const cashInput = useApp((s) => s.cashInput);
  const payMethod = useApp((s) => s.payMethod);
  const utangName = useApp((s) => s.utangName);
  const app = useApp.getState();
  const [query, setQuery] = useState("");
  const [paying, setPaying] = useState(false);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const payLock = useRef(false);
  const subbarRef = useRef<HTMLDivElement>(null);

  const table = data.tableList.find((t) => t.id === tableId);
  const splits = data.tables[tableId]?.length ? data.tables[tableId]! : [{ items: [] }];
  const activeSplit = Math.min(activeSplitRaw, splits.length - 1);
  const split = splits[activeSplit]!;
  const total = splitTotal(split);
  const count = splitCount(split);
  const multi = splits.length > 1;
  const name = tableDisplayName(data.tableList, tableId);

  const qtyByKey = useMemo(() => {
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

  // Highlight the category chip for the section currently under the sticky bars.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const limit = (subbarRef.current?.getBoundingClientRect().bottom ?? 120) + 12;
        let current: number | null = null;
        for (const el of document.querySelectorAll<HTMLElement>("[data-cat-section]")) {
          if (el.getBoundingClientRect().top <= limit) current = Number(el.dataset.catSection);
        }
        setActiveCat(current);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [q]);

  const cashNum = parseFloat(cashInput);
  const hasCash = payMethod === "cash" && cashInput !== "" && Number.isFinite(cashNum);
  const unserved = unservedCount(split);
  const openedAt = tableOpenedAt(data.tables[tableId]);
  const customers = useMemo(() => utangAccounts(data.history).map((a) => a.name), [data.history]);
  const canPay = split.items.length > 0 && (payMethod !== "utang" || utangName.trim().length > 0);
  const change = hasCash ? cashNum - total : 0;

  if (!table) {
    return (
      <div className="screen">
        <TopBar back="Tables" title="Table not found" />
        <main className="screen-body">
          <div className="empty-state">This table no longer exists.</div>
        </main>
      </div>
    );
  }

  const add = (item: MenuItem) => {
    if (isSoldOut(item, data.settings)) {
      haptic.warning();
      app.showToast({
        text: `${item.name} is marked sold out`,
        tone: "danger",
        action: { label: "Add anyway", run: () => useApp.getState().addItem(tableId, item.name, item.price, 1, useApp.getState().activeSplit) },
      });
      return;
    }
    haptic.tap();
    app.addItem(tableId, item.name, item.price, 1, activeSplit);
  };

  const toggleSoldOut = (item: MenuItem, catId: number) => {
    const out = isSoldOut(item, data.settings);
    haptic.tap();
    app.setSoldOut(catId, item.id, !out);
    app.showToast({
      text: out ? `${item.name} is available again` : `${item.name} marked sold out for today`,
      action: { label: "Undo", run: () => useApp.getState().setSoldOut(catId, item.id, out) },
    });
  };

  const pay = () => {
    if (payLock.current || !canPay) return;
    payLock.current = true;
    setPaying(true);
    setTimeout(() => {
      payLock.current = false;
      setPaying(false);
      const s = useApp.getState();
      const method = s.payMethod;
      const txn = s.markPaid(tableId, activeSplit, hasCash ? cashNum : undefined, { method, customer: s.utangName });
      if (txn) {
        const changeText = hasCash && cashNum >= txn.total ? ` · change ${peso(cashNum - txn.total)}` : "";
        const how = method === "utang" ? ` charged to ${txn.customer}’s utang` : method === "gcash" ? " paid via GCash" : method === "maya" ? " paid via Maya" : " paid";
        s.showToast({
          text: `${name}${multi ? ` split ${activeSplit + 1}` : ""}${how} ${peso(txn.total)}${changeText}`,
          tone: "success",
          action: { label: "Undo", run: () => useApp.getState().restoreTxn(txn.id) },
        });
      }
    }, PAID_FLASH_MS);
  };

  const jumpTo = (catId: number) => {
    document.getElementById(`cat-${catId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const tableSum = tableTotal(data.tables[tableId]);
  const opened = openedAt ? ` · ${fmtElapsed(openedAt)}` : "";
  const sub = multi ? `${splits.length} bills · ${peso(tableSum)} total${opened}` : count ? `${plural(count, "item")} · ${peso(total)}${opened}` : "New order";

  return (
    <div className="screen">
      <TopBar
        back="Tables"
        title={name}
        sub={sub}
        actions={
          <>
            <button className="icon-btn" onClick={() => app.addSplit(tableId)} aria-label="Add a separate bill">
              <IconSplit />
            </button>
            <button className="icon-btn accent" onClick={() => app.openAsk()} aria-label="Ask Agent about this table">
              <IconSparkle />
            </button>
          </>
        }
      />

      <div className="subbar" ref={subbarRef}>
        <div className="subbar-inner">
          {multi && (
            <div className="chips split-tabs" role="tablist" aria-label="Bills">
              {splits.map((sp, i) => (
                <button key={i} role="tab" aria-selected={i === activeSplit} className={`chip${i === activeSplit ? " active" : ""}`} onClick={() => app.setActiveSplit(i)}>
                  Bill {i + 1}
                  {sp.items.length > 0 && <span className="amt">{peso(splitTotal(sp))}</span>}
                  {sp.items.length === 0 && (
                    <span
                      className="chip-x"
                      role="button"
                      aria-label={`Remove bill ${i + 1}`}
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
              <button className="chip outline" onClick={() => app.addSplit(tableId)}>
                <IconPlus /> Bill
              </button>
            </div>
          )}
          {!q && (
            <div className="chips" aria-label="Menu categories">
              {data.menu.map((c) => (
                <button key={c.id} className={`chip${activeCat === c.id ? " active" : ""}`} onClick={() => jumpTo(c.id)}>
                  {c.cat}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <main className="screen-body with-cart">
        <div className="order-tools">
          <label className="search">
            <IconSearch />
            <input type="search" placeholder="Search menu" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search menu" enterKeyHint="search" />
          </label>
          <button className="custom-btn" onClick={() => app.openDialog({ type: "custom-item", tableId })} aria-label="Add custom item">
            <IconPlus /> Custom
          </button>
        </div>
        {menu.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`} data-cat-section={cat.id} className="menu-section">
            <h2>{cat.cat}</h2>
            <div className="grid-menu">
              {cat.items.map((it) => (
                <MenuTile
                  key={it.id}
                  item={it}
                  qty={qtyByKey.get(`${it.name}|${it.price}`) ?? 0}
                  soldOut={isSoldOut(it, data.settings)}
                  onAdd={() => add(it)}
                  onToggleSoldOut={() => toggleSoldOut(it, cat.id)}
                />
              ))}
            </div>
          </section>
        ))}
        {q && !menu.length && (
          <div className="empty-state">
            No menu items match “{query}”.
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-secondary btn-small" onClick={() => app.openDialog({ type: "custom-item", tableId })}>
                <IconPlus /> Add “{query.trim()}” as custom item
              </button>
            </div>
          </div>
        )}
      </main>

      {createPortal(
        <>
          <AnimatePresence>
            {sheetOpen && <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={() => app.setSheet(false)} />}
          </AnimatePresence>
          <motion.section className={`sheet${sheetOpen ? " open" : ""}`} aria-label="Bill" initial={{ y: "100%" }} animate={{ y: 0 }} transition={{ type: "spring", stiffness: 420, damping: 40 }}>
            {sheetOpen && <span className="grip" aria-hidden />}
            <div className="cart-bar" onClick={() => app.setSheet(!sheetOpen)} role="presentation">
              <div className="cart-info">
                <div className="t">
                  {plural(count, "item")} · {multi ? `Bill ${activeSplit + 1}` : name}
                </div>
                <motion.span key={total} className="amt" initial={{ scale: total ? 1.12 : 1 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 20 }}>
                  {peso(total)}
                </motion.span>
              </div>
              <button
                className="cart-toggle"
                aria-expanded={sheetOpen}
                aria-label={sheetOpen ? "Hide bill" : "View bill"}
                onClick={(e) => {
                  e.stopPropagation();
                  app.setSheet(!sheetOpen);
                }}
              >
                {sheetOpen ? "Hide" : "View bill"} <IconChevron style={{ transform: "rotate(-90deg)" }} />
              </button>
            </div>
            <AnimatePresence initial={false}>
              {sheetOpen && (
                <motion.div
                  key="detail"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 42 }}
                  style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", maxHeight: "calc(88dvh - 80px)" }}
                >
                  <div className="sheet-body">
                    {unserved > 0 && split.items.length > 0 && (
                      <div className="serve-bar">
                        <span>
                          <b>{unserved}</b> not served yet{openedAt ? ` · open ${fmtElapsed(openedAt)}` : ""}
                        </span>
                        <button className="btn btn-secondary btn-small" onClick={() => app.serveAll(tableId, activeSplit)}>
                          <IconCheck /> All served
                        </button>
                      </div>
                    )}
                    {split.items.length === 0 ? (
                      <div className="bill-empty">No items yet — tap the menu to add.</div>
                    ) : (
                      split.items.map((it, idx) => {
                        const done = (it.served ?? 0) >= it.qty;
                        const part = !done && (it.served ?? 0) > 0;
                        return (
                        <div key={`${it.name}|${it.price}|${it.note ?? ""}`} className={`bill-line${done ? " served" : ""}`}>
                          <button
                            className={`serve-btn${done ? " on" : part ? " part" : ""}`}
                            aria-label={done ? `${it.name} served — tap to undo` : `Mark ${it.name} served`}
                            aria-pressed={done}
                            onClick={() => {
                              haptic.tap();
                              app.setServed(tableId, activeSplit, idx, !done);
                            }}
                          >
                            <IconCheck />
                          </button>
                          <button className="lname" onClick={() => app.openDialog({ type: "item-note", tableId, split: activeSplit, itemIdx: idx })} aria-label={`Note for ${it.name}`}>
                            {it.name}
                            {it.note ? (
                              <small className="lnote">
                                <IconPencil /> {it.note}
                              </small>
                            ) : (
                              <small>
                                {peso(it.price)} each{part ? ` · ${it.served} of ${it.qty} served` : ""}
                              </small>
                            )}
                          </button>
                          <div className="stepper">
                            <button aria-label={`Remove one ${it.name}`} onClick={() => app.changeQty(tableId, activeSplit, idx, -1)}>
                              <IconMinus />
                            </button>
                            <span className="qty">{it.qty}</span>
                            <button aria-label={`Add one ${it.name}`} onClick={() => app.changeQty(tableId, activeSplit, idx, 1)}>
                              <IconPlus />
                            </button>
                          </div>
                          <div className="lsub">{peso(it.price * it.qty)}</div>
                        </div>
                        );
                      })
                    )}
                  </div>
                  <div className="sheet-footer">
                    <div className="total-row">
                      <span className="l">Total</span>
                      <span className="v">{peso(total)}</span>
                    </div>
                    <Segmented id="pay-method" value={payMethod} onChange={(m) => app.setPayMethod(m)} options={METHODS} />
                    {payMethod === "cash" && (
                    <div className="cash-row">
                      <label className="cash-field">
                        <span>₱</span>
                        <input type="number" inputMode="decimal" min={0} placeholder="Cash received" aria-label="Cash received" value={cashInput} onChange={(e) => app.setCashInput(e.target.value)} />
                      </label>
                      {hasCash && (
                        <div className={`change ${change < 0 ? "short" : "ok"}`}>
                          <small>{change < 0 ? "Short" : "Change"}</small>
                          {peso(Math.abs(change))}
                        </div>
                      )}
                    </div>
                    )}
                    {(payMethod === "gcash" || payMethod === "maya") && (
                      <div className="pay-hint">Check the {payMethod === "gcash" ? "GCash" : "Maya"} payment on the customer’s phone before tapping Paid.</div>
                    )}
                    {payMethod === "utang" && (
                      <div className="utang-field">
                        <input
                          className="field"
                          list="utang-names"
                          maxLength={40}
                          placeholder="Who will pay later? e.g. Kuya Ben"
                          aria-label="Customer name"
                          value={utangName}
                          onChange={(e) => app.setUtangName(e.target.value)}
                        />
                        <datalist id="utang-names">
                          {customers.map((c) => (
                            <option key={c} value={c} />
                          ))}
                        </datalist>
                        {customers.length > 0 && (
                          <div className="chips">
                            {customers.slice(0, 6).map((c) => (
                              <button key={c} className={`chip${utangName === c ? " active" : ""}`} onClick={() => app.setUtangName(c)}>
                                {c}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {total > 0 && payMethod === "cash" && (
                      <div className="chips quick-cash" aria-label="Quick cash amounts">
                        {quickCashOptions(total).map((v) => (
                          <button key={v} className={`chip${cashInput === String(v) ? " active" : ""}`} onClick={() => app.setCashInput(String(v))}>
                            {v === total ? "Exact" : peso(v)}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="sheet-actions">
                      <button className="btn btn-secondary" disabled={!split.items.length || paying} onClick={() => app.openDialog({ type: "confirm-clear", tableId })}>
                        Clear
                      </button>
                      <motion.button className={`btn btn-primary${paying ? " paid" : ""}`} disabled={!canPay} onClick={pay} animate={paying ? { scale: [1, 1.04, 1] } : { scale: 1 }} transition={{ duration: 0.34 }}>
                        <IconCheck />{" "}
                        {paying ? (payMethod === "utang" ? "Saved" : "Paid") : payMethod === "utang" ? `Utang ${peso(total)}` : payMethod === "cash" ? `Paid ${peso(total)}` : `Paid ${payMethod === "gcash" ? "GCash" : "Maya"} ${peso(total)}`}
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        </>,
        document.body,
      )}
    </div>
  );
}
