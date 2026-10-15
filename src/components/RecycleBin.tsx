import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  RotateCcw,
  Search,
  Trash2,
  FileText,
  Folder,
  ListTodo,
  Timer,
  Image,
  BookOpen,
} from "lucide-react";
import { getErrorMessage } from "../features/notes/api";
import { showToast } from "./Toast";
import "./RecycleBin.css";

export interface TrashEntry {
  id: string;
  kind: string;
  name: string;
  origin: string;
  deletedAt: number;
}
const types = {
  book: "书籍",
  note: "笔记",
  category: "分类",
  requirement: "项目需求",
  quadrant: "四象限任务",
  pomodoro: "专注记录",
  attachment: "图片",
};
const icons = {
  book: BookOpen,
  note: FileText,
  category: Folder,
  requirement: ListTodo,
  quadrant: ListTodo,
  pomodoro: Timer,
  attachment: Image,
};
export function RecycleBin({
  onBack,
  onRestore,
}: {
  onBack: () => void;
  onRestore: (entry: TrashEntry) => Promise<void>;
}) {
  const [items, setItems] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<string[] | null>(null);
  async function load() {
    setLoading(true);
    try {
      setItems(await invoke<TrashEntry[]>("trash_list"));
      setError("");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const visible = items.filter(
    (item) =>
      (!filter || item.kind === filter) &&
      `${item.name} ${item.origin}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function restore(rows: TrashEntry[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    let done = 0;
    try {
      for (const row of rows) {
        await onRestore(row);
        done++;
      }
      setSelected(new Set());
      showToast(`已恢复 ${done} 项`, "success");
    } catch (e) {
      setError(`${done ? `已恢复 ${done} 项。` : ""}${getErrorMessage(e)}`);
    } finally {
      await loadPreservingError();
      setBusy(false);
    }
  }
  async function loadPreservingError() {
    try {
      setItems(await invoke<TrashEntry[]>("trash_list"));
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }
  async function purge() {
    if (!confirm || busy) return;
    setBusy(true);
    setError("");
    try {
      await invoke("trash_delete", { ids: confirm });
      setConfirm(null);
      setSelected(new Set());
      showToast("已彻底删除", "success");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      await loadPreservingError();
      setBusy(false);
    }
  }
  const picked = items.filter((item) => selected.has(item.id));
  return (
    <section className="recycle-bin" aria-label="回收站" aria-busy={busy || loading}>
      <button className="recycle-back" onClick={onBack} disabled={busy}>
        <ArrowLeft size={15} />
        返回
      </button>
      <header>
        <div>
          <h1>回收站</h1>
          <p>删除的内容保留在这里，可恢复到原位置。</p>
        </div>
        <button
          className="recycle-outline danger"
          onClick={() => setConfirm(items.map((item) => item.id))}
          disabled={!items.length || busy || loading}
        >
          <Trash2 size={14} />
          清空回收站
        </button>
      </header>
      <div className="recycle-tools">
        <label className="recycle-search">
          <Search size={15} />
          <input
            aria-label="搜索回收站"
            placeholder="搜索名称或原位置…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select aria-label="筛选类型" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">全部类型</option>
          {Object.entries(types).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span className="recycle-count">
          {busy
            ? "正在处理…"
            : `共 ${items.length} 项${picked.length ? ` · 已选 ${picked.length} 项` : ""}`}
        </span>
        {picked.length > 0 && (
          <>
            <button disabled={busy} onClick={() => void restore(picked)}>
              恢复所选
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => setConfirm(picked.map((item) => item.id))}
            >
              彻底删除
            </button>
          </>
        )}
      </div>
      {error && !confirm && (
        <div className="recycle-error" role="alert">
          {error}
          <button disabled={busy} onClick={() => void load()}>
            刷新
          </button>
        </div>
      )}
      <div className="recycle-scroll">
        <table>
          <thead>
            <tr>
              <th className="recycle-check">
                <input
                  aria-label="选择当前列表全部条目"
                  type="checkbox"
                  disabled={busy || !visible.length}
                  checked={!!visible.length && visible.every((i) => selected.has(i.id))}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(visible.map((i) => i.id)) : new Set())
                  }
                />
              </th>
              <th>名称</th>
              <th>类型 / 原位置</th>
              <th>删除时间</th>
              <th className="recycle-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const Icon = icons[item.kind as keyof typeof icons] ?? FileText;
              return (
                <tr key={item.id}>
                  <td>
                    <input
                      aria-label={`选择 ${item.name || "无标题笔记"}`}
                      type="checkbox"
                      disabled={busy}
                      checked={selected.has(item.id)}
                      onChange={(e) =>
                        setSelected((old) => {
                          const next = new Set(old);
                          if (e.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>
                    <div className="recycle-name" title={item.name || "无标题笔记"}>
                      <Icon size={16} />
                      <span>{item.name || "无标题笔记"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="recycle-origin" title={item.origin}>
                      <span>{types[item.kind as keyof typeof types] ?? item.kind}</span>
                      <small>{item.origin}</small>
                    </div>
                  </td>
                  <td className="recycle-date">
                    {new Date(item.deletedAt)
                      .toLocaleString("zh-CN", { hour12: false })
                      .replace(/\//g, "-")}
                  </td>
                  <td>
                    <div className="recycle-row-actions">
                      <button
                        disabled={busy}
                        title="恢复到原位置"
                        onClick={() => void restore([item])}
                      >
                        <RotateCcw size={14} />
                        恢复
                      </button>
                      <button
                        className="danger"
                        title="彻底删除"
                        aria-label={`彻底删除 ${item.name || "无标题笔记"}`}
                        disabled={busy}
                        onClick={() => setConfirm([item.id])}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!visible.length && (
          <div className="recycle-empty">
            <Trash2 size={30} />
            <p>{loading ? "正在加载…" : items.length ? "没有匹配的内容" : "回收站是空的"}</p>
          </div>
        )}
      </div>
      {confirm && (
        <div
          className="recycle-confirm-shade"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) setConfirm(null);
            if (e.key === "Tab") {
              const buttons =
                e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
              const first = buttons[0];
              const last = buttons[buttons.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <div
            className="recycle-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="trash-confirm-title"
          >
            <h2 id="trash-confirm-title">彻底删除这 {confirm.length} 项？</h2>
            <p>删除后无法从回收站恢复。</p>
            {error && (
              <p role="alert" className="recycle-error">
                {error}
              </p>
            )}
            <div>
              <button autoFocus disabled={busy} onClick={() => setConfirm(null)}>
                取消
              </button>
              <button
                className="recycle-outline danger"
                disabled={busy}
                onClick={() => void purge()}
              >
                {busy ? "正在删除…" : "彻底删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
