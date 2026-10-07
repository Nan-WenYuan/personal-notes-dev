import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../../components/Toast";
import {
  modeSeconds,
  recoverTimer,
  emptyTimer,
  finishTimer,
  secondsLeft,
  type TimerMode,
  type TimerState,
  type TimerSettings,
  type FocusRecord,
} from "./model";

// Mounted in MainWindow so switching back to Markdown never stops the clock.
export function usePomodoro() {
  const [state, setState] = useState<TimerState>(emptyTimer);
  const [now, setNow] = useState(Date.now);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(state);
  const queue = useRef(Promise.resolve());
  const revision = useRef(0);
  const checkpoint = useRef(0);
  const failedSave = useRef(false);
  const persist = useCallback((next: TimerState) => {
    current.current = next;
    setState(next);
    const version = ++revision.current;
    setError("");
    queue.current = queue.current
      .catch(() => {})
      .then(() => invoke("pomodoro_save", { state: next }))
      .then(() => {
        failedSave.current = false;
        if (version === revision.current) setError("");
      })
      .catch(() => {
        failedSave.current = true;
        if (version === revision.current) setError("保存失败，请重试；暂时不要关闭程序");
      });
  }, []);
  useEffect(() => {
    let cancelled = false;
    invoke<TimerState>("pomodoro_load")
      .then((value) => {
        if (cancelled) return;
        const next = recoverTimer(value, Date.now());
        current.current = next;
        setState(next);
        setReady(true);
        if (next !== value) persist(next);
      })
      .catch(() => {
        if (!cancelled) setError("加载失败，请重新打开程序，避免覆盖原有记录");
      });
    return () => {
      cancelled = true;
    };
  }, [persist]);
  useEffect(() => {
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (!ready) return;
      const next = finishTimer(current.current, time);
      if (next !== current.current) {
        const focus = current.current.mode === "focus";
        showToast(
          current.current.mode === "focus"
            ? "一个番茄完成了，休息一下吧"
            : "休息结束，可以开始下一次专注了",
          "info",
        );
        persist(next);
        void invoke("pomodoro_alert", {
          focus,
          sound: next.settings.sound,
          notification: next.settings.notification,
        }).catch(() => showToast("系统提醒发送失败，计时记录已保留", "warning"));
      } else if (current.current.endsAt !== null && time - checkpoint.current >= 10000) {
        checkpoint.current = time;
        persist({
          ...current.current,
          remaining: secondsLeft(current.current, time),
          lastSeen: time,
        });
      }
    };
    const timer = window.setInterval(tick, 500);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [ready, persist]);
  const toggle = () => {
    if (!ready) return;
    const time = Date.now();
    const value = finishTimer(current.current, time);
    if (value.endsAt !== null)
      persist({ ...value, remaining: secondsLeft(value, time), endsAt: null, lastSeen: time });
    else {
      const remaining =
        value.remaining > 0 ? value.remaining : modeSeconds(value.mode, value.settings);
      persist({
        ...value,
        remaining,
        endsAt: time + remaining * 1000,
        startedAt: value.startedAt ?? time,
        sessionId: value.sessionId ?? crypto.randomUUID(),
        sessionTask: value.sessionId ? value.sessionTask : value.activeTask,
        sessionSeconds: value.sessionId
          ? value.sessionSeconds
          : modeSeconds(value.mode, value.settings),
        lastSeen: time,
      });
    }
    setNow(time);
  };
  const reset = (mode: TimerMode = current.current.mode) => {
    if (!ready) return;
    persist({
      ...finishTimer(current.current, Date.now()),
      mode,
      remaining: modeSeconds(mode, current.current.settings),
      sessionSeconds: modeSeconds(mode, current.current.settings),
      endsAt: null,
      startedAt: null,
      sessionId: null,
      sessionTask: null,
    });
  };
  const startTask = (task: { id: string; title: string } | null, minutes?: number) => {
    if (!ready) return false;
    if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 180))
      return false;
    const time = Date.now();
    const value = finishTimer(current.current, time);
    const same =
      value.mode === "focus" &&
      !!value.sessionId &&
      (value.sessionTask?.id ?? null) === (task?.id ?? null);
    if (
      !same &&
      value.sessionId &&
      value.mode === "focus" &&
      !window.confirm("切换任务会放弃当前未完成的专注，继续吗？")
    )
      return false;
    const remaining = same
      ? secondsLeft(value, time)
      : minutes !== undefined
        ? minutes * 60
        : modeSeconds("focus", value.settings);
    persist({
      ...value,
      mode: "focus",
      activeTask: task,
      sessionTask: same ? value.sessionTask : task,
      remaining,
      endsAt: same && value.endsAt !== null ? value.endsAt : time + remaining * 1000,
      startedAt: same ? value.startedAt : time,
      sessionId: same ? value.sessionId : crypto.randomUUID(),
      sessionSeconds: same ? value.sessionSeconds : remaining,
      lastSeen: time,
    });
    setNow(time);
    return true;
  };
  const selectTask = (task: { id: string; title: string } | null) => {
    if (!ready) return false;
    const value = finishTimer(current.current, Date.now());
    if ((value.activeTask?.id ?? null) === (task?.id ?? null)) return true;
    if (value.mode === "focus" && value.sessionId) {
      if (!window.confirm("切换关联任务会放弃当前未完成的专注，继续吗？")) return false;
      persist({
        ...value,
        activeTask: task,
        sessionTask: null,
        endsAt: null,
        startedAt: null,
        sessionId: null,
        remaining: modeSeconds("focus", value.settings),
        sessionSeconds: modeSeconds("focus", value.settings),
      });
    } else persist({ ...value, activeTask: task });
    return true;
  };
  const finishTask = (id: string) => {
    if (current.current.activeTask?.id !== id) return true;
    const value = finishTimer(current.current, Date.now());
    if (
      value.sessionId &&
      value.mode === "focus" &&
      !window.confirm("此任务正在专注。停止当前未完成的专注并继续操作？")
    )
      return false;
    persist({
      ...value,
      activeTask: null,
      sessionTask: null,
      mode: "focus",
      endsAt: null,
      startedAt: null,
      sessionId: null,
      remaining: modeSeconds("focus", value.settings),
      sessionSeconds: modeSeconds("focus", value.settings),
    });
    return true;
  };
  const renameTask = (id: string, title: string) => {
    if (current.current.activeTask?.id === id)
      persist({ ...current.current, activeTask: { id, title } });
  };
  const configure = (settings: TimerSettings) => {
    const value = current.current;
    persist({
      ...value,
      settings,
      ...(value.sessionId === null
        ? {
            remaining: modeSeconds(value.mode, settings),
            sessionSeconds: modeSeconds(value.mode, settings),
          }
        : {}),
    });
  };
  const changeRecord = (record: FocusRecord | null, id: string) =>
    persist({
      ...current.current,
      records: current.current.records.flatMap((r) =>
        r.id === id ? (record ? [record] : []) : [r],
      ),
    });
  const flush = async () => {
    await queue.current;
    if (failedSave.current) throw new Error("番茄钟保存失败");
  };
  return {
    state,
    remaining: secondsLeft(state, now),
    now,
    ready,
    error,
    toggle,
    startTask,
    selectTask,
    finishTask,
    renameTask,
    reset,
    retry: () => persist(current.current),
    configure,
    changeRecord,
    flush,
  };
}
