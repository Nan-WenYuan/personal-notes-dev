import type { OpenProjectNote } from "./ProjectNotes";
import { flushProjectNotes } from "../features/notes/projectNoteStorage";
import type { ProjectNote } from "../features/notes/projectNoteStorage";
import { ProjectPage, requirementStage, type ProjectTask } from "./ProjectPage";
import { useProjectDrag } from "./useProjectDrag";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Folder, Plus, Search, MoreHorizontal, Check, X, GripVertical } from "lucide-react";
import { getErrorMessage, listNotes } from "../features/notes/api";
import "./ProjectList.css";

const statuses = {
  active: "开发中",
  maintenance: "维护中",
  planned: "规划中",
  paused: "暂停",
  archived: "已归档",
};
type Status = keyof typeof statuses;
export interface Project {
  id: string;
  name: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
  tasks?: ProjectTask[];
  noteIds?: string[];
  notes?: ProjectNote[];
}
export function ProjectList({
  onOpenNote,
  initialProjectId,
}: {
  onOpenNote: OpenProjectNote;
  initialProjectId?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId ?? null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [existingNoteIds, setExistingNoteIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [draft, setDraft] = useState<{ id?: string; name: string; status: Status } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const savingRef = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTableRowElement>(null);
  const [reordering, setReordering] = useState(false);
  const [orderError, setOrderError] = useState("");
  const saveRef = useRef<(restoreFocus?: boolean) => Promise<void>>(async () => {});
  async function load() {
    setLoading(true);
    setError("");
    try {
      await flushProjectNotes();
      const [rows, notes] = await Promise.all([invoke<Project[]>("projects_load"), listNotes()]);
      setProjects(rows);
      setExistingNoteIds(new Set(notes.map((note) => note.id)));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (draft) {
      inputRef.current?.focus();
      inputRef.current?.select();
      inputRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [draft?.id, !!draft]);
  useEffect(() => {
    if (!draft) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !editorRef.current?.contains(event.target)) {
        void saveRef.current(false);
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [!!draft]);
  function edit(value: NonNullable<typeof draft>) {
    trigger.current = document.activeElement as HTMLElement;
    setSaveError("");
    setDraft(value);
  }
  function close(restoreFocus = true) {
    if (savingRef.current) return;
    setSaveError("");
    setDraft(null);
    if (restoreFocus)
      requestAnimationFrame(() => trigger.current?.isConnected && trigger.current.focus());
  }
  async function save(restoreFocus = true) {
    if (!draft || savingRef.current || !draft.name.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const rows = await invoke<Project[]>("projects_upsert", {
        id: draft.id ?? null,
        name: draft.name.trim(),
        status: draft.status,
      });
      setProjects(rows);
      setQuery("");
      setFilter("all");
      savingRef.current = false;
      close(restoreFocus);
    } catch (e) {
      setSaveError(getErrorMessage(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  saveRef.current = save;
  const visible = projects.filter(
    (p) =>
      p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
      (filter === "all" ||
        (filter === "active"
          ? p.status === "active" || p.status === "maintenance"
          : p.status === "archived")),
  );
  const projectDrag = useProjectDrag(visible, async (ids) => {
    setReordering(true);
    setOrderError("");
    try {
      setProjects(await invoke<Project[]>("projects_reorder", { ids }));
    } catch (e) {
      setOrderError(getErrorMessage(e));
    } finally {
      setReordering(false);
    }
  });
  const busy = reordering || !!projectDrag.view;
  const editorRow = draft && (
    <tr
      ref={editorRef}
      className="project-inline-row"
      key={draft.id ?? "new"}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
        if (e.key === "Enter" && e.target === inputRef.current) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <td>
        <div className="project-name">
          <Folder size={17} />
          <input
            ref={inputRef}
            aria-label="项目名称"
            maxLength={80}
            placeholder="输入项目名称…"
            value={draft.name}
            disabled={saving}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        {saveError && (
          <p className="project-inline-error" role="alert">
            {saveError}
          </p>
        )}
      </td>
      <td>
        <select
          aria-label="项目状态"
          value={draft.status}
          disabled={saving}
          onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}
        >
          {Object.entries(statuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td>—</td>
      <td>—</td>
      <td>
        <span className="project-inline-hint" role="status">
          {saving ? "保存中…" : draft.id ? "编辑中" : "新项目"}
        </span>
      </td>
      <td>
        <div className="project-inline-actions">
          <button
            aria-label="保存项目"
            title="保存（Enter）"
            disabled={saving || !draft.name.trim()}
            onClick={() => void save()}
          >
            <Check size={16} />
          </button>
          <button
            aria-label="取消编辑"
            title="取消（Esc）"
            disabled={saving}
            onClick={() => close()}
          >
            <X size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
  const selected = projects.find((p) => p.id === selectedId);
  if (selected)
    return (
      <ProjectPage
        key={selected.id}
        project={selected}
        onBack={() => setSelectedId(null)}
        onChanged={setProjects}
        onOpenNote={onOpenNote}
        initialTab={initialProjectId === selected.id ? "notes" : "tasks"}
      />
    );
  return (
    <section
      className="project-list absolute inset-0 z-10 flex flex-col bg-cloud"
      aria-label="项目管理"
    >
      {projectDrag.overlay}
      <header>
        <h1>项目</h1>
        <button
          className="project-new"
          disabled={loading || !!error || !!draft || busy}
          onClick={() => edit({ name: "", status: "active" })}
        >
          <Plus size={16} />
          新建项目
        </button>
      </header>
      <div className="project-filters">
        <label className="project-search">
          <Search size={16} />
          <input
            disabled={!!draft || busy}
            aria-label="搜索项目"
            placeholder="搜索项目…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button disabled={!!draft || busy} aria-label="清除搜索" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </label>
        <div className="project-tabs">
          {[
            ["all", "全部"],
            ["active", "进行中"],
            ["archived", "已归档"],
          ].map(([key, label]) => (
            <button
              disabled={!!draft || busy}
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {orderError && (
        <p className="project-inline-error" role="alert">
          {orderError}
        </p>
      )}
      <div
        className={`project-table-scroll${projectDrag.view ? " is-project-dragging" : ""}`}
        ref={projectDrag.boardRef}
        onPointerMove={projectDrag.move}
        onPointerUp={() => void projectDrag.finish()}
        onPointerCancel={projectDrag.cancel}
        onLostPointerCapture={projectDrag.cancel}
      >
        <table>
          <thead>
            <tr>
              <th>项目名称</th>
              <th>状态</th>
              <th>未完成需求</th>
              <th>笔记</th>
              <th>最近更新</th>
              <th>
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft && !draft.id && editorRow}
            {projectDrag.preview.map((p) =>
              draft?.id === p.id ? (
                editorRow
              ) : projectDrag.view?.id === p.id ? (
                <tr
                  key={p.id}
                  data-project-placeholder
                  className="project-drag-placeholder"
                  style={{ height: projectDrag.view.height }}
                >
                  <td colSpan={6} />
                </tr>
              ) : (
                <tr
                  key={p.id}
                  data-project-row={p.id}
                  className={!draft ? "project-clickable" : ""}
                  onDoubleClick={() => {
                    if (!draft && !busy) setSelectedId(p.id);
                  }}
                >
                  <td>
                    <div className="project-name-cell">
                      <button
                        className="project-drag-handle"
                        aria-label={`拖动排序 ${p.name}`}
                        title="拖动排序"
                        disabled={!!draft || reordering}
                        onPointerDown={(e) => projectDrag.start(e, p.id)}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <GripVertical size={14} />
                      </button>
                      <button
                        disabled={!!draft || busy}
                        className="project-name project-open"
                        title={`${p.name}（双击进入）`}
                        aria-label={`打开项目 ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (e.detail === 0) setSelectedId(p.id);
                        }}
                      >
                        <Folder size={17} />
                        <span>{p.name}</span>
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className={`project-status ${p.status}`}>{statuses[p.status]}</span>
                  </td>
                  <td>{(p.tasks ?? []).filter((t) => requirementStage(t) !== "done").length}</td>
                  <td>
                    {(p.notes ?? []).length +
                      (p.noteIds ?? []).filter((id) => existingNoteIds.has(id)).length}{" "}
                    篇
                  </td>
                  <td>
                    <time
                      dateTime={new Date(p.updatedAt).toISOString()}
                      title={new Date(p.updatedAt).toLocaleString()}
                    >
                      {new Date(p.updatedAt).toLocaleDateString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                      })}
                    </time>
                  </td>
                  <td>
                    <button
                      disabled={!!draft || busy}
                      className="project-edit"
                      aria-label={`编辑项目 ${p.name}`}
                      title="编辑名称与状态"
                      onClick={(e) => {
                        e.stopPropagation();
                        edit({ id: p.id, name: p.name, status: p.status });
                      }}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        {loading ? (
          <p className="project-empty" role="status">
            正在加载项目…
          </p>
        ) : error ? (
          <div className="project-empty" role="alert">
            <p>{error}</p>
            <button onClick={() => void load()}>重新加载</button>
          </div>
        ) : (
          !visible.length &&
          !draft && (
            <div className="project-empty">
              <Folder size={28} />
              <p>{projects.length ? "没有符合条件的项目" : "还没有项目"}</p>
              {!projects.length && (
                <button onClick={() => edit({ name: "", status: "active" })}>创建第一个项目</button>
              )}
            </div>
          )
        )}
      </div>
      <footer>
        {loading
          ? "加载中"
          : error
            ? "加载失败"
            : `${visible.length} 个项目${visible.length !== projects.length ? ` / 共 ${projects.length} 个` : ""}`}
      </footer>
    </section>
  );
}
