import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useApp, type Dialog } from "../store/appStore";
import { tableDisplayName } from "../lib/bill";
import { businessDayKey, periodLabel } from "../lib/businessDay";
import { peso } from "../lib/format";
import { exportReport } from "../store/exports";
import { IconFile, IconPrinter } from "./Icons";

function Modal({ title, children, labelId = "dlg-title" }: { title: string; children: ReactNode; labelId?: string }) {
  const close = useApp((s) => s.closeDialog);
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ type: "spring", stiffness: 460, damping: 34 }}
      >
        <h3 id={labelId}>{title}</h3>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="modal-actions">{children}</div>;
}

function Cancel({ label = "Cancel" }: { label?: string }) {
  const close = useApp((s) => s.closeDialog);
  return (
    <button type="button" className="btn btn-secondary" onClick={close}>
      {label}
    </button>
  );
}

const parsePrice = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

// ---------- individual dialogs ----------

function ConfirmClear({ tableId }: { tableId: number }) {
  const { clearSplit, activeSplit, data } = useApp.getState();
  const multi = (data.tables[tableId] ?? []).length > 1;
  const name = tableDisplayName(data.tableList, tableId);
  return (
    <Modal title={multi ? `Clear split ${activeSplit + 1}?` : `Clear ${name}?`}>
      <p>{multi ? "This removes all items on this split without recording a sale." : "This removes all items on this table without recording a sale. Use it if the order was a mistake or the customer left."}</p>
      <Actions>
        <Cancel />
        <button className="btn btn-primary" onClick={() => clearSplit(tableId, activeSplit)}>
          Clear
        </button>
      </Actions>
    </Modal>
  );
}

function CustomItem({ tableId }: { tableId: number }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const p = parsePrice(price);
  const ok = name.trim().length > 0 && p !== null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    const s = useApp.getState();
    s.addItem(tableId, name.trim().slice(0, 40), p!, 1, s.activeSplit);
    s.closeDialog();
  };
  return (
    <Modal title="Add custom item">
      <form className="form" onSubmit={submit}>
        <div>
          <label className="field-label" htmlFor="ci-name">Item name</label>
          <input id="ci-name" className="field" autoFocus maxLength={40} placeholder="e.g. Extra sauce" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="ci-price">Price (₱)</label>
          <input id="ci-price" className="field" type="number" inputMode="decimal" min={0} placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <Actions>
          <Cancel />
          <button type="submit" className="btn btn-primary" disabled={!ok}>Add</button>
        </Actions>
      </form>
    </Modal>
  );
}

function AddTable() {
  const [name, setName] = useState("");
  const tableList = useApp((s) => s.data.tableList);
  const clean = name.trim();
  const dup = tableList.some((t) => t.name.toLowerCase() === clean.toLowerCase());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!clean || dup) return;
    useApp.getState().addTable(clean);
  };
  return (
    <Modal title="Add a table">
      <form className="form" onSubmit={submit}>
        <div>
          <label className="field-label" htmlFor="at-name">Name</label>
          <input id="at-name" className="field" autoFocus maxLength={24} placeholder="e.g. 5, Takeout, Grab" value={name} onChange={(e) => setName(e.target.value)} />
          {dup && <div className="field-hint">There’s already a table with that name.</div>}
        </div>
        <Actions>
          <Cancel />
          <button type="submit" className="btn btn-primary" disabled={!clean || dup}>Add</button>
        </Actions>
      </form>
    </Modal>
  );
}

function ConfirmRemoveTable({ tableId, name }: { tableId: number; name: string }) {
  return (
    <Modal title={`Remove “${name}”?`}>
      <p>This removes the table from your board. Past sales stay in your records, and you can add it again anytime.</p>
      <Actions>
        <Cancel />
        <button className="btn btn-primary" onClick={() => useApp.getState().removeTable(tableId)}>Remove</button>
      </Actions>
    </Modal>
  );
}

function CodeConfirm({ title, body, code, action, onConfirm }: { title: string; body: string; code: string; action: string; onConfirm: () => void }) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim().toUpperCase() === code;
  return (
    <Modal title={title}>
      <p>{body}</p>
      <div className="verify-code" aria-label={`Confirmation code ${code.split("").join(" ")}`}>{code}</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onConfirm();
        }}
      >
        <label className="field-label" htmlFor="verify">Type the code above to confirm</label>
        <input id="verify" className="field" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="Code" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Actions>
          <Cancel />
          <button type="submit" className="btn btn-primary" disabled={!ok}>{action}</button>
        </Actions>
      </form>
    </Modal>
  );
}

