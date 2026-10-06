import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CSSProperties } from "react";
import "./QuadrantBoard.css";

interface Task {
  id: string;
  text: string;
  quadrant: number;
  completed: boolean;
}
const quadrants = [
  { title: "重要且紧急", hint: "立即处理", color: "#cb6868" },
  { title: "重要不紧急", hint: "计划安排", color: "#c29846" },
  { title: "不重要但紧急", hint: "尽快处理或委托", color: "#648fc4" },
  { title: "不重要不紧急", hint: "有空再做", color: "#719781" },
];

export function QuadrantBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [drafts, setDrafts] = useState(["", "", "", ""]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("正在加载…");
  const [error, setError] = useState("");
  const queue = useRef(Promise.resolve());
  const current = useRef(tasks);
  const revision = useRef(0);
  useEffect(() => {
    let cancelled = false;
    invoke<Task[]>("quadrants_load")
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
  }, []);
  const save = (next: Task[]) => {
    const version = ++revision.current;
    current.current = next;
    setTasks(next);
    setStatus("保存中…");
    setError("");
    // Writes remain ordered and finish even when the user switches to a note.
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        await invoke("quadrants_save", { tasks: next });
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
      <header className="px-6 py-5 border-b border-paper-deep/30 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">四象限</h1>
          <p className="text-xs text-ink-ghost mt-1">按重要与紧急安排任务</p>
        </div>
        <span className="text-xs text-ink-ghost">{status}</span>
      </header>
      {error && (
        <div role="alert" className="px-6 py-2 text-sm text-red-400">
          {error}
          {ready && (
            <button className="ml-3 underline cursor-pointer" onClick={() => save(current.current)}>
              重试保存
            </button>
          )}
        </div>
      )}
      <div className="quadrant-grid flex-1 min-h-0 overflow-auto grid grid-cols-1 md:grid-cols-2 auto-rows-fr">
        {quadrants.map((quadrant, index) => {
          const list = tasks.filter((task) => task.quadrant === index);
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
              <div className="quadrant-tasks flex-1 space-y-1">
                {!list.length && <p className="quadrant-empty">暂无任务</p>}
                {list.map((task) => (
                  <div
                    key={task.id}
                    className="group flex items-start gap-2 rounded-lg px-1 py-1.5 hover:bg-paper-deep/15"
                  >
                    <input
                      aria-label={`完成任务：${task.text}`}
                      type="checkbox"
                      checked={task.completed}
                      className="mt-1 accent-bamboo cursor-pointer"
                      onChange={() =>
                        save(
                          current.current.map((item) =>
                            item.id === task.id ? { ...item, completed: !item.completed } : item,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label="任务内容"
                      value={task.text}
                      className={`flex-1 min-w-0 bg-transparent text-sm text-ink outline-none ${task.completed ? "line-through opacity-45" : ""}`}
                      onChange={(event) =>
                        save(
                          current.current.map((item) =>
                            item.id === task.id ? { ...item, text: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <button
                      aria-label={`删除任务：${task.text}`}
                      title="删除任务"
                      className="text-ink-ghost opacity-50 hover:opacity-100 hover:text-red-400 cursor-pointer px-1"
                      onClick={() => save(current.current.filter((item) => item.id !== task.id))}
                    >
                      ×
                    </button>
                  </div>
                ))}
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
    </section>
  );
}
