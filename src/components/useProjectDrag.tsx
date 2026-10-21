import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

type Item = { id: string };
type Drag = {
  id: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  widths: number[];
  before: string | null;
  valid: boolean;
  moved: boolean;
  clone: HTMLElement;
};

function move<T extends Item>(items: T[], id: string, before: string | null) {
  const item = items.find((item) => item.id === id);
  if (!item || before === id) return items;
  const rest = items.filter((item) => item.id !== id);
  const index = before === null ? rest.length : rest.findIndex((item) => item.id === before);
  if (index < 0) return items;
  rest.splice(index, 0, item);
  return rest;
}

export function useProjectDrag<T extends Item>(items: T[], save: (ids: string[]) => Promise<void>) {
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const cloneRef = useRef<HTMLTableSectionElement>(null);
  const live = useRef<Drag | null>(null);
  const latest = useRef({ items, save });
  latest.current = { items, save };
  const [view, setView] = useState<Drag | null>(null);
  const settling = useRef(false);
  const mounted = useRef(true);
  function cancel() {
    if (settling.current) return;
    live.current = null;
    setView(null);
  }
  useEffect(() => {
    mounted.current = true;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      mounted.current = false;
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  useLayoutEffect(() => {
    if (view) cloneRef.current?.replaceChildren(view.clone);
  }, [view?.id]);
  const positions = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    boardRef.current?.querySelectorAll<HTMLElement>("[data-project-row]").forEach((row) => {
      row.getAnimations().forEach((animation) => animation.cancel());
      const rect = row.getBoundingClientRect();
      const id = row.dataset.projectRow!;
      const previous = positions.current.get(id);
      next.set(id, rect);
      if (previous && view && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const y = previous.top - rect.top;
        if (y)
          row.animate([{ transform: `translateY(${y}px)` }, { transform: "none" }], {
            duration: 140,
            easing: "ease-out",
          });
      }
    });
    positions.current = next;
  }, [view?.id, view?.before, view?.valid, items.map((item) => item.id).join(",")]);
  function start(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (e.button !== 0 || settling.current) return;
    const row = e.currentTarget.closest<HTMLTableRowElement>("[data-project-row]");
    if (!row || !boardRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = row.getBoundingClientRect();
    const clone = row.cloneNode(true) as HTMLElement;
    clone.removeAttribute("data-project-row");
    clone.inert = true;
    live.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      widths: [...row.cells].map((cell) => cell.getBoundingClientRect().width),
      before: null,
      valid: false,
      moved: false,
      clone,
    };
    boardRef.current.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = live.current;
    if (
      !drag ||
      settling.current ||
      (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6)
    )
      return;
    e.preventDefault();
    const board = boardRef.current!;
    const bounds = board.getBoundingClientRect();
    const valid =
      e.clientX >= bounds.left &&
      e.clientX <= bounds.right &&
      e.clientY >= bounds.top &&
      e.clientY <= bounds.bottom;
    if (valid) {
      if (e.clientY < bounds.top + 28) board.scrollTop -= 14;
      else if (e.clientY > bounds.bottom - 28) board.scrollTop += 14;
    }
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const before =
      hit?.closest("[data-project-placeholder]") && drag.valid
        ? drag.before
        : ([...board.querySelectorAll<HTMLElement>("[data-project-row]")].find((row) => {
            const rect = row.getBoundingClientRect();
            return row.dataset.projectRow !== drag.id && e.clientY < rect.top + rect.height / 2;
          })?.dataset.projectRow ?? null);
    const next = {
      ...drag,
      moved: true,
      valid,
      before,
      x: e.clientX - drag.offsetX,
      y: e.clientY - drag.offsetY,
    };
    live.current = next;
    setView(next);
  }
  async function finish() {
    if (settling.current) return;
    const drag = live.current;
    if (!drag?.moved) {
      cancel();
      return;
    }
    settling.current = true;
    try {
      const destination = boardRef.current
        ?.querySelector("[data-project-placeholder]")
        ?.getBoundingClientRect();
      if (
        destination &&
        ghostRef.current &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        await ghostRef.current
          .animate(
            [
              { transform: `translate3d(${drag.x}px,${drag.y}px,0)` },
              { transform: `translate3d(${destination.left}px,${destination.top}px,0)` },
            ],
            { duration: 140, easing: "ease-out", fill: "forwards" },
          )
          .finished.catch(() => {});
      }
      if (mounted.current && drag.valid) {
        const { items, save } = latest.current;
        const next = move(items, drag.id, drag.before);
        if (next.some((item, index) => item.id !== items[index]?.id)) {
          await save(next.map((item) => item.id));
        }
      }
    } finally {
      settling.current = false;
      live.current = null;
      if (mounted.current) setView(null);
    }
  }
  return {
    boardRef,
    start,
    move: pointerMove,
    finish,
    cancel,
    view,
    preview: view?.valid ? move(items, view.id, view.before) : items,
    overlay: view
      ? createPortal(
          <div
            ref={ghostRef}
            aria-hidden="true"
            className="project-list project-drag-overlay"
            style={{
              width: view.width,
              height: view.height,
              transform: `translate3d(${view.x}px,${view.y}px,0)`,
            }}
          >
            <table>
              <colgroup>
                {view.widths.map((width, i) => (
                  <col key={i} style={{ width }} />
                ))}
              </colgroup>
              <tbody ref={cloneRef} />
            </table>
          </div>,
          document.body,
        )
      : null,
  };
}
