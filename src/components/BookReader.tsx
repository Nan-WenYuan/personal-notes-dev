import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  Maximize,
  Minimize,
  Minus,
  Plus,
} from "lucide-react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createFullscreenSync } from "../features/books/fullscreen";
import { getErrorMessage } from "../features/notes/api";
import {
  bookReadingMode,
  flushBookProgress,
  saveBookProgress,
  saveBookReadingMode,
  type Book,
  type ReadingMode,
} from "../features/books/storage";
import { openRenderer, type ReaderController } from "../features/books/renderers";
import type { TocItem } from "../features/books/engine";

export default function BookReader({ book, onBack }: { book: Book; onBack: () => void }) {
  const fixed = book.format === "pdf" || book.format === "cbz";
  const root = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ReaderController | undefined>(undefined);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [full, setFull] = useState(false);
  const fullRef = useRef(false);
  fullRef.current = full;
  const syncNative = useRef<ReturnType<typeof createFullscreenSync> | undefined>(undefined);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  const hideToolbarTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toolbarDragging = useRef(false);
  const pointerInToolbar = useRef(false);
  function revealToolbar() {
    clearTimeout(hideToolbarTimer.current);
    setToolbarVisible(true);
  }
  function deferHideToolbar() {
    clearTimeout(hideToolbarTimer.current);
    hideToolbarTimer.current = setTimeout(() => {
      const focused = document.activeElement;
      const keyboardFocus =
        focused &&
        dock.current?.contains(focused) &&
        (focused.matches(":focus-visible") || focused.tagName === "SELECT");
      if (!toolbarDragging.current && !pointerInToolbar.current && !keyboardFocus)
        setToolbarVisible(false);
    }, 500);
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fraction, setFraction] = useState(book.progress);
  const [label, setLabel] = useState("");
  const [size, setSize] = useState(18);
  const [sizeChanged, setSizeChanged] = useState(false);
  const latestBook = useRef(book);
  const beforeFull = useRef({ sizeChanged: false });
  const displayState = useRef({ sizeChanged: false, flow: "scroll" });
  const wheelState = useRef({ delta: 0, lastEvent: 0, lastTurn: -Infinity, direction: 0 });
  const [flow, setFlow] = useState<ReadingMode>(() => bookReadingMode(book));
  const [attempt, setAttempt] = useState(0);
  displayState.current = { sizeChanged, flow };
  useEffect(() => {
    setToolbarVisible(false);
    if (!full) return;
    // Capture mouse movement over PDF text/canvas too. The dock itself catches iframe edges.
    const move = (event: PointerEvent) => {
      const bounds = root.current?.getBoundingClientRect();
      if (!bounds) return;
      pointerInToolbar.current =
        event.clientY >= bounds.bottom - 96 && event.clientY <= bounds.bottom;
      if (pointerInToolbar.current) revealToolbar();
      else deferHideToolbar();
    };
    const release = () => {
      toolbarDragging.current = false;
      deferHideToolbar();
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    return () => {
      clearTimeout(hideToolbarTimer.current);
      toolbarDragging.current = false;
      pointerInToolbar.current = false;
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
    };
  }, [full]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      await flushBookProgress();
      const path = await invoke<string>("books_path", { id: book.id });
      if (abort.signal.aborted || !host.current) return;
      const renderer = await openRenderer(
        host.current,
        convertFileSrc(path),
        latestBook.current,
        {
          keydown: readerKeydown,
          wheel: readerWheel,
          toc: setToc,
          ready: () => {
            if (!abort.signal.aborted) setLoading(false);
          },
          position: (location, progress, chapter) => {
            if (abort.signal.aborted) return;
            setFraction(progress);
            setLabel(chapter);
            latestBook.current = { ...latestBook.current, location, progress };
            saveBookProgress(book.id, location, progress);
          },
          error: (e) => {
            if (!abort.signal.aborted) setError(getErrorMessage(e));
          },
        },
        abort.signal,
      );
      if (abort.signal.aborted) renderer?.destroy();
      else controller.current = renderer;
    })().catch((e) => {
      if (!abort.signal.aborted) {
        setLoading(false);
        setError(`无法打开书籍：${getErrorMessage(e)}`);
      }
    });
    const visibility = () => {
      if (document.hidden) void flushBookProgress().catch((e) => setError(getErrorMessage(e)));
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      abort.abort();
      controller.current = undefined;
      document.removeEventListener("visibilitychange", visibility);
      void flushBookProgress().catch(() => {});
    };
  }, [book, attempt]);
  useEffect(() => {
    syncNative.current = isTauri() ? createFullscreenSync(getCurrentWindow()) : undefined;
    const changed = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("keydown", readerKeydown, true);
    document.addEventListener("wheel", readerWheel, { capture: true, passive: false });
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("keydown", readerKeydown, true);
      document.removeEventListener("wheel", readerWheel, true);
      void syncNative.current?.(false).catch(() => {});
    };
  }, []);
  useEffect(() => {
    controller.current?.presentation?.(full);
    if (full) {
      beforeFull.current = displayState.current;
      if (book.format === "pdf") {
        setSizeChanged(false);
      }
    } else {
      setSizeChanged(beforeFull.current.sizeChanged);
    }
  }, [full, book.format]);
  async function exitFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    await syncNative.current?.(false);
    setFull(false);
  }
  function readerKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && fullRef.current) {
      event.preventDefault();
      event.stopPropagation();
      void exitFullscreen().catch((e) => setError(getErrorMessage(e)));
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      target?.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      controller.current?.prev();
    } else if (["ArrowRight", "ArrowDown", "PageDown"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      controller.current?.next();
    }
  }
  function readerWheel(event: WheelEvent) {
    if (
      displayState.current.flow !== "page" ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      !event.deltaY ||
      (event.target as HTMLElement | null)?.closest(
        '.book-toc, .book-reader-footer, button, input, select, textarea, [contenteditable="true"]',
      )
    )
      return;
    event.preventDefault();
    const now = performance.now();
    const state = wheelState.current;
    const delta =
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    if (now - state.lastEvent > 160 || Math.sign(delta) !== Math.sign(state.delta)) state.delta = 0;
    state.lastEvent = now;
    if (now - state.lastTurn < 350 && Math.sign(delta) === state.direction) return;
    state.delta += delta;
    if (Math.abs(state.delta) < 50) return;
    if (state.delta > 0) controller.current?.next();
    else controller.current?.prev();
    state.lastTurn = now;
    state.direction = Math.sign(state.delta);
    state.delta = 0;
  }
  async function back() {
    try {
      await flushBookProgress();
      await exitFullscreen();
      onBack();
    } catch (e) {
      setError(`阅读进度保存失败：${getErrorMessage(e)}`);
    }
  }
  async function fullscreen() {
    try {
      if (fullRef.current) await exitFullscreen();
      else if (syncNative.current) {
        await syncNative.current(true);
        setFull(true);
      } else await root.current?.requestFullscreen();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }
  function changeSize(delta: number) {
    const value = Math.min(32, Math.max(12, size + delta));
    setSize(value);
    setSizeChanged(true);
    controller.current?.size(value);
  }
  function tocRows(items: TocItem[], level = 0): React.ReactNode {
    return items.map((item, index) => (
      <div key={`${item.href}-${index}`}>
        <button
          style={{ paddingLeft: 12 + level * 12 }}
          title={item.label}
          onClick={() => controller.current?.navigate(item.href)}
        >
          {item.label}
        </button>
        {item.subitems && tocRows(item.subitems, level + 1)}
      </div>
    ));
  }
  const readerTools = (
    <>
      <button
        title="章节目录"
        aria-label="章节目录"
        aria-pressed={tocOpen}
        onClick={() => setTocOpen(!tocOpen)}
      >
        <List size={17} />
      </button>
      <button
        title={fixed ? "缩小" : "减小字号"}
        aria-label="缩小"
        disabled={loading || size <= 12}
        onClick={() => changeSize(-2)}
      >
        <Minus size={15} />
      </button>
      <span className="book-size">
        {fixed
          ? sizeChanged
            ? `${Math.round((size / 18) * 100)}%`
            : book.format === "pdf"
              ? full
                ? "适页"
                : "适宽"
              : "适页"
          : size}
      </span>
      <button
        title={fixed ? "放大" : "增大字号"}
        aria-label="放大"
        disabled={loading || size >= 32}
        onClick={() => changeSize(2)}
      >
        <Plus size={15} />
      </button>
      {book.format !== "cbz" && (
        <select
          aria-label="阅读方式"
          value={flow}
          disabled={loading}
          onChange={(e) => {
            const mode = e.target.value as ReadingMode;
            setFlow(mode);
            latestBook.current = { ...latestBook.current, readingMode: mode };
            controller.current?.flow(mode === "scroll");
            void saveBookReadingMode(book.id, mode).catch((error) =>
              setError(`阅读方式保存失败：${getErrorMessage(error)}`),
            );
          }}
        >
          <option value="page">翻页</option>
          <option value="scroll">滚动</option>
        </select>
      )}
      <button
        title={full ? "退出全屏" : "全屏阅读"}
        aria-label={full ? "退出全屏" : "全屏阅读"}
        disabled={loading}
        onClick={() => void fullscreen()}
      >
        {full ? <Minimize size={17} /> : <Maximize size={17} />}
      </button>
    </>
  );
  return (
    <section
      ref={root}
      className={`book-reader${full ? " book-reader-full" : ""}`}
      aria-label={`阅读 ${book.title}`}
    >
      {!full && (
        <header className="book-reader-toolbar">
          <button onClick={() => void back()} title="返回书籍列表">
            <ArrowLeft size={16} />
            <span>书籍</span>
          </button>
          <strong title={book.title}>{book.title}</strong>
          {readerTools}
        </header>
      )}
      {error && (
        <div className="book-error" role="alert">
          {error}
          <button onClick={() => setAttempt((a) => a + 1)}>重试</button>
        </div>
      )}
      <div className="book-reader-body">
        {tocOpen && (
          <aside className="book-toc" aria-label="目录">
            <h2>目录</h2>
            {toc.length ? tocRows(toc) : <p>本书暂无目录</p>}
          </aside>
        )}
        <div className="book-reading-area">
          <div ref={host} className="book-render-host" />
          {loading && (
            <div className="book-reader-loading" role="status">
              正在打开书籍…
            </div>
          )}
        </div>
      </div>
      <div
        ref={dock}
        className={
          full ? `book-fullscreen-dock${toolbarVisible ? " is-visible" : ""}` : "book-footer-wrap"
        }
        onPointerEnter={
          full
            ? () => {
                pointerInToolbar.current = true;
                revealToolbar();
              }
            : undefined
        }
        onPointerMove={
          full
            ? () => {
                pointerInToolbar.current = true;
                revealToolbar();
              }
            : undefined
        }
        onPointerLeave={
          full
            ? () => {
                pointerInToolbar.current = false;
                deferHideToolbar();
              }
            : undefined
        }
        onFocusCapture={full ? revealToolbar : undefined}
        onBlurCapture={full ? deferHideToolbar : undefined}
        onPointerDown={
          full
            ? () => {
                toolbarDragging.current = true;
                revealToolbar();
              }
            : undefined
        }
      >
        <footer className="book-reader-footer" aria-label="阅读工具栏">
          {full && (
            <button onClick={() => void back()} title="返回书籍列表" aria-label="返回书籍列表">
              <ArrowLeft size={16} />
            </button>
          )}
          <button aria-label="上一页" disabled={loading} onClick={() => controller.current?.prev()}>
            <ChevronLeft size={17} />
          </button>
          <span title={label} className="book-current-chapter">
            {label || "阅读进度"}
          </span>
          <input
            aria-label="阅读进度"
            type="range"
            min="0"
            max="1000"
            value={Math.round(fraction * 1000)}
            disabled={loading}
            onChange={(e) => controller.current?.seek(Number(e.target.value) / 1000)}
          />
          <span>{Math.round(fraction * 100)}%</span>
          <button aria-label="下一页" disabled={loading} onClick={() => controller.current?.next()}>
            <ChevronRight size={17} />
          </button>
          {full && <div className="book-fullscreen-tools">{readerTools}</div>}
        </footer>
      </div>
    </section>
  );
}
