import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { moveQuadrantTask } from "../features/pomodoro/moveQuadrantTask";

type Item = { id: string; quadrant: number; completed: boolean };
type Drag = {
  id: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  quadrant: number | null;
  before: string | null;
  moved: boolean;
  clone: HTMLElement;
  color: string;
};

export function useQuadrantDrag<T extends Item>(tasks: T[], save: (tasks: T[]) => void) {
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const live = useRef<Drag | null>(null);
  const latest = useRef({ tasks, save });
  latest.current = { tasks, save };
  const [view, setView] = useState<Drag | null>(null);
  const settling = useRef(false);
  const mounted = useRef(true);
  function clear() {
    live.current = null;
    setView(null);
  }
  useEffect(() => {
    mounted.current = true;
    const cancel = () => {
      if (!settling.current) clear();
    };
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
    if (view && ghostRef.current) ghostRef.current.replaceChildren(view.clone);
  }, [view?.id]);
  const positions = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    boardRef.current?.querySelectorAll<HTMLElement>("[data-quadrant-task]").forEach((row) => {
      row.getAnimations().forEach((a) => a.cancel());
      const rect = row.getBoundingClientRect(),
        id = row.dataset.quadrantTask!;
      const old = positions.current.get(id);
      next.set(id, rect);
      if (old && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const x = old.left - rect.left,
          y = old.top - rect.top;
        if (x || y)
          row.animate([{ transform: `translate(${x}px,${y}px)` }, { transform: "none" }], {
            duration: 160,
            easing: "ease-out",
          });
      }
    });
    positions.current = next;
  }, [view?.id, view?.quadrant, view?.before, tasks]);
  function start(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (e.button !== 0 || settling.current) return;
    const row = e.currentTarget.closest<HTMLElement>("[data-quadrant-task]");
    if (!row || !boardRef.current) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const clone = row.cloneNode(true) as HTMLElement;
    clone.removeAttribute("data-quadrant-task");
    clone.inert = true;
    const color = getComputedStyle(row).getPropertyValue("--quadrant-color");
    live.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      x: rect.left,
      y: rect.top,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      quadrant: Number(row.closest<HTMLElement>("[data-quadrant]")!.dataset.quadrant),
      before: null,
      moved: false,
      clone,
      color,
    };
    boardRef.current.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const d = live.current;
    if (
      !d ||
      settling.current ||
      (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6)
    )
      return;
    e.preventDefault();
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const column = hit?.closest<HTMLElement>("[data-quadrant]");
    let quadrant: number | null = null,
      before: string | null = null;
    if (column && boardRef.current?.contains(column)) {
      quadrant = Number(column.dataset.quadrant);
      const scroller = column.querySelector<HTMLElement>(".quadrant-tasks");
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (e.clientY < r.top + 24) scroller.scrollTop -= 12;
        else if (e.clientY > r.bottom - 24) scroller.scrollTop += 12;
      }
      if (hit?.closest("[data-quadrant-placeholder]") && quadrant === d.quadrant) before = d.before;
      else
        before =
          [...column.querySelectorAll<HTMLElement>("[data-quadrant-task]")].find((row) => {
            const r = row.getBoundingClientRect();
            return row.dataset.quadrantTask !== d.id && e.clientY < r.top + r.height / 2;
          })?.dataset.quadrantTask ?? null;
    }
    const next = {
      ...d,
      moved: true,
      x: e.clientX - d.offsetX,
      y: e.clientY - d.offsetY,
      quadrant,
      before,
    };
    live.current = next;
    setView(next);
  }
  async function finish() {
    if (settling.current) return;
    const d = live.current;
    if (!d?.moved) {
      clear();
      return;
    }
    settling.current = true;
    const destination = boardRef.current
      ?.querySelector<HTMLElement>("[data-quadrant-placeholder]")
      ?.getBoundingClientRect();
    try {
      if (
        ghostRef.current &&
        destination &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        await ghostRef.current
          .animate(
            [
              { transform: `translate3d(${d.x}px,${d.y}px,0)` },
              { transform: `translate3d(${destination.left}px,${destination.top}px,0)` },
            ],
            { duration: 140, easing: "ease-out", fill: "forwards" },
          )
          .finished.catch(() => {});
      }
      if (mounted.current && d.quadrant !== null) {
        const next = moveQuadrantTask(latest.current.tasks, d.id, d.quadrant, d.before);
        if (next !== latest.current.tasks) latest.current.save(next);
      }
    } finally {
      settling.current = false;
      if (mounted.current) clear();
    }
  }
  return {
    boardRef,
    start,
    move,
    finish,
    cancel: () => {
      if (!settling.current) clear();
    },
    view,
    preview:
      view?.quadrant != null ? moveQuadrantTask(tasks, view.id, view.quadrant, view.before) : tasks,
    overlay: view
      ? createPortal(
          <div
            ref={ghostRef}
            aria-hidden="true"
            className="quadrant-tasks quadrant-drag-overlay"
            style={
              {
                width: view.width,
                minHeight: view.height,
                transform: `translate3d(${view.x}px,${view.y}px,0)`,
                "--quadrant-color": view.color,
              } as CSSProperties
            }
          />,
          document.body,
        )
      : null,
  };
}
