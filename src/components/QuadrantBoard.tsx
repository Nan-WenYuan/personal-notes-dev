import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Archive, ArrowLeft, RotateCcw, Trash2, Play, Pause } from "lucide-react";
import { clockText } from "../features/pomodoro/model";
import { taskProgress } from "../features/pomodoro/taskProgress";
import "./QuadrantBoard.css";
import "./PomodoroBoard.css";
import standardTomato from "../assets/tomatoes/standard.png";
import actionTomato from "../assets/tomato-action-v2.png";
import standardGold from "../assets/tomatoes/standard-gold.png";
import { summarizeTask, tomatoLabels } from "../features/pomodoro/taskSummary";
import type { usePomodoro } from "../features/pomodoro/usePomodoro";
import { loadQuadrants, saveQuadrants, retryQuadrants } from "../features/pomodoro/quadrantStorage";

interface Task {
  id: string;
  text: string;
  quadrant: number;
  completed: boolean;
  completedAt?: number;
}
const quadrants = [
  { title: "重要且紧急", hint: "立即处理", color: "#cb6868" },
  { title: "重要不紧急", hint: "计划安排", color: "#c29846" },
  { title: "不重要但紧急", hint: "尽快处理或委托", color: "#648fc4" },
  { title: "不重要不紧急", hint: "有空再做", color: "#719781" },
];

