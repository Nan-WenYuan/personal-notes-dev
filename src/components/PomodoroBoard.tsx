import { useEffect, useRef, useState, type CSSProperties } from "react";
import { TimerReset } from "lucide-react";
import {
  clockText,
  dateKey,
  monthCells,
  type TimerMode,
  type FocusRecord,
} from "../features/pomodoro/model";
import type { usePomodoro } from "../features/pomodoro/usePomodoro";
import { loadQuadrants, retryQuadrants } from "../features/pomodoro/quadrantStorage";
import "./PomodoroBoard.css";
export function TimerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M9 2h6M12 2v3M19 5l2 2M12 9v5" />
      <circle cx="12" cy="14" r="8" />
    </svg>
  );
}
const modes: { mode: TimerMode; label: string }[] = [
  { mode: "focus", label: "专注" },
  { mode: "short", label: "短休息" },
  { mode: "long", label: "长休息" },
];
export function PomodoroBoard({ timer }: { timer: ReturnType<typeof usePomodoro> }) {
  const [tasks, setTasks] = useState<{ id: string; text: string; completed: boolean }[]>([]);
  const [tasksError, setTasksError] = useState("");
  const [tasksReady, setTasksReady] = useState(false);
  const loadTasks = () => {
    setTasksReady(false);
    setTasksError("");
    void loadQuadrants<typeof tasks>()
      .then((value) => {
        setTasks(value);
        setTasksReady(true);
      })
      .catch(() => setTasksError("任务加载失败，请重试"));
  };
  useEffect(loadTasks, []);
  const today = dateKey(new Date(timer.now));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<FocusRecord | null>(null);
  const [formError, setFormError] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settingsOpen && !editingRecord) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = modalRef.current;
    const focusable = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSettingsOpen(false);
        setEditingRecord(null);
      } else if (event.key === "Tab") {
        const items = focusable();
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (
          index < 0 ||
          (!event.shiftKey && index === items.length - 1) ||
          (event.shiftKey && index === 0)
        ) {
          event.preventDefault();
          (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, [settingsOpen, editingRecord]);
  const minutes = (list: FocusRecord[]) =>
    Math.round(list.reduce((sum, record) => sum + record.seconds, 0) / 60);
  const dateTimeInput = (value: number) => {
    const date = new Date(value);
    return `${dateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };
  const [selected, setSelected] = useState(today);
  const datePicker = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const counts = new Map<string, number>();
  for (const record of timer.state.records) {
    const key = dateKey(new Date(record.completedAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const records = timer.state.records
    .filter((r) => dateKey(new Date(r.completedAt)) === selected)
    .sort((a, b) => b.completedAt - a.completedAt);
  const todayCount = counts.get(today) ?? 0;
  const selectedDate = new Date(`${selected}T12:00:00`);
  const time = (value: number) =>
    new Date(value).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return (
    <section className="pomodoro-board absolute inset-0 z-10 bg-paper" aria-label="番茄钟">
      <header>
        <div>
          <h1>番茄钟</h1>
          <p>专注当下，积累每一天</p>
        </div>
        <div className="pomodoro-header-actions">
          <span>{!timer.ready ? "正在加载…" : timer.state.endsAt ? "计时中" : ""}</span>
          <button
            disabled={!timer.ready}
            onClick={() => {
              setFormError("");
              setSettingsOpen(true);
            }}
            aria-label="番茄钟设置"
          >
            设置
          </button>
        </div>
      </header>
      {timer.error && (
        <div role="alert" className="pomodoro-error">
          {timer.error}
          {timer.ready && <button onClick={timer.retry}>重试保存</button>}
        </div>
      )}
      <div className="pomodoro-timer-area">
        <div className="pomodoro-timer">
          <div className="pomodoro-modes" role="group" aria-label="计时模式">
            {modes.map(({ mode, label }) => (
              <button
                key={mode}
                disabled={!timer.ready}
                aria-pressed={timer.state.mode === mode}
                onClick={() => {
                  if (
                    mode !== timer.state.mode &&
                    (timer.state.startedAt === null ||
                      window.confirm("切换模式会放弃当前未完成的计时，继续吗？"))
                  )
                    timer.reset(mode);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className="pomodoro-ring"
            style={
              {
                "--progress": `${Math.max(0, Math.min(1, timer.remaining / timer.state.sessionSeconds)) * 360}deg`,
              } as CSSProperties
            }
          >
            <svg className="pomodoro-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
              <circle className="pomodoro-ring-track" cx="50" cy="50" r="48" />
              <circle
                className="pomodoro-ring-progress"
                cx="50"
                cy="50"
                r="48"
                pathLength="100"
                strokeDasharray={`${Math.max(0, Math.min(1, timer.remaining / timer.state.sessionSeconds)) * 100} 100`}
              />
            </svg>
            <div>
              <strong>{clockText(timer.remaining)}</strong>
              <span>
                {timer.state.endsAt
                  ? timer.state.mode === "focus"
                    ? "保持专注"
                    : "放松一下"
                  : timer.remaining === 0
                    ? "本轮已完成"
                    : timer.state.sessionId
                      ? "已暂停"
                      : "准备开始"}
              </span>
            </div>
          </div>
          <div className="pomodoro-controls">
            <button className="pomodoro-start" disabled={!timer.ready} onClick={timer.toggle}>
              {timer.state.endsAt
                ? "暂停"
                : timer.state.sessionId
                  ? "继续"
                  : timer.state.mode === "focus"
                    ? "开始专注"
                    : "开始休息"}
            </button>
            <button
              className="pomodoro-reset"
              disabled={!timer.ready}
              title="重置计时"
              aria-label="重置计时"
              onClick={() => {
                if (
                  timer.state.startedAt === null ||
                  window.confirm("重置会放弃当前未完成的计时，继续吗？")
                )
                  timer.reset();
              }}
            >
              <TimerReset size={20} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>
          <label className="pomodoro-task-picker">
            <span>专注任务</span>
            <select
              aria-label="专注任务"
              disabled={!timer.ready || !tasksReady}
              value={timer.state.activeTask?.id ?? ""}
              onChange={(event) => {
                const task = tasks.find((t) => t.id === event.target.value);
                timer.selectTask(task ? { id: task.id, title: task.text } : null);
              }}
            >
              <option value="">不关联任务</option>
              {tasks
                .filter((t) => !t.completed)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.text}
                  </option>
                ))}
            </select>
          </label>
          {tasksError && (
            <div className="pomodoro-task-load-error" role="alert">
              {tasksError}
              <button
                onClick={() => {
                  void retryQuadrants()
                    .then(loadTasks)
                    .catch(() => setTasksError("任务保存失败，请检查磁盘后重试"));
                }}
              >
                重试
              </button>
            </div>
          )}
        </div>
        <div className="pomodoro-summary">
          <div>
            <TimerIcon size={23} />
            <p>
              今日完成
              <strong>
                {todayCount}
                <small> 个</small>
              </strong>
            </p>
          </div>
          <div>
            <span className="pomodoro-stat-icon">◷</span>
            <p>
              专注时长
              <strong>
                {minutes(
                  timer.state.records.filter(
                    (record) => dateKey(new Date(record.completedAt)) === today,
                  ),
                )}
                <small> 分钟</small>
              </strong>
            </p>
          </div>
        </div>
      </div>
      <div className="pomodoro-history">
        <section className="pomodoro-calendar">
          <header>
            <h2>专注日历</h2>
            <div>
              <button
                aria-label="上个月"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              >
                ‹
              </button>
              <span className="pomodoro-date-jump">
                <button
                  aria-label="快速选择日期"
                  title="选择日期"
                  onClick={() => datePicker.current?.showPicker()}
                >
                  {month.getFullYear()}年{month.getMonth() + 1}月
                </button>
                <input
                  ref={datePicker}
                  type="date"
                  aria-label="跳转日期"
                  tabIndex={-1}
                  value={selected}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) return;
                    const date = new Date(`${value}T12:00:00`);
                    if (!Number.isFinite(date.getTime())) return;
                    setSelected(value);
                    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
                  }}
                />
              </span>
              <button
                aria-label="下个月"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              >
                ›
              </button>
              <button
                onClick={() => {
                  setMonth(
                    new Date(new Date(timer.now).getFullYear(), new Date(timer.now).getMonth(), 1),
                  );
                  setSelected(today);
                }}
              >
                今天
              </button>
            </div>
          </header>
          <div className="pomodoro-week">
            {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="pomodoro-days">
            {monthCells(month.getFullYear(), month.getMonth()).map((day, i) => {
              const key = day ? dateKey(new Date(month.getFullYear(), month.getMonth(), day)) : "";
              const count = counts.get(key) ?? 0;
              return day ? (
                <button
                  key={i}
                  aria-label={`${key}，完成${count}个番茄`}
                  aria-pressed={selected === key}
                  data-today={key === today || undefined}
                  onClick={() => setSelected(key)}
                >
                  <span>{day}</span>
                  {count > 0 && (
                    <small>
                      <TimerIcon size={11} />
                      {count}
                    </small>
                  )}
                </button>
              ) : (
                <span key={i} />
              );
            })}
          </div>
        </section>
        <section className="pomodoro-day-detail">
          <h2>
            {selectedDate.toLocaleDateString("zh-CN", {
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </h2>
          <p>
            完成 {records.length} 个番茄 · {minutes(records)} 分钟
          </p>
          <div className="pomodoro-records">
            {records.length === 0 ? (
              <div className="pomodoro-empty">
                这一天还没有完成的番茄
                <br />
                <span>完成一次专注，就会自动记录在这里</span>
              </div>
            ) : (
              records.map((record) => (
                <div key={record.id} className="pomodoro-record">
                  <TimerIcon size={19} />
                  <div>
                    <span>
                      {time(record.startedAt)} – {time(record.completedAt)}
                    </span>
                    <strong>{record.taskTitle || "专注完成"}</strong>
                  </div>
                  <small>{record.seconds / 60} 分钟</small>
                  <div className="pomodoro-record-actions">
                    <button
                      title="修改记录"
                      aria-label={`修改记录 ${time(record.completedAt)}`}
                      onClick={() => {
                        setFormError("");
                        setEditingRecord(record);
                      }}
                    >
                      编辑
                    </button>
                    <button
                      title="删除记录"
                      aria-label={`删除记录 ${time(record.completedAt)}`}
                      onClick={() => {
                        if (window.confirm("删除这条专注记录？当天数量和时长会同步更新。"))
                          timer.changeRecord(null, record.id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
      {settingsOpen && (
        <div
          ref={modalRef}
          className="pomodoro-modal"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <form
            className="pomodoro-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="番茄钟设置"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const settings = {
                focusMinutes: Number(data.get("focus")),
                shortMinutes: Number(data.get("short")),
                longMinutes: Number(data.get("long")),
                longEvery: Number(data.get("rounds")),
                autoCycle: data.has("auto"),
                sound: data.has("sound"),
                notification: data.has("notification"),
              };
              if (
                ![
                  settings.focusMinutes,
                  settings.shortMinutes,
                  settings.longMinutes,
                  settings.longEvery,
                ].every(Number.isInteger)
              ) {
                setFormError("请输入整数时长");
                return;
              }
              timer.configure(settings);
              setSettingsOpen(false);
            }}
          >
            <header>
              <h2>番茄钟设置</h2>
              <button type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}>
                ×
              </button>
            </header>
            <div className="pomodoro-settings-fields">
              {[
                {
                  key: "focus",
                  label: "专注时长",
                  value: timer.state.settings.focusMinutes,
                  max: 180,
                },
                {
                  key: "short",
                  label: "短休息",
                  value: timer.state.settings.shortMinutes,
                  max: 60,
                },
                { key: "long", label: "长休息", value: timer.state.settings.longMinutes, max: 60 },
                {
                  key: "rounds",
                  label: "长休息间隔",
                  value: timer.state.settings.longEvery,
                  max: 12,
                },
              ].map((field) => (
                <label key={field.key}>
                  {field.label}
                  <span>
                    <input
                      name={field.key}
                      type="number"
                      min="1"
                      max={field.max}
                      step="1"
                      required
                      defaultValue={field.value}
                    />
                    {field.key === "rounds" ? "轮" : "分钟"}
                  </span>
                </label>
              ))}
            </div>
            <label className="pomodoro-check">
              <input type="checkbox" name="auto" defaultChecked={timer.state.settings.autoCycle} />
              自动轮换专注和休息
            </label>
            <p>达到设定轮数后进入长休息。关闭程序会暂停，最小化到托盘继续计时。</p>
            <label className="pomodoro-check">
              <input type="checkbox" name="sound" defaultChecked={timer.state.settings.sound} />
              完成时播放提醒音
            </label>
            <label className="pomodoro-check">
              <input
                type="checkbox"
                name="notification"
                defaultChecked={timer.state.settings.notification}
              />
              发送系统通知
            </label>
            <button
              type="button"
              className="pomodoro-test-alert"
              onClick={() => {
                const form = document.querySelector<HTMLFormElement>(".pomodoro-dialog");
                const data = form ? new FormData(form) : null;
                void import("@tauri-apps/api/core")
                  .then(({ invoke }) =>
                    invoke("pomodoro_alert", {
                      focus: true,
                      sound: data?.has("sound") ?? true,
                      notification: data?.has("notification") ?? true,
                    }),
                  )
                  .catch(() => setFormError("系统提醒发送失败，请检查系统通知设置"));
              }}
            >
              试听提醒
            </button>
            <p>修改时长从下一次计时生效，当前专注记录保留原时长。</p>
            {formError && <p role="alert">{formError}</p>}
            <footer>
              <button type="button" onClick={() => setSettingsOpen(false)}>
                取消
              </button>
              <button type="submit">保存设置</button>
            </footer>
          </form>
        </div>
      )}
      {editingRecord && (
        <div ref={modalRef} className="pomodoro-modal">
          <form
            className="pomodoro-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="修改专注记录"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const seconds = Number(data.get("minutes")) * 60;
              const completedAt = new Date(String(data.get("completed"))).getTime();
              if (
                !Number.isFinite(completedAt) ||
                completedAt > timer.now ||
                !Number.isInteger(seconds) ||
                seconds < 60 ||
                seconds > 10800
              ) {
                setFormError("请输入有效的过去日期和时长");
                return;
              }
              timer.changeRecord(
                { ...editingRecord, seconds, completedAt, startedAt: completedAt - seconds * 1000 },
                editingRecord.id,
              );
              setEditingRecord(null);
            }}
          >
            <header>
              <h2>修改专注记录</h2>
              <button
                type="button"
                aria-label="关闭记录编辑"
                onClick={() => setEditingRecord(null)}
              >
                ×
              </button>
            </header>
            <label className="pomodoro-edit-field">
              完成时间
              <input
                name="completed"
                type="datetime-local"
                required
                defaultValue={dateTimeInput(editingRecord.completedAt)}
              />
            </label>
            <label className="pomodoro-edit-field">
              专注分钟
              <input
                name="minutes"
                type="number"
                min="1"
                max="180"
                step="1"
                required
                defaultValue={editingRecord.seconds / 60}
              />
            </label>
            {formError && <p role="alert">{formError}</p>}
            <footer>
              <button type="button" onClick={() => setEditingRecord(null)}>
                取消
              </button>
              <button type="submit">保存记录</button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