function PickDate() {
  const { summary, data } = useApp.getState();
  const today = businessDayKey(new Date(), data.settings);
  const [from, setFrom] = useState(summary.from ?? today);
  const [to, setTo] = useState(summary.to ?? today);
  return (
    <Modal title="View a date range">
      <p>Pick the same date twice for a single day, or a range to combine several days.</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to) useApp.getState().setCustomRange(from, to);
        }}
      >
        <div className="row">
          <div>
            <label className="field-label" htmlFor="d-from">From</label>
            <input id="d-from" className="field" type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="d-to">To</label>
            <input id="d-to" className="field" type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <Actions>
          <Cancel />
          <button type="submit" className="btn btn-primary" disabled={!from || !to}>View</button>
        </Actions>
      </form>
    </Modal>
  );
}

function ConfirmRestoreTxn({ txnId, tableId, tableExists }: { txnId: number; tableId: number; tableExists: boolean }) {
  const { data, restoreTxn } = useApp.getState();
  const txn = data.history.find((h) => h.id === txnId);
  if (!tableExists) {
    return (
      <Modal title="Table no longer exists">
        <p>This order was on a custom table that has since been removed, so it can’t be restored automatically.</p>
        <Actions>
          <Cancel label="OK" />
        </Actions>
      </Modal>
    );
  }
  return (
    <Modal title={`Restore to ${tableDisplayName(data.tableList, tableId)}?`}>
      <p>
        This removes the {txn ? peso(txn.total) : ""} sale from your records and puts it back as an open bill on that table.
      </p>
      <Actions>
        <Cancel />
        <button className="btn btn-primary" onClick={() => restoreTxn(txnId)}>Restore</button>
      </Actions>
    </Modal>
  );
}

function ExportMenu() {
  const spec = useApp((s) => s.summary);
  const go = (f: "csv" | "pdf") => {
    useApp.getState().closeDialog();
    // Let the dialog close before the print dialog takes over the page.
    setTimeout(() => exportReport(f, spec), f === "pdf" ? 220 : 0);
  };
  return (
    <Modal title={`Export ${periodLabel(spec)} report`}>
      <p>Choose a format.</p>
      <div className="export-options">
        <button className="export-option" onClick={() => go("csv")}>
          <IconFile />
          <span>
            <div className="eo-title">CSV spreadsheet</div>
            <div className="eo-sub">Opens in Google Sheets or Excel</div>
          </span>
        </button>
        <button className="export-option" onClick={() => go("pdf")}>
          <IconPrinter />
          <span>
            <div className="eo-title">PDF report</div>
            <div className="eo-sub">Printable letterhead report — choose “Save as PDF”</div>
          </span>
        </button>
      </div>
      <Actions>
        <Cancel />
      </Actions>
    </Modal>
  );
}

function CategoryForm({ catId }: { catId: number | null }) {
  const existing = useApp((s) => (catId === null ? null : s.data.menu.find((c) => c.id === catId) ?? null));
  const [name, setName] = useState(existing?.cat ?? "");
  const clean = name.trim();
  return (
    <Modal title={existing ? "Rename category" : "Add a category"}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) useApp.getState().saveCategory(catId, clean);
        }}
      >
        <div>
          <label className="field-label" htmlFor="cat-name">Category name</label>
          <input id="cat-name" className="field" autoFocus maxLength={24} placeholder="e.g. Rice Meals" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Actions>
          <Cancel />
          <button type="submit" className="btn btn-primary" disabled={!clean}>Save</button>
        </Actions>
      </form>
    </Modal>
  );
}

