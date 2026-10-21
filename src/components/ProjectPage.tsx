import { moveRequirement } from "../features/notes/projectRequirements";
import { flushProjectNotes, trackProjectContentSave } from "../features/notes/projectNoteStorage";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Plus,
  Circle,
  CalendarDays,
  Code2,
  CircleCheck,
  GripVertical,
  X,
} from "lucide-react";
import { getErrorMessage } from "../features/notes/api";
import { ProjectNotes, type OpenProjectNote } from "./ProjectNotes";
import type { Project } from "./ProjectList";

export type { ProjectTask, RequirementStage } from "../features/notes/projectRequirements";
export { requirementStage } from "../features/notes/projectRequirements";
import {
  requirementStage,
  type ProjectTask,
  type RequirementStage,
} from "../features/notes/projectRequirements";
const stages = [
  { value: "backlog", label: "待梳理", color: "var(--color-ink-soft)", icon: Circle },
  { value: "planned", label: "排期中", color: "var(--color-warning)", icon: CalendarDays },
  { value: "developing", label: "开发中", color: "var(--color-info)", icon: Code2 },
  { value: "done", label: "已完成", color: "var(--color-success)", icon: CircleCheck },
] as const;
export function ProjectPage({
  project,
  onBack,
  onChanged,
  onOpenNote,
  initialTab = "tasks",
}: {
  project: Project;
  onBack: () => void;
  onChanged: (rows: Project[]) => void;
  onOpenNote: OpenProjectNote;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<ProjectTask[]>(project.tasks ?? []);
  const tasksRef = useRef(tasks);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [deletedTask, setDeletedTask] = useState<{ task: ProjectTask; index: number } | null>(null);
  useEffect(() => {
    if (!deletedTask) return;
    const timeout = window.setTimeout(() => setDeletedTask(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [deletedTask]);
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveRevision = useRef(0);
  const [moveMenu, setMoveMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const moveMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!busyRef.current && !error) {
      tasksRef.current = project.tasks ?? [];
      setTasks(tasksRef.current);
    }
  }, [project.tasks]);
  useEffect(() => {
    if (!moveMenu) return;
    const close = (event: PointerEvent) => {
      if (!moveMenuRef.current?.contains(event.target as Node)) setMoveMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoveMenu(null);
    };
    const dismiss = () => setMoveMenu(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", dismiss);

    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", dismiss);
    };
  }, [moveMenu]);
  const [pendingTasks, setPendingTasks] = useState<ProjectTask[] | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  type DragView = {
    id: string;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    stage: RequirementStage | null;
    before: string | null;
  };
  const dragRef = useRef<(DragView & { startX: number; startY: number; moved: boolean }) | null>(
    null,
  );
  const [dragView, setDragView] = useState<DragView | null>(null);
  const settling = useRef(false);
  const liveDrag = useRef<DragView | null>(null);
  const previewTasks = dragView?.stage
    ? moveRequirement(tasks, dragView.id, dragView.stage, dragView.before)
    : (pendingTasks ?? tasks);
  function clearDrag() {
    dragRef.current = null;
    liveDrag.current = null;
    setDragView(null);
  }
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !settling.current) clearDrag();
    };
    window.addEventListener("keydown", cancel);
    const blur = () => {
      if (!settling.current) clearDrag();
    };
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const rowPositions = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    boardRef.current?.querySelectorAll<HTMLElement>("[data-requirement-id]").forEach((el) => {
      el.getAnimations().forEach((animation) => animation.cancel());
      const id = el.dataset.requirementId!;
      const rect = el.getBoundingClientRect();
      next.set(id, rect);
      const old = rowPositions.current.get(id);
      if (old && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const dx = old.left - rect.left,
          dy = old.top - rect.top;
        if (dx || dy)
          el.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
            { duration: 160, easing: "ease-out" },
          );
      }
    });
    rowPositions.current = next;
  }, [dragView?.id, dragView?.stage, dragView?.before, tasks, pendingTasks]);
  function dropTarget(x: number, y: number) {
    const element = document.elementFromPoint(x, y);
    const column = element?.closest<HTMLElement>("[data-requirement-stage]");
    if (!column || !boardRef.current?.contains(column)) return { stage: null, before: null };
    const stage = column.dataset.requirementStage as RequirementStage;
    if (element?.closest("[data-requirement-placeholder]") && liveDrag.current?.stage === stage)
      return { stage, before: liveDrag.current.before };
    const rows = [...column.querySelectorAll<HTMLElement>("[data-requirement-id]")];
    const before =
      rows.find((row) => {
        const rect = row.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
      })?.dataset.requirementId ?? null;
    return { stage, before };
  }
  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || settling.current) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
    if (!d.moved) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
    const target = dropTarget(e.clientX, e.clientY);
    const next = { ...d, x: e.clientX - d.offsetX, y: e.clientY - d.offsetY, ...target };
    liveDrag.current = next;
    setDragView(next);
  }
  async function finishDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d?.moved) {
      clearDrag();
      return;
    }
    const view = liveDrag.current;
    const next = view?.stage ? moveRequirement(tasks, d.id, view.stage, view.before) : tasks;
    const destination = boardRef.current
      ?.querySelector<HTMLElement>("[data-requirement-placeholder]")
      ?.getBoundingClientRect();
    settling.current = true;
    try {
      if (
        ghostRef.current &&
        destination &&
        view &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        await ghostRef.current
          .animate(
            [
              { transform: `translate3d(${view.x}px,${view.y}px,0)` },
              { transform: `translate3d(${destination.left}px,${destination.top}px,0)` },
            ],
            { duration: 140, easing: "ease-out", fill: "forwards" },
          )
          .finished.catch(() => {});
      }
      setPendingTasks(next);
      clearDrag();
      if (view?.stage) await save(next);
    } finally {
      setPendingTasks(null);
      settling.current = false;
    }
  }
  function save(nextTasks: ProjectTask[]) {
    const revision = ++saveRevision.current;
    tasksRef.current = nextTasks;
    setTasks(nextTasks);
    busyRef.current = true;
    setBusy(true);
    setError("");
    const run = saveQueue.current.then(async () => {
      try {
        const rows = await invoke<Project[]>("projects_save_content", {
          id: project.id,
          tasks: nextTasks,
          noteIds: project.noteIds ?? [],
        });
        if (revision === saveRevision.current) onChanged(rows);
        return true;
      } catch (e) {
        if (revision === saveRevision.current) setError(getErrorMessage(e));
        return false;
      } finally {
        if (revision === saveRevision.current) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    });
    saveQueue.current = run;
    trackProjectContentSave(run);
    return run;
  }
  async function addTask() {
    const stage: RequirementStage = "backlog";
    if (!text.trim()) return;
    if (
      await save([
        ...tasks,
        { id: crypto.randomUUID(), text: text.trim(), completed: false, stage },
      ])
    )
      setText("");
  }
  async function navigate(next: () => void) {
    if (settling.current || !(await saveQueue.current)) return;
    try {
      await flushProjectNotes();
      next();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }
  return (
    <section
      className="project-list project-page absolute inset-0 z-10 flex flex-col bg-cloud"
      aria-label={`项目管理 ${project.name}`}
    >
      {moveMenu && (
        <div
          ref={moveMenuRef}
          role="menu"
          aria-label="移动需求"
          className="popup-menu project-move-menu fixed z-[9999] p-1.5 bg-cloud border border-paper-deep rounded-lg shadow-lg"
          style={{
            left: Math.max(8, Math.min(moveMenu.x, window.innerWidth - 184)),
            top: Math.max(8, Math.min(moveMenu.y, window.innerHeight - 160)),
          }}
        >
          {stages.map((stage) => (
            <button
              key={stage.value}
              role="menuitem"
              className="project-move-option"
              style={{ "--stage-color": stage.color } as CSSProperties}
              disabled={tasks.some(
                (task) => task.id === moveMenu.id && requirementStage(task) === stage.value,
              )}
              onClick={() => {
                void save(moveRequirement(tasksRef.current, moveMenu.id, stage.value, null));
                setMoveMenu(null);
              }}
            >
              <span aria-hidden="true" />
              移到{stage.label}
            </button>
          ))}
        </div>
      )}
      <nav>
        <button disabled={busy} onClick={() => void navigate(onBack)}>
          <ArrowLeft size={16} />
          返回项目
        </button>
        <span>/</span>
        <span title={project.name}>{project.name}</span>
      </nav>
      <header>
        <h1>{project.name}</h1>
        {tab !== "notes" && (
          <span className="project-save-status" role="status">
            {busy ? "保存中…" : error ? "未保存" : "已保存"}
          </span>
        )}
      </header>
      <div className="project-tabs project-page-tabs project-cycle-tabs">
        <button
          disabled={busy}
          aria-pressed={tab === "tasks"}
          onClick={() => void navigate(() => setTab("tasks"))}
        >
          项目管理
        </button>
        <button
          disabled={busy}
          aria-pressed={tab === "notes"}
          onClick={() => void navigate(() => setTab("notes"))}
        >
          笔记
        </button>
      </div>
      {error && (
        <p className="project-inline-error" role="alert">
          保存失败：{error}，修改未保存。
          <button disabled={busy} onClick={() => void save(tasksRef.current)}>
            重试
          </button>
        </p>
      )}
      <div className={`project-page-body ${tab !== "notes" ? "is-management" : ""}`}>
        {tab === "notes" ? (
          <ProjectNotes project={project} onOpen={onOpenNote} onChanged={onChanged} />
        ) : (
          <>
            <form
              className="project-add-task"
              onSubmit={(e) => {
                e.preventDefault();
                void addTask();
              }}
            >
              <input
                aria-label="新需求"
                placeholder="记录一个需求…"
                maxLength={500}
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229))
                    e.preventDefault();
                }}
              />
              <button aria-label="添加需求" disabled={busy || !text.trim()}>
                <Plus size={16} />
              </button>
            </form>
            <p className="project-board-hint">拖动左侧手柄调整位置，点击文字或空白处编辑。</p>
            {deletedTask && (
              <p className="project-task-undo" role="status">
                已删除需求
                <button
                  onClick={() => {
                    const next = [...tasksRef.current];
                    if (!next.some((task) => task.id === deletedTask.task.id)) {
                      next.splice(Math.min(deletedTask.index, next.length), 0, deletedTask.task);
                      void save(next);
                    }
                    setDeletedTask(null);
                  }}
                >
                  撤销
                </button>
              </p>
            )}
            <div
              ref={boardRef}
              className={`project-requirement-board ${dragView ? "is-drag-active" : ""}`}
              onPointerMove={moveDrag}
              onPointerUp={() => void finishDrag()}
              onPointerCancel={() => {
                if (!settling.current) clearDrag();
              }}
              onLostPointerCapture={() => {
                if (dragRef.current && !settling.current) clearDrag();
              }}
            >
              {stages.map((column) => (
                <section
                  key={column.value}
                  data-requirement-stage={column.value}
                  className="project-stage-column"
                  aria-label={column.label}
                >
                  <header>
                    <column.icon size={15} />
                    <h2>{column.label}</h2>
                    <span>
                      {previewTasks.filter((t) => requirementStage(t) === column.value).length}
                    </span>
                  </header>
                  <div className="project-stage-items">
                    {previewTasks
                      .filter((t) => requirementStage(t) === column.value)
                      .map((task) => {
                        const stage = requirementStage(task);

                        if (dragView?.id === task.id)
                          return (
                            <div
                              key={task.id}
                              data-requirement-placeholder="true"
                              className="project-requirement-placeholder"
                              style={{ height: dragView.height }}
                              aria-hidden="true"
                            />
                          );
                        return (
                          <div
                            key={task.id}
                            data-requirement-id={task.id}
                            onPointerDown={(e) => {
                              if (e.button !== 0 || busyRef.current || settling.current) return;
                              if (!(e.target as HTMLElement).closest(".project-requirement-handle"))
                                return;
                              e.preventDefault();
                              const rect = e.currentTarget.getBoundingClientRect();
                              dragRef.current = {
                                id: task.id,
                                startX: e.clientX,
                                startY: e.clientY,
                                x: rect.left,
                                y: rect.top,
                                offsetX: e.clientX - rect.left,
                                offsetY: e.clientY - rect.top,
                                width: rect.width,
                                height: rect.height,
                                moved: false,
                                stage: requirementStage(task),
                                before: null,
                              };
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setMoveMenu({ id: task.id, x: e.clientX, y: e.clientY });
                            }}
                            onClick={(e) => {
                              if (
                                settling.current ||
                                (e.target as HTMLElement).closest("input,button")
                              )
                                return;
                              const input =
                                e.currentTarget.querySelector<HTMLInputElement>("input");
                              input?.focus();
                              input?.setSelectionRange(input.value.length, input.value.length);
                            }}
                            className={`project-requirement stage-${stage}`}
                          >
                            <div className="project-requirement-name">
                              <button
                                className="project-requirement-handle"
                                title="拖动调整顺序或阶段"
                                aria-label={`拖动需求 ${task.text}`}
                                disabled={busy}
                              >
                                <GripVertical size={14} />
                              </button>
                              <input
                                className="project-requirement-input"
                                aria-label="需求名称"
                                title={task.text}
                                maxLength={500}
                                value={nameDrafts[task.id] ?? task.text}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setNameDrafts((old) => ({ ...old, [task.id]: value }));
                                  if (value.trim())
                                    void save(
                                      tasksRef.current.map((item) =>
                                        item.id === task.id ? { ...item, text: value } : item,
                                      ),
                                    );
                                }}
                                onBlur={() =>
                                  setNameDrafts((old) => {
                                    const next = { ...old };
                                    delete next[task.id];
                                    return next;
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (
                                    e.key === "Enter" &&
                                    !e.nativeEvent.isComposing &&
                                    e.keyCode !== 229
                                  )
                                    e.currentTarget.blur();
                                }}
                              />
                              <button
                                className="project-requirement-delete"
                                title="删除需求"
                                aria-label={`删除需求 ${task.text}`}
                                onClick={() => {
                                  const index = tasksRef.current.findIndex(
                                    (item) => item.id === task.id,
                                  );
                                  if (index < 0) return;
                                  setDeletedTask({ task: tasksRef.current[index], index });
                                  setMoveMenu(null);
                                  void save(tasksRef.current.filter((item) => item.id !== task.id));
                                }}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    {!previewTasks.some((t) => requirementStage(t) === column.value) && (
                      <p className="project-stage-empty">{"暂无需求"}</p>
                    )}
                  </div>
                </section>
              ))}
            </div>
            {dragView &&
              createPortal(
                <div
                  ref={ghostRef}
                  className="project-requirement-floating"
                  style={{
                    width: dragView.width,
                    minHeight: dragView.height,
                    transform: `translate3d(${dragView.x}px,${dragView.y}px,0)`,
                  }}
                  aria-hidden="true"
                >
                  <GripVertical size={14} />
                  <span>{tasks.find((t) => t.id === dragView.id)?.text}</span>
                </div>,
                document.body,
              )}
          </>
        )}
      </div>
    </section>
  );
}
