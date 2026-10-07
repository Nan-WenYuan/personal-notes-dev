import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
interface DragNote {
  id: string;
  title: string;
  x: number;
  y: number;
}
export function useNoteCategoryDrag(
  onMove: (id: string, category: string, position?: { x: number; y: number }) => void,
  onTarget: (category: string | null, position?: { x: number; y: number }) => void,
) {
  const latest = useRef({ onMove, onTarget });
  latest.current = { onMove, onTarget };
  const pending = useRef<(DragNote & { pointerId: number; active: boolean }) | null>(null);
  const ignoreClick = useRef(false);
  const [dragging, setDragging] = useState<DragNote | null>(null);
  useEffect(() => {
    const targetAt = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-note-drop-category]")?.dataset
        .noteDropCategory ?? null;
    const move = (event: PointerEvent) => {
      const drag = pending.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.active = true;
      event.preventDefault();
      setDragging({ id: drag.id, title: drag.title, x: event.clientX, y: event.clientY });
      latest.current.onTarget(targetAt(event.clientX, event.clientY), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    const finish = (event: PointerEvent) => {
      const drag = pending.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      pending.current = null;
      setDragging(null);
      latest.current.onTarget(null);
      if (drag.active) {
        ignoreClick.current = true;
        setTimeout(() => {
          ignoreClick.current = false;
        }, 0);
        const category = targetAt(event.clientX, event.clientY);
        if (event.type === "pointerup" && category !== null)
          latest.current.onMove(drag.id, category, { x: event.clientX, y: event.clientY });
      }
    };
    const cancel = () => {
      pending.current = null;
      setDragging(null);
      latest.current.onTarget(null);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  return {
    dragging,
    beginDrag: (event: ReactPointerEvent<HTMLElement>, id: string, title: string) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      ignoreClick.current = false;
      pending.current = {
        id,
        title,
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        active: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    consumeDragClick: () => {
      const ignored = ignoreClick.current;
      ignoreClick.current = false;
      return ignored;
    },
  };
}
