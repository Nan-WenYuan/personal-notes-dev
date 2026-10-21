import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, ClipboardPaste, Check, type LucideIcon } from "lucide-react";
import "./imageTools.css";

export interface NoteMenuState {
  x: number;
  y: number;
  image?: { width?: number };
}
export interface NoteMenuAction {
  label: string;
  icon: LucideIcon;
  run(): void;
  danger?: boolean;
}
export function NoteContextMenu({
  state,
  onClose,
  onCopy,
  onPaste,
  onResize,
  actions = [],
}: {
  state: NoteMenuState;
  onClose(): void;
  onCopy(): void;
  onPaste?(): void;
  onResize(width: number): void;
  actions?: NoteMenuAction[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(String(state.image?.width ?? 100));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setValue(String(state.image?.width ?? 100));
    setInvalid(false);
  }, [state]);
  useLayoutEffect(() => {
    const menu = root.current!;
    menu.style.left = `${Math.max(8, Math.min(state.x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(state.y, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
  }, [state]);
  useEffect(() => {
    const close = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        !(event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        const items = [
          ...root.current!.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'),
        ];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("mousedown", close, true);
    document.addEventListener("click", close, true);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("click", close, true);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  const apply = (width: number) => {
    if (!Number.isFinite(width) || width < 1 || width > 100) {
      setInvalid(true);
      return;
    }
    onResize(width);
  };
  return createPortal(
    <div
      ref={root}
      className="note-context-menu"
      role="menu"
      aria-label="笔记右键菜单"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button role="menuitem" onClick={onCopy}>
        <Copy size={15} />
        复制<span>Ctrl+C</span>
      </button>
      {onPaste && (
        <button role="menuitem" onClick={onPaste}>
          <ClipboardPaste size={15} />
          粘贴<span>Ctrl+V</span>
        </button>
      )}
      {actions.length > 0 && <div className="image-menu-separator" />}
      {actions.map(({ label, icon: Icon, run, danger }) => (
        <button key={label} role="menuitem" className={danger ? "is-danger" : ""} onClick={run}>
          <Icon size={15} />
          {label}
        </button>
      ))}
      {state.image && (
        <>
          <div className="image-menu-label">图片宽度</div>
          <div className="image-width-presets">
            {[25, 50, 75, 100].map((width) => (
              <button
                key={width}
                role="menuitem"
                aria-pressed={state.image!.width === width}
                onClick={() => apply(width)}
              >
                {width}%
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apply(Number(value));
            }}
            className="image-width-input"
          >
            <input
              aria-label="自定义图片宽度百分比"
              type="number"
              min="1"
              max="100"
              step="any"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setInvalid(false);
              }}
              aria-invalid={invalid}
            />
            <span>%</span>
            <button type="submit" title="应用比例" aria-label="应用比例">
              <Check size={16} />
            </button>
          </form>
          {invalid && (
            <p role="alert" className="image-menu-error">
              请输入 1–100
            </p>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
