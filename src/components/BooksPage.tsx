import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FilePlus2, Search, Trash2, Upload } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { getErrorMessage } from "../features/notes/api";
import { BOOK_FORMATS, flushBookProgress, type Book } from "../features/books/storage";
import { showToast } from "./Toast";
import "./BooksPage.css";

const BookReader = lazy(() => import("./BookReader"));
const date = (timestamp: number | null) =>
  timestamp
    ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-")
    : "—";
const fileSize = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;

export function BooksPage({ active }: { active: boolean }) {
  const root = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const [items, setItems] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [reading, setReading] = useState<Book | null>(null);
  const [dragging, setDragging] = useState(false);
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    try {
      await flushBookProgress();
      const books = await invoke<Book[]>("books_list");
      if (mounted.current) {
        setItems(books);
        setError("");
      }
    } catch (e) {
      if (mounted.current) setError(getErrorMessage(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);
  const importPaths = useCallback(async (paths: string[]) => {
    if (busyRef.current || !paths.length) return;
    busyRef.current = true;
    setError("");
    const failures: string[] = [];
    let imported = 0;
    try {
      for (let i = 0; i < paths.length; i++) {
        if (mounted.current) setImporting(`正在导入 ${i + 1} / ${paths.length}`);
        try {
          const book = await invoke<Book>("books_import", { path: paths[i] });
          imported++;
          if (mounted.current)
            setItems((current) => [book, ...current.filter((b) => b.id !== book.id)]);
        } catch (e) {
          failures.push(`${paths[i].split(/[\\/]/).pop()}：${getErrorMessage(e)}`);
        }
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setImporting("");
        setError(failures.join("；"));
      }
      if (imported) showToast(`已导入 ${imported} 本，重复书籍自动合并`, "success");
    }
  }, []);
  useEffect(() => {
    if (!active || reading) return;
    let cancelled = false;
    const subscription = getCurrentWindow().onDragDropEvent((event) => {
      if (cancelled) return;
      if (event.payload.type === "leave") {
        setDragging(false);
        return;
      }
      const rect = root.current?.getBoundingClientRect();
      const { x, y } = event.payload.position;
      const inside =
        rect &&
        x / devicePixelRatio >= rect.left &&
        x / devicePixelRatio <= rect.right &&
        y / devicePixelRatio >= rect.top &&
        y / devicePixelRatio <= rect.bottom;
      if (event.payload.type === "drop") {
        setDragging(false);
        if (inside) void importPaths(event.payload.paths);
      } else setDragging(Boolean(inside));
    });
    void subscription.catch((e) => {
      if (!cancelled) setError(getErrorMessage(e));
    });
    return () => {
      cancelled = true;
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [active, reading, importPaths]);
  async function choose() {
    try {
      const paths = await open({
        multiple: true,
        directory: false,
        filters: [{ name: "电子书", extensions: BOOK_FORMATS }],
      });
      if (paths) await importPaths(Array.isArray(paths) ? paths : [paths]);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }
  async function remove(book: Book) {
    try {
      await flushBookProgress();
      await invoke("books_delete", { id: book.id });
      setItems((current) => current.filter((b) => b.id !== book.id));
      showToast("已移至回收站", "success");
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }
  async function read(book: Book) {
    try {
      await flushBookProgress();
      const latest = await invoke<Book[]>("books_list");
      setReading(latest.find((b) => b.id === book.id) ?? book);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }
  const visible = items.filter(
    (book) =>
      (!filter || book.format === filter) && book.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section
      ref={root}
      className="books-page"
      aria-label="书籍"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {reading ? (
        <Suspense fallback={<div className="book-empty">正在打开阅读器…</div>}>
          <BookReader
            book={reading}
            onBack={() => {
              setReading(null);
              void reload();
            }}
          />
        </Suspense>
      ) : (
        <>
          <header className="books-header">
            <h1>书籍</h1>
            <button
              className="books-import"
              disabled={Boolean(importing)}
              onClick={() => void choose()}
            >
              <FilePlus2 size={15} />
              导入书籍
            </button>
          </header>
          <div className="books-tools">
            <label className="books-search">
              <Search size={15} />
              <input
                aria-label="搜索书籍"
                placeholder="搜索书籍…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="书籍格式"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">全部格式</option>
              {BOOK_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format.toUpperCase()}
                </option>
              ))}
            </select>
            <span className="books-count">{visible.length} 本书籍</span>
            <span className="books-hint">拖入导入 · 双击阅读</span>
          </div>
          {importing && (
            <div className="books-import-progress" role="status">
              <span className="book-spinner" />
              {importing}
            </div>
          )}
          {error && (
            <div className="book-error" role="alert">
              {error}
              <button onClick={() => void reload()}>刷新</button>
            </div>
          )}
          <div className="books-table-scroll">
            <table className="books-table">
              <thead>
                <tr>
                  <th>书名</th>
                  <th>格式</th>
                  <th>大小</th>
                  <th>阅读进度</th>
                  <th>最近阅读</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {visible.map((book) => (
                  <tr
                    key={book.id}
                    tabIndex={0}
                    aria-selected={selected === book.id}
                    onClick={() => setSelected(book.id)}
                    onDoubleClick={() => void read(book)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void read(book);
                      }
                    }}
                  >
                    <td>
                      <div className="book-name" title={book.title}>
                        <BookOpen size={16} />
                        <span>{book.title}</span>
                      </div>
                    </td>
                    <td>
                      <span className="book-format">{book.format.toUpperCase()}</span>
                    </td>
                    <td>{fileSize(book.size)}</td>
                    <td>
                      <span className="book-progress-track">
                        <i style={{ width: `${book.progress * 100}%` }} />
                      </span>
                      <span>
                        {book.lastReadAt ? `${Math.round(book.progress * 100)}%` : "未读"}
                      </span>
                    </td>
                    <td title={date(book.lastReadAt)}>{date(book.lastReadAt)}</td>
                    <td>
                      <button
                        className="book-remove"
                        title="移至回收站"
                        aria-label={`删除 ${book.title}`}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(book);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <div className="book-empty">
                {loading ? (
                  "正在读取书籍…"
                ) : items.length ? (
                  "没有找到匹配的书籍"
                ) : (
                  <>
                    <BookOpen size={30} strokeWidth={1.2} />
                    <p>将书籍文件拖到这里</p>
                    <small>EPUB、PDF、MOBI、AZW3、FB2、CBZ、TXT</small>
                    <button onClick={() => void choose()}>选择文件</button>
                  </>
                )}
              </div>
            )}
          </div>
          {dragging && (
            <div className="books-drop-overlay">
              <Upload size={28} />
              <span>松开以导入书籍</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
