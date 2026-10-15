import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, Plus, Pencil, Check, X } from "lucide-react";
import { getErrorMessage, listNotes, getNote, updateNote } from "../features/notes/api";
import type { Note, NoteMetadata } from "../features/notes/types";
import type { Project } from "./ProjectList";
export type OpenProjectNote = (
  projectId: string,
  noteId?: string,
  legacy?: boolean,
) => Promise<void>;
export function ProjectNotes({
  project,
  onOpen,
  onChanged,
}: {
  project: Project;
  onOpen: OpenProjectNote;
  onChanged: (rows: Project[]) => void;
}) {
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  async function load() {
    setLoading(true);
    setError("");
    try {
      setNotes(await listNotes());
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [project.id]);
  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [rename?.id]);
  async function create() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const note = await invoke<Note>("projects_create_note", {
        projectId: project.id,
        legacyId: null,
      });
      setSelected(note.id);
      setMessage("已创建 · Enter 确认名称，Esc 保留默认名称");
      onChanged(await invoke<Project[]>("projects_load"));
      setNotes(await listNotes());
      setRename({ id: note.id, title: note.title || "无标题笔记" });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function saveTitle() {
    if (!rename || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const old = await getNote(rename.id);
      await updateNote(
        old.id,
        { title: rename.title.trim(), content: old.content, category: old.category },
        old.content,
      );
      setNotes(await listNotes());
      setRename(null);
      setMessage("名称已保存");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function open(id: string, legacy = false) {
    if (busyRef.current || rename) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onOpen(project.id, id, legacy);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="project-note-tools">
        <span className="project-note-summary">
          {(project.noteIds?.filter((id) => notes.some((note) => note.id === id)).length ?? 0) +
            (project.notes?.length ?? 0)}{" "}
          篇笔记
          <span>双击打开编辑</span>
        </span>
        <button
          className="project-new"
          disabled={busy || loading || !!rename}
          onClick={() => void create()}
        >
          <Plus size={15} />
          {busy ? "处理中…" : "新建笔记"}
        </button>
      </div>
      <p className="project-note-feedback" role="status">
        {message}
      </p>
      {error && (
        <p className="project-inline-error" role="alert">
          {error}
          <button onClick={() => void load()}>重新加载</button>
        </p>
      )}
      {loading ? (
        <p className="project-empty">正在加载笔记…</p>
      ) : (
        <>
          {[...(project.noteIds ?? [])]
            .filter((id) => notes.some((note) => note.id === id))
            .reverse()
            .map((id) => {
              const note = notes.find((n) => n.id === id);
              return (
                <div
                  className={`project-linked-note ${selected === id ? "is-selected" : ""} ${rename?.id === id ? "is-renaming" : ""}`}
                  key={id}
                  onClick={() => setSelected(id)}
                  onDoubleClick={() => void open(id)}
                >
                  {rename?.id === id ? (
                    <div className="project-note-rename">
                      <FileText size={17} />
                      <input
                        ref={titleRef}
                        aria-label="笔记名称"
                        maxLength={200}
                        disabled={busy}
                        value={rename.title}
                        onChange={(e) => setRename({ ...rename, title: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void saveTitle();
                          }
                          if (e.key === "Escape" && !busy) setRename(null);
                        }}
                      />
                      <button
                        aria-label="保存笔记名称"
                        disabled={busy}
                        onClick={() => void saveTitle()}
                      >
                        <Check size={16} />
                      </button>
                      <button aria-label="取消改名" disabled={busy} onClick={() => setRename(null)}>
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        disabled={busy || !note || !!rename}
                        title="双击进入编辑器"
                        aria-label={`打开笔记 ${note?.title || "无标题笔记"}`}
                        onClick={(e) => {
                          if (e.detail === 0) void open(id);
                        }}
                      >
                        <FileText size={17} />
                        <span title={note?.title || "无标题笔记"}>
                          {note ? note.title.trim() || "无标题笔记" : "笔记已删除"}
                        </span>
                      </button>
                      <time dateTime={note?.updatedAt} title={note?.updatedAt}>
                        {note?.updatedAt
                          ? new Date(note.updatedAt)
                              .toLocaleString("zh-CN", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                hourCycle: "h23",
                              })
                              .replace(/\//g, "-")
                          : ""}
                      </time>
                      <button
                        className="project-note-action"
                        disabled={busy || !note || !!rename}
                        aria-label={`重命名笔记 ${note?.title || "无标题笔记"}`}
                        title="重命名"
                        onDoubleClick={(e) => e.stopPropagation()}
                        onClick={() => setRename({ id, title: note?.title || "" })}
                      >
                        <Pencil size={14} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          {(project.notes ?? []).map((note) => (
            <div
              className="project-linked-note"
              key={note.id}
              onDoubleClick={() => void open(note.id, true)}
            >
              <button
                disabled={busy || !!rename}
                title="双击进入编辑器"
                onClick={(e) => {
                  if (e.detail === 0) void open(note.id, true);
                }}
              >
                <FileText size={17} />
                <span>{note.title.trim() || "无标题笔记"}</span>
              </button>
            </div>
          ))}
          {!project.notes?.length && !project.noteIds?.length && (
            <p className="project-empty">还没有项目笔记，记录需求、设计方案或开发过程吧。</p>
          )}
        </>
      )}
    </>
  );
}
