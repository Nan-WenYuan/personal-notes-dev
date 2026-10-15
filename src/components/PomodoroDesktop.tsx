import { useEffect, useLayoutEffect, useState, type MouseEvent } from "react";
import { ExternalLink, X } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  acceptDesktopSnapshot,
  desktopProgress,
  type DesktopSnapshot,
} from "../features/pomodoro/desktopModel";
import { clockText } from "../features/pomodoro/model";
import tomato from "../assets/pomodoro-tomato.png";
import "./PomodoroDesktop.css";

export function PomodoroDesktop() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    const accept = (next: DesktopSnapshot) => {
      if (!cancelled) setSnapshot((current) => acceptDesktopSnapshot(current, next));
    };
    void listen<DesktopSnapshot>("pomodoro://desktop-state", (event) => accept(event.payload))
      .then(async (fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
        accept(await invoke<DesktopSnapshot>("pomodoro_desktop_snapshot"));
      })
      .catch(() => {
        if (!cancelled) setError("计时信息暂时不可用");
      });
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      cancelled = true;
      unlisten?.();
      window.clearInterval(interval);
    };
  }, []);
  useLayoutEffect(() => {
    if (!snapshot) return;
    // The native window is shown only once this real state has reached the DOM.
    void invoke("pomodoro_desktop_ready", { revision: snapshot.revision }).catch(() =>
      setError("桌面提醒显示失败"),
    );
  }, [snapshot?.revision]);
  const drag = (event: MouseEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    if (isTauri())
      void getCurrentWindow()
        .startDragging()
        .catch(() => setError("暂时无法移动窗口"));
  };
  const act = async (command: string, args?: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await invoke(command, args);
    } catch {
      setError("操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  };
  const notice = snapshot?.notice;
  const timer = snapshot?.timer;
  const progress = timer ? desktopProgress(timer, now) : null;
  const open = () => void act("pomodoro_desktop_open", { noticeId: notice?.id ?? null });
  return (
    <div className="pomodoro-desktop-frame">
      <section
        className={`pomodoro-desktop-surface${notice ? " is-complete" : ""}${timer?.mode !== "focus" && !notice ? " is-rest" : ""}`}
        aria-label={notice ? "番茄钟完成提醒" : "桌面番茄钟"}
      >
        <header className="pomodoro-desktop-heading" onMouseDown={drag} title="拖动移动窗口">
          <img className="pomodoro-desktop-tomato" src={tomato} alt="" draggable={false} />
          <span
            className={notice ? "pomodoro-desktop-status" : "pomodoro-desktop-task"}
            title={notice ? undefined : timer?.title}
          >
            {notice ? (notice.focus ? "专注完成" : "休息结束") : timer?.title || "番茄钟"}
          </span>
          {notice ? (
            <button
              className="pomodoro-desktop-icon"
              type="button"
              aria-label="关闭提醒"
              title="关闭提醒"
              disabled={busy}
              onClick={() => void act("pomodoro_desktop_dismiss", { id: notice.id })}
            >
              <X size={17} />
            </button>
          ) : (
            <button
              className="pomodoro-desktop-icon"
              type="button"
              aria-label="打开番茄钟"
              title="打开番茄钟"
              disabled={busy}
              onClick={open}
            >
              <ExternalLink size={16} />
            </button>
          )}
        </header>
        {notice ? (
          <>
            <div className="pomodoro-desktop-completion">
              <h1 title={notice.title}>{notice.focus ? notice.title : "可以开始下一次专注了"}</h1>
              <p>
                {notice.focus ? "已专注" : "已休息"} {Number((notice.seconds / 60).toFixed(1))} 分钟
              </p>
            </div>
            <footer className="pomodoro-desktop-footer">
              <span className="pomodoro-desktop-feedback" role={error ? "alert" : undefined}>
                {error ||
                  ((snapshot?.noticeCount ?? 0) > 1
                    ? `还有 ${snapshot!.noticeCount - 1} 条提醒`
                    : "")}
              </span>
              <button
                className="pomodoro-desktop-open"
                type="button"
                disabled={busy}
                onClick={open}
              >
                打开番茄钟
              </button>
            </footer>
          </>
        ) : progress ? (
          <div
            className="pomodoro-desktop-progress-row"
            onMouseDown={drag}
            title={progress.paused ? "计时已暂停" : "拖动移动窗口"}
          >
            <strong className="pomodoro-desktop-clock">{clockText(progress.remaining)}</strong>
            <div
              className="pomodoro-desktop-track"
              role="progressbar"
              aria-label={progress.paused ? "已暂停" : "计时进度"}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.progress * 100)}
            >
              <div
                className="pomodoro-desktop-fill"
                style={{ width: `${progress.progress * 100}%` }}
              />
            </div>
            {progress.paused && <small className="pomodoro-desktop-paused">已暂停</small>}
            {error && (
              <span className="pomodoro-desktop-running-error" role="alert">
                {error}
              </span>
            )}
          </div>
        ) : (
          <div className="pomodoro-desktop-loading" role={error ? "alert" : "status"}>
            {error || "准备计时…"}
          </div>
        )}
      </section>
    </div>
  );
}
