import { Reorder, useDragControls } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../store/appStore";
import type { MenuCategory, MenuItem } from "../data/types";
import { peso } from "../lib/format";
import { isSoldOut } from "../lib/money";
import { TopBar } from "../ui/components";
import { IconGrip, IconPencil, IconPlus, IconTrash } from "../ui/Icons";

/**
 * Local copy of an id order that follows the store, but can be rearranged
 * freely while dragging and is committed once on drop.
 */
function useLocalOrder(ids: number[]) {
  const key = ids.join(",");
  const [order, setOrder] = useState(ids);
  const ref = useRef(order);
  useEffect(() => {
    setOrder(ids);
    ref.current = ids;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: number[]) => {
    ref.current = next;
    setOrder(next);
  };
  return [order, set, ref] as const;
}

const lift = { scale: 1.02, boxShadow: "0 12px 28px rgba(0,0,0,0.3)", zIndex: 5 };

function ItemRow({ cat, item, onDrop }: { cat: MenuCategory; item: MenuItem; onDrop: () => void }) {
  const controls = useDragControls();
  const { openDialog, setSoldOut } = useApp.getState();
  const out = useApp((s) => isSoldOut(item, s.data.settings));
  return (
    <Reorder.Item as="li" value={item.id} dragListener={false} dragControls={controls} className="mitem" onDragEnd={onDrop} whileDrag={lift}>
      <button className="drag-handle" aria-label={`Drag to reorder ${item.name}`} onPointerDown={(e) => controls.start(e)}>
        <IconGrip />
      </button>
      <button className="mitem-main" onClick={() => openDialog({ type: "menu-item-form", catId: cat.id, itemId: item.id })} aria-label={`Edit ${item.name}`}>
        <span className="mitem-name">
          {item.name}
          {item.aliases?.length ? <small>Also: {item.aliases.join(", ")}</small> : null}
        </span>
        <span className="mitem-price">{peso(item.price)}</span>
      </button>
      <button
        className={`soldout-toggle${out ? " on" : ""}`}
        aria-pressed={out}
        aria-label={out ? `${item.name} is sold out — mark available` : `Mark ${item.name} sold out`}
        onClick={() => setSoldOut(cat.id, item.id, !out)}
      >
        {out ? "Sold out" : "In stock"}
      </button>
    </Reorder.Item>
  );
}

function CategoryCard({ cat, onDrop }: { cat: MenuCategory; onDrop: () => void }) {
  const controls = useDragControls();
  const { openDialog, deleteCategory, moveMenuItem } = useApp.getState();
  const [order, setOrder, ref] = useLocalOrder(cat.items.map((i) => i.id));
  const byId = new Map(cat.items.map((i) => [i.id, i]));

  const commitItem = (id: number) => () => {
    const from = useApp.getState().data.menu.find((c) => c.id === cat.id)?.items.findIndex((i) => i.id === id) ?? -1;
    const to = ref.current.indexOf(id);
    if (from >= 0 && to >= 0 && from !== to) moveMenuItem(cat.id, from, to);
  };

  return (
    <Reorder.Item as="li" value={cat.id} dragListener={false} dragControls={controls} className="mcat" onDragEnd={onDrop} whileDrag={lift}>
      <div className="mcat-head">
        <button className="drag-handle" aria-label={`Drag to reorder ${cat.cat}`} onPointerDown={(e) => controls.start(e)}>
          <IconGrip />
        </button>
        <button className="mcat-title" onClick={() => openDialog({ type: "category-form", catId: cat.id })} aria-label={`Rename ${cat.cat}`}>
          {cat.cat} <span className="mcat-count">{cat.items.length}</span> <IconPencil />
        </button>
        {cat.items.length === 0 && (
          <button className="icon-btn" aria-label={`Delete category ${cat.cat}`} onClick={() => deleteCategory(cat.id)}>
            <IconTrash />
          </button>
        )}
      </div>
      <Reorder.Group as="ul" axis="y" values={order} onReorder={setOrder} className="mitems">
        {order.map((id) => {
          const item = byId.get(id);
          return item ? <ItemRow key={id} cat={cat} item={item} onDrop={commitItem(id)} /> : null;
        })}
      </Reorder.Group>
      <button className="madd" onClick={() => openDialog({ type: "menu-item-form", catId: cat.id, itemId: null })}>
        <IconPlus /> Add item to {cat.cat}
      </button>
    </Reorder.Item>
  );
}

export function MenuEditorScreen() {
  const menu = useApp((s) => s.data.menu);
  const { openDialog, moveCategory } = useApp.getState();
  const [order, setOrder, ref] = useLocalOrder(menu.map((c) => c.id));
  const byId = new Map(menu.map((c) => [c.id, c]));

  const commitCat = (id: number) => () => {
    const from = useApp.getState().data.menu.findIndex((c) => c.id === id);
    const to = ref.current.indexOf(id);
    if (from >= 0 && to >= 0 && from !== to) moveCategory(from, to);
  };

  return (
    <div className="screen">
      <TopBar
        back="Settings"
        title="Menu"
        actions={
          <button className="icon-btn" aria-label="Add category" onClick={() => openDialog({ type: "category-form", catId: null })}>
            <IconPlus />
          </button>
        }
      />
      <main className="screen-body">
        <p className="intro">Tap an item to change its name, price or nicknames. Drag ⋮⋮ to reorder. “Sold out” lasts until the next business day — you can also long-press an item on the order screen.</p>
        <Reorder.Group as="ul" axis="y" values={order} onReorder={setOrder} className="reorder-list">
          {order.map((id) => {
            const cat = byId.get(id);
            return cat ? <CategoryCard key={id} cat={cat} onDrop={commitCat(id)} /> : null;
          })}
        </Reorder.Group>
        <button className="btn btn-secondary btn-full" onClick={() => openDialog({ type: "category-form", catId: null })}>
          <IconPlus /> Add category
        </button>
      </main>
    </div>
  );
}