function MenuItemForm({ catId, itemId }: { catId: number; itemId: number | null }) {
  const cat = useApp((s) => s.data.menu.find((c) => c.id === catId));
  const item = itemId === null ? undefined : cat?.items.find((i) => i.id === itemId);
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [aliases, setAliases] = useState((item?.aliases ?? []).join(", "));
  const p = parsePrice(price);
  const ok = name.trim().length > 0 && p !== null;
  if (!cat) return null;
  const { saveMenuItem, deleteMenuItem } = useApp.getState();
  return (
    <Modal title={`${item ? "Edit item" : "Add item"} — ${cat.cat}`}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          saveMenuItem(catId, itemId, { name, price: p!, aliases: aliases.split(",") });
        }}
      >
        <div>
          <label className="field-label" htmlFor="mi-name">Item name</label>
          <input id="mi-name" className="field" autoFocus={!item} maxLength={40} placeholder="e.g. Pares w/ Sisig" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="mi-price">Price (₱)</label>
          <input id="mi-price" className="field" type="number" inputMode="decimal" min={0} placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="mi-alias">Other names (optional)</label>
          <input id="mi-alias" className="field" placeholder="e.g. coke, soda" value={aliases} onChange={(e) => setAliases(e.target.value)} />
          <div className="field-hint">Comma-separated nicknames that help Ask Agent recognise this item.</div>
        </div>
        <Actions>
          {item ? (
            <button type="button" className="btn btn-secondary" onClick={() => deleteMenuItem(catId, item.id)}>Delete</button>
          ) : (
            <Cancel />
          )}
          <button type="submit" className="btn btn-primary" disabled={!ok}>Save</button>
        </Actions>
      </form>
    </Modal>
  );
}

function ConfirmRestoreBackup({ pending }: { pending: Extract<Dialog, { type: "confirm-restore-backup" }>["pending"] }) {
  const open = Object.values(pending.tables).filter((sp) => sp.some((s) => s.items.length)).length;
  return (
    <Modal title="Restore this backup?">
      <p>
        The backup has {pending.history.length} sales, {pending.menu.reduce((n, c) => n + c.items.length, 0)} menu items and {open} open tables. It replaces everything currently on this
        device. This can’t be undone — export a backup of the current data first if you might need it.
      </p>
      <Actions>
        <Cancel />
        <button
          className="btn btn-primary"
          onClick={() => {
            const s = useApp.getState();
            s.replaceData(pending);
            s.showToast({ text: "Backup restored", tone: "success" });
          }}
        >
          Restore
        </button>
      </Actions>
    </Modal>
  );
}

function ImportError() {
  return (
    <Modal title="Couldn’t read that file">
      <p>This doesn’t look like an Order Board backup. Choose a file made with “Export all data”.</p>
      <Actions>
        <Cancel label="OK" />
      </Actions>
    </Modal>
  );
}

function renderDialog(d: Dialog) {
  const s = useApp.getState();
  switch (d.type) {
    case "confirm-clear": return <ConfirmClear tableId={d.tableId} />;
    case "custom-item": return <CustomItem tableId={d.tableId} />;
    case "add-table": return <AddTable />;
    case "confirm-remove-table": return <ConfirmRemoveTable tableId={d.tableId} name={d.name} />;
    case "confirm-reset":
      return (
        <CodeConfirm
          title="Reset today’s sales?"
          body="This permanently deletes today’s recorded sales. Export today’s report first if you want to keep a record — this can’t be undone."
          code={d.code}
          action="Reset"
          onConfirm={() => s.resetToday()}
        />
      );
    case "pick-date": return <PickDate />;
    case "confirm-restore-txn": return <ConfirmRestoreTxn txnId={d.txnId} tableId={d.tableId} tableExists={d.tableExists} />;
    case "confirm-delete-txn":
      return (
        <CodeConfirm
          title="Delete this order?"
          body="This permanently removes it from your sales records — it will NOT be put back on any table. This can’t be undone."
          code={d.code}
          action="Delete"
          onConfirm={() => s.deleteTxn(d.txnId)}
        />
      );
    case "export-menu": return <ExportMenu />;
    case "category-form": return <CategoryForm catId={d.catId} />;
    case "menu-item-form": return <MenuItemForm catId={d.catId} itemId={d.itemId} />;
    case "confirm-restore-backup": return <ConfirmRestoreBackup pending={d.pending} />;
    case "import-error": return <ImportError />;
  }
}

/** Key that changes whenever a different dialog opens, so its form state resets. */
function dialogKey(d: Dialog): string {
  return JSON.stringify(d, (k, v) => (k === "pending" ? undefined : v));
}

export function DialogHost() {
  const dialog = useApp((s) => s.dialog);
  return <AnimatePresence>{dialog && <div key={dialogKey(dialog)}>{renderDialog(dialog)}</div>}</AnimatePresence>;
}
