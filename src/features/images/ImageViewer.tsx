import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import {
  X,
  ZoomIn,
  ZoomOut,
  Scan,
  Hand,
  MoveUpRight,
  Square,
  Type,
  Undo2,
  Redo2,
  Save,
  LoaderCircle,
} from "lucide-react";
import { annotatedPng, arrowHead, imagePoint, type Annotation, type Point } from "./annotations";
import "./imageTools.css";

type Tool = "pan" | "arrow" | "rectangle" | "text";
const colors = ["#e45649", "#e5a635", "#50a14f", "#4078f2", "#a626a4", "#ffffff", "#20242b"];
export function ImageViewer({
  src,
  alt,
  onClose,
  onSave,
}: {
  src: string;
  alt: string;
  onClose(): void;
  onSave?(blob: Blob): Promise<void>;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const transform = useRef<ReactZoomPanPinchRef>(null);
  const image = useRef<HTMLImageElement>(null);
  const active = useRef(true);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<Tool>("pan");
  const [color, setColor] = useState(colors[0]);
  const [marks, setMarks] = useState<Annotation[]>([]);
  const [redo, setRedo] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [text, setText] = useState<{ start: Point; value: string } | null>(null);
  const [scale, setScale] = useState(100);
  const [zoom, setZoom] = useState("100");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const size = Math.max(2, Math.min(dimensions.width, dimensions.height) / 200);
  const commit = (a: Annotation) => {
    setMarks((current) => [...current, a]);
    setRedo([]);
  };
  const commitText = () => {
    if (text?.value.trim())
      commit({ type: "text", start: text.start, text: text.value.trim(), color, size });
    setText(null);
  };
  const undo = () => {
    const last = marks[marks.length - 1];
    if (last) {
      setRedo([...redo, last]);
      setMarks(marks.slice(0, -1));
    }
  };
  const redoMark = () => {
    const last = redo[redo.length - 1];
    if (last) {
      setMarks([...marks, last]);
      setRedo(redo.slice(0, -1));
    }
  };
  const history = useRef({ undo, redoMark });
  history.current = { undo, redoMark };
  useEffect(() => {
    active.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      active.current = false;
      document.body.style.overflow = oldOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (!savingRef.current) onClose();
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "z" &&
      !(event.target instanceof HTMLInputElement)
    ) {
      event.preventDefault();
      if (event.shiftKey) history.current.redoMark();
      else history.current.undo();
    }
    if (event.key === "Tab") {
      const items = [
        ...dialog.current!.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ),
      ].filter((item) => item.getClientRects().length);
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  const point = (event: React.PointerEvent): Point =>
    imagePoint(
      { x: event.clientX, y: event.clientY },
      image.current!.getBoundingClientRect(),
      dimensions.width,
      dimensions.height,
    );
  const save = async () => {
    if (!onSave || savingRef.current) return;
    const all = [...marks];
    if (text?.value.trim())
      all.push({ type: "text", start: text.start, text: text.value.trim(), color, size });
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(await annotatedPng(src, all));
      if (active.current) onClose();
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      savingRef.current = false;
      if (active.current) setSaving(false);
    }
  };
  const button = (
    label: string,
    Icon: typeof X,
    action: () => void,
    disabled = false,
    selected?: boolean,
  ) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled || saving}
      onClick={action}
    >
      <Icon size={18} strokeWidth={1.7} />
    </button>
  );
  return createPortal(
    <div
      className="image-viewer-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="图片预览与标注"
        tabIndex={-1}
        className="image-viewer"
        onKeyDown={handleKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header>
          <span className="image-viewer-title">{alt || "图片"}</span>
          <span className="image-dimensions">
            {dimensions.width ? `${dimensions.width} × ${dimensions.height}` : ""}
          </span>
          {onSave && (
            <button
              className="image-save"
              onClick={() => void save()}
              disabled={saving || (!marks.length && !text?.value.trim())}
            >
              {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}{" "}
              {saving ? "正在保存…" : "保存副本"}
            </button>
          )}
          {button("关闭图片预览", X, onClose)}
        </header>
        <div className="image-viewer-stage" aria-label="图片画布">
          <TransformWrapper
            ref={transform}
            minScale={0.01}
            maxScale={8}
            fitOnInit
            centerOnInit
            limitToBounds={false}
            panning={{ disabled: tool !== "pan", velocityDisabled: true }}
            doubleClick={{ disabled: true }}
            onTransform={(_, state) => {
              setScale(Math.round(state.scale * 100));
              setZoom(String(Math.round(state.scale * 100)));
            }}
          >
            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%" }}
              contentStyle={{ position: "relative" }}
            >
              <img
                ref={image}
                src={src}
                alt={alt}
                draggable={false}
                className="image-viewer-original"
                onLoad={(e) => {
                  setDimensions({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  });
                }}
                onError={() => setError("图片加载失败，请确认文件仍然存在")}
              />
              {!!dimensions.width && (
                <svg
                  aria-label="图片标注层"
                  className={`image-annotation-layer ${tool === "pan" ? "is-panning" : ""}`}
                  width={dimensions.width}
                  height={dimensions.height}
                  viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                  onPointerDown={(e) => {
                    if (tool === "pan" || saving || e.button !== 0) return;
                    e.preventDefault();
                    const start = point(e);
                    if (tool === "text") {
                      commitText();
                      setText({ start, value: "" });
                      return;
                    }
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDraft({ type: tool, start, end: start, color, size });
                  }}
                  onPointerMove={(e) => {
                    if (draft && draft.type !== "text") setDraft({ ...draft, end: point(e) });
                  }}
                  onPointerUp={() => {
                    if (
                      draft &&
                      draft.type !== "text" &&
                      Math.hypot(draft.start.x - draft.end.x, draft.start.y - draft.end.y) >=
                        size * 2
                    )
                      commit(draft);
                    setDraft(null);
                  }}
                  onPointerCancel={() => setDraft(null)}
                >
                  {[...marks, ...(draft ? [draft] : [])].map((a, i) => (
                    <g
                      key={i}
                      data-annotation={a.type}
                      stroke={a.color}
                      strokeWidth={a.size}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {a.type === "rectangle" ? (
                        <rect
                          x={Math.min(a.start.x, a.end.x)}
                          y={Math.min(a.start.y, a.end.y)}
                          width={Math.abs(a.end.x - a.start.x)}
                          height={Math.abs(a.end.y - a.start.y)}
                        />
                      ) : a.type === "arrow" ? (
                        <>
                          <line x1={a.start.x} y1={a.start.y} x2={a.end.x} y2={a.end.y} />
                          <polyline
                            points={[
                              arrowHead(a.start, a.end, a.size * 4)[0],
                              a.end,
                              arrowHead(a.start, a.end, a.size * 4)[1],
                            ]
                              .map((p) => `${p.x},${p.y}`)
                              .join(" ")}
                          />
                        </>
                      ) : a.type === "text" ? (
                        <text
                          x={a.start.x}
                          y={a.start.y}
                          dominantBaseline="text-before-edge"
                          fontFamily='"HarmonyOS Sans SC", sans-serif'
                          fontSize={a.size * 7}
                          stroke="none"
                          fill={a.color}
                        >
                          {a.text}
                        </text>
                      ) : null}
                    </g>
                  ))}
                </svg>
              )}
              {text && (
                <input
                  autoFocus
                  aria-label="标注文字"
                  className="image-annotation-text"
                  style={{ left: text.start.x, top: text.start.y, fontSize: size * 7, color }}
                  value={text.value}
                  onChange={(e) => setText({ ...text, value: e.target.value })}
                  onBlur={commitText}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) commitText();
                    if (e.key === "Escape") setText(null);
                  }}
                />
              )}
            </TransformComponent>
          </TransformWrapper>
          {!dimensions.width && !error && (
            <div className="image-viewer-loading" role="status">
              <LoaderCircle size={20} className="animate-spin" />
              正在加载图片…
            </div>
          )}
          {error && (
            <div className="image-viewer-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer>
          <div className="image-tools-group">
            {button(
              "拖动查看",
              Hand,
              () => {
                commitText();
                setTool("pan");
              },
              false,
              tool === "pan",
            )}
            {onSave && (
              <>
                {button(
                  "箭头标注",
                  MoveUpRight,
                  () => {
                    commitText();
                    setTool("arrow");
                  },
                  false,
                  tool === "arrow",
                )}
                {button(
                  "矩形标注",
                  Square,
                  () => {
                    commitText();
                    setTool("rectangle");
                  },
                  false,
                  tool === "rectangle",
                )}
                {button("文字标注", Type, () => setTool("text"), false, tool === "text")}
                <span className="image-tool-divider" />
                {colors.map((c) => (
                  <button
                    className="image-color"
                    key={c}
                    aria-label={`标注颜色 ${c}`}
                    aria-pressed={color === c}
                    onClick={() => {
                      commitText();
                      setColor(c);
                    }}
                    disabled={saving}
                  >
                    <span style={{ background: c }} />
                  </button>
                ))}
                <span className="image-tool-divider" />
                {button("撤销标注", Undo2, undo, !marks.length)}
                {button("重做标注", Redo2, redoMark, !redo.length)}
              </>
            )}
          </div>
          <div className="image-tools-group">
            {button("缩小图片", ZoomOut, () => void transform.current?.zoomOut())}
            <form
              className="image-zoom-input"
              onSubmit={(e) => {
                e.preventDefault();
                const value = Number(zoom);
                if (value >= 1 && value <= 800) void transform.current?.centerView(value / 100, 0);
                else setZoom(String(scale));
              }}
            >
              <input
                aria-label="预览缩放百分比"
                value={zoom}
                onChange={(e) => setZoom(e.target.value)}
                type="number"
                min="1"
                max="800"
              />
              %
            </form>
            {button("放大图片", ZoomIn, () => void transform.current?.zoomIn())}
            {button(
              "适应窗口",
              Scan,
              () => void transform.current?.fitToView({ maxScale: 1, animationTime: 150 }),
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