export function QuadrantBoard({
  timer,
  onStartTask,
}: {
  timer: ReturnType<typeof usePomodoro>;
  onStartTask: (task: { id: string; title: string }, minutes?: number) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [drafts, setDrafts] = useState(["", "", "", ""]);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [focusMinutes, setFocusMinutes] = useState(timer.state.settings.focusMinutes);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("正在加载…");
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [deleted, setDeleted] = useState<{ task: Task; index: number } | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [completedUndo, setCompletedUndo] = useState<Task | null>(null);
  useEffect(() => {
    if (!completedUndo) return;
    const timeout = window.setTimeout(() => setCompletedUndo(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [completedUndo]);
  const current = useRef(tasks);
  const longPressTimer = useRef<number | null>(null);
  const [holdingTask, setHoldingTask] = useState<string | null>(null);
  const longPressHandled = useRef(false);
  const clearLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    setHoldingTask(null);
  };
  useEffect(() => clearLongPress, []);
  const revision = useRef(0);
  useEffect(() => {
    let cancelled = false;
    loadQuadrants<Task[]>()
      .then((value) => {
        if (cancelled) return;
        current.current = value;
        setTasks(value);
        setReady(true);
        setStatus("已保存");
      })
      .catch(() => {
        if (!cancelled) {
          setError("加载失败，请重新打开四象限");
          setStatus("加载失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);
  const save = (next: Task[]) => {
    const version = ++revision.current;
    current.current = next;
    setTasks(next);
    setStatus("保存中…");
    setError("");
    // Writes remain ordered and finish even when the user switches to a note.
    void saveQuadrants(next)
      .then(() => {
        if (revision.current === version) setStatus("已保存");
      })
      .catch(() => {
        if (revision.current === version) {
          setError("保存失败，请重试");
          setStatus("未保存");
        }
      });
  };
  return (
    <section
      className="quadrant-board absolute inset-0 z-10 bg-paper flex flex-col"
      aria-label="四象限任务面板"
    >
      {focusTask && (
        <div
          className="pomodoro-modal"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setFocusTask(null);
            }
            if (event.key === "Tab") {
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>("button, input"),
              );
              const first = controls[0],
                last = controls[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFocusTask(null);
          }}
        >
          <form
            className="pomodoro-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="选择专注时长"
            onSubmit={(event) => {
              event.preventDefault();
              if (!Number.isInteger(focusMinutes) || focusMinutes < 1 || focusMinutes > 180) return;
              onStartTask({ id: focusTask.id, title: focusTask.text }, focusMinutes);
              setFocusTask(null);
            }}
          >
            <header>
              <h2>选择专注时长</h2>
              <button type="button" aria-label="关闭时长选择" onClick={() => setFocusTask(null)}>
                ×
              </button>
            </header>
            <p>{focusTask.text}</p>
            <div className="quadrant-focus-presets">
              {[5, 15, 25, 45].map((minutes) => (
                <button
                  type="button"
                  key={minutes}
                  aria-pressed={focusMinutes === minutes}
                  onClick={() => setFocusMinutes(minutes)}
                >
                  {minutes} 分钟
                </button>
              ))}
            </div>
            <label className="pomodoro-edit-field">
              自定义分钟
              <input
                autoFocus
                type="number"
                required
                min="1"
                max="180"
                step="1"
                value={focusMinutes}
                onChange={(event) => setFocusMinutes(Number(event.target.value))}
              />
            </label>
            <p>仅用于本次专注，不改变默认时长。</p>
            <footer>
              <button type="button" onClick={() => setFocusTask(null)}>
                取消
              </button>
              <button type="submit">开始专注</button>
            </footer>
          </form>
        </div>
      )}
      <header className="px-6 py-5 border-b border-paper-deep/30 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">四象限</h1>
          <p className="text-xs text-ink-ghost mt-1">按重要与紧急安排任务</p>
        </div>
        <div className="quadrant-header-actions">
          <span className="text-xs text-ink-ghost">{status}</span>
          <button onClick={() => setArchiveOpen(!archiveOpen)}>
            {archiveOpen ? <ArrowLeft size={15} /> : <Archive size={15} />}
            {archiveOpen
              ? "返回四象限"
              : `已完成 (${tasks.filter((task) => task.completed).length})`}
          </button>
        </div>
      </header>
      {completedUndo && (
        <div className="quadrant-undo" role="status">
          已完成并归档“{completedUndo.text}”
          <button
            onClick={() => {
              save(
                current.current.map((task) =>
                  task.id === completedUndo.id
                    ? { ...task, completed: false, completedAt: undefined }
                    : task,
                ),
              );
              setCompletedUndo(null);
            }}
          >
            撤销完成
          </button>
          <button aria-label="关闭完成提示" onClick={() => setCompletedUndo(null)}>
            ×
          </button>
        </div>
      )}
      {deleted && (
        <div className="quadrant-undo" role="status">
          已删除“{deleted.task.text || "空任务"}”
          <button
            onClick={() => {
              const next = [...current.current];
              next.splice(Math.min(deleted.index, next.length), 0, deleted.task);
              save(next);
              setDeleted(null);
            }}
          >
            撤销删除
          </button>
          <button aria-label="关闭删除提示" onClick={() => setDeleted(null)}>
            ×
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="px-6 py-2 text-sm text-red-400">
          {error}
          {ready && (
            <button className="ml-3 underline cursor-pointer" onClick={() => save(current.current)}>
              重试保存
            </button>
          )}
          {!ready && (
            <button
              className="ml-3 underline cursor-pointer"
              onClick={() => {
                void retryQuadrants()
                  .then(() => setLoadAttempt((n) => n + 1))
                  .catch(() => setError("保存仍失败，请检查磁盘后重试"));
              }}
            >
              重试加载
            </button>
          )}
        </div>
      )}
      {archiveOpen ? (
        <div className="quadrant-archive flex-1 min-h-0 overflow-auto">
          <h2>已完成任务</h2>
          <p className="quadrant-archive-hint">恢复后回到原象限，保留全部番茄记录。</p>
          {!tasks.some((task) => task.completed) && (
            <p className="quadrant-empty">暂无已完成任务</p>
          )}
          {[
            ...new Set(
              tasks
                .filter((task) => task.completed)
                .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
                .map((task) =>
                  task.completedAt
                    ? new Date(task.completedAt).toLocaleDateString("zh-CN")
                    : "历史完成任务",
                ),
            ),
          ].map((day) => (
            <section key={day}>
              <h3>{day}</h3>
              {tasks
                .filter(
                  (task) =>
                    task.completed &&
                    (task.completedAt
                      ? new Date(task.completedAt).toLocaleDateString("zh-CN")
                      : "历史完成任务") === day,
                )
                .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
                .map((task) => {
                  const groups = summarizeTask(timer.state.records, task.id);
                  const count = groups.reduce((sum, group) => sum + group.count, 0);
                  const minutes = Math.round(
                    groups.reduce((sum, group) => sum + group.seconds, 0) / 60,
                  );
                  return (
                    <div className="quadrant-archive-row" key={task.id}>
                      <div>
                        <strong>{task.text}</strong>
                        <p>
                          {quadrants[task.quadrant]?.title} · {count} 个番茄 · {minutes} 分钟
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          save(
                            current.current.map((item) =>
                              item.id === task.id
                                ? { ...item, completed: false, completedAt: undefined }
                                : item,
                            ),
                          );
                          setCompletedUndo(null);
                        }}
                      >
                        <RotateCcw size={14} />
                        恢复
                      </button>
                      <button
                        aria-label={`删除任务：${task.text}`}
                        onClick={() => {
                          setDeleted({
                            task,
                            index: current.current.findIndex((item) => item.id === task.id),
                          });
                          save(current.current.filter((item) => item.id !== task.id));
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
            </section>
          ))}
        </div>
      ) : (
        <div className="quadrant-grid flex-1 min-h-0 overflow-auto grid grid-cols-1 md:grid-cols-2 auto-rows-fr">
          {quadrants.map((quadrant, index) => {
            const list = tasks.filter((task) => task.quadrant === index && !task.completed);
            return (
              <section
                key={index}
                style={{ "--quadrant-color": quadrant.color } as CSSProperties}
                className="quadrant-card flex flex-col overflow-hidden"
              >
                <header
                  className="px-4 py-3 border-b border-paper-deep/30 flex items-center justify-between"
                  style={{ borderTop: `3px solid ${quadrant.color}` }}
                >
                  <div>
                    <h2 className="text-sm font-medium text-ink">{quadrant.title}</h2>
                    <p className="text-[11px] text-ink-ghost mt-0.5">{quadrant.hint}</p>
                  </div>
                  <span className="text-xs text-ink-ghost">
                    {list.filter((task) => !task.completed).length}
                  </span>
                </header>
                <div className="quadrant-tasks flex-1">
                  {!list.length && <p className="quadrant-empty">暂无任务</p>}
                  {list.map((task) => {
                    const sessionProgress = taskProgress(timer.state, timer.remaining, task.id);
                    const active = sessionProgress !== null;
                    const resting =
                      timer.state.mode !== "focus" &&
                      !!timer.state.sessionId &&
                      timer.state.sessionTask?.id === task.id;
                    const progress = sessionProgress ?? 0;
                    const groups = summarizeTask(timer.state.records, task.id);
                    const count = groups.reduce((sum, group) => sum + group.count, 0);
                    const minutes = Math.round(
                      groups.reduce((sum, group) => sum + group.seconds, 0) / 60,
                    );
                    return (
                      <div
                        key={task.id}
                        className={`quadrant-task-row group flex items-start gap-2 rounded-lg px-1 py-1.5 hover:bg-paper-deep/15 ${active ? "is-focusing" : ""}`}
                        onClick={(event) => {
                          const target = event.target as HTMLElement;
                          if (target.closest("button, input, a")) return;
                          const input = event.currentTarget.querySelector<HTMLInputElement>(
                            'input[aria-label="任务内容"]',
                          );
                          if (!input) return;
                          input.focus();
                          input.setSelectionRange(input.value.length, input.value.length);
                        }}
                      >
                        {active && (
                          <div
                            className="quadrant-task-progress"
                            style={{ width: `${progress}%` }}
                            role="progressbar"
                            aria-label="本轮专注进度"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(progress)}
                          />
                        )}
                        <input
                          aria-label={`完成任务：${task.text}`}
                          type="checkbox"
                          checked={task.completed}
                          className="mt-1 accent-bamboo cursor-pointer"
                          onChange={() => {
                            if (!task.completed && !timer.finishTask(task.id)) return;
                            setDeleted(null);
                            setCompletedUndo(task);
                            save(
                              current.current.map((item) =>
                                item.id === task.id
                                  ? { ...item, completed: true, completedAt: Date.now() }
                                  : item,
                              ),
                            );
                          }}
                        />
                        <div className="quadrant-task-content">
                          <input
                            aria-label="任务内容"
                            title={task.text}
                            value={task.text}
                            className={`flex-1 min-w-0 bg-transparent text-sm text-ink outline-none ${task.completed ? "line-through opacity-45" : ""}`}
                            onChange={(event) => {
                              timer.renameTask(task.id, event.target.value);
                              save(
                                current.current.map((item) =>
                                  item.id === task.id
                                    ? { ...item, text: event.target.value }
                                    : item,
                                ),
                              );
                            }}
                          />
                          {(active || resting) && (
                            <div className="quadrant-focus-status">
                              <span>
                                {resting ? "休息 · " : timer.state.endsAt === null ? "暂停 · " : ""}
                                {clockText(timer.remaining)}
                              </span>
                            </div>
                          )}
                          {count > 0 && (
                            <div
                              className={`quadrant-task-tomatoes quadrant-tomato-count ${count >= 10 ? "is-high" : count >= 5 ? "is-gold" : ""}`}
                              role="img"
                              aria-label={`已完成 ${count} 个番茄，累计 ${minutes} 分钟`}
                              title={`已完成 ${count} 个番茄 · 累计 ${minutes} 分钟 · ${groups.map((group) => `${tomatoLabels[group.kind]}：${group.detail}`).join("；")}`}
                            >
                              <img
                                src={count >= 5 ? standardGold : standardTomato}
                                width="16"
                                height="16"
                                alt=""
                                aria-hidden="true"
                              />
                              <span>{count}</span>
                            </div>
                          )}
                        </div>
                        {!task.completed && (
                          <button
                            className="quadrant-pomo-start"
                            disabled={!timer.ready || !task.text.trim()}
                            aria-label={`${active ? (timer.state.endsAt === null ? "继续专注" : "暂停专注") : "开始专注"}：${task.text}`}
                            title={
                              active
                                ? `${timer.state.endsAt === null ? "短按继续" : "短按暂停"}，长按取消本轮`
                                : "开始番茄专注"
                            }
                            onPointerDown={(event) => {
                              if (event.button !== 0) return;
                              clearLongPress();
                              longPressHandled.current = false;
                              if (!active) return;
                              setHoldingTask(task.id);
                              longPressTimer.current = window.setTimeout(() => {
                                longPressHandled.current = true;
                                clearLongPress();
                                timer.reset("focus");
                              }, 800);
                            }}
                            onPointerUp={clearLongPress}
                            onPointerLeave={clearLongPress}
                            onPointerCancel={clearLongPress}
                            onContextMenu={(event) => event.preventDefault()}
                            onClick={() => {
                              if (longPressHandled.current) {
                                longPressHandled.current = false;
                                return;
                              }
                              if (active) {
                                timer.toggle();
                              } else if (
                                timer.state.mode === "focus" &&
                                timer.state.sessionId &&
                                timer.state.sessionTask?.id === task.id
                              ) {
                                onStartTask({ id: task.id, title: task.text });
                              } else {
                                setFocusMinutes(timer.state.settings.focusMinutes);
                                setFocusTask(task);
                              }
                            }}
                          >
                            <img
                              src={actionTomato}
                              width="22"
                              height="22"
                              alt=""
                              aria-hidden="true"
                            />
                            <span className="quadrant-tomato-action" aria-hidden="true">
                              {active && timer.state.endsAt !== null ? (
                                <Pause size={10} fill="currentColor" />
                              ) : (
                                <Play size={10} fill="currentColor" />
                              )}
                            </span>
                            {holdingTask === task.id && (
                              <span className="quadrant-hold-ring" aria-hidden="true" />
                            )}
                          </button>
                        )}
                        <button
                          aria-label={`删除任务：${task.text}`}
                          title="删除任务"
                          className="text-ink-ghost opacity-50 hover:opacity-100 hover:text-red-400 cursor-pointer px-1"
                          onClick={() => {
                            if (timer.finishTask(task.id)) {
                              setDeleted({
                                task,
                                index: current.current.findIndex((item) => item.id === task.id),
                              });
                              setCompletedUndo(null);
                              save(current.current.filter((item) => item.id !== task.id));
                            }
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
                <form
                  className="m-3 mt-0 flex gap-2 border-t border-paper-deep/30 pt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = drafts[index].trim();
                    if (!text || !ready) return;
                    save([
                      ...current.current,
                      { id: crypto.randomUUID(), text, quadrant: index, completed: false },
                    ]);
                    setDrafts((value) => value.map((draft, i) => (i === index ? "" : draft)));
                  }}
                >
                  <input
                    aria-label={`添加${quadrant.title}任务`}
                    disabled={!ready}
                    value={drafts[index]}
                    onChange={(event) =>
                      setDrafts((value) =>
                        value.map((draft, i) => (i === index ? event.target.value : draft)),
                      )
                    }
                    placeholder="添加任务…"
                    className="flex-1 min-w-0 text-sm bg-transparent text-ink placeholder:text-ink-ghost outline-none"
                  />
                  <button
                    type="submit"
                    aria-label={`添加${quadrant.title}任务按钮`}
                    disabled={!ready || !drafts[index].trim()}
                    className="cursor-pointer disabled:opacity-30"
                  >
                    +
                  </button>
                </form>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
