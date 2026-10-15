import type { TimerMode } from "./model";

export interface DesktopTimer {
  title: string;
  mode: TimerMode;
  endsAt: number | null;
  remaining: number;
  seconds: number;
}
export interface CompletionNotice {
  id: string;
  title: string;
  focus: boolean;
  seconds: number;
}
export interface DesktopSnapshot {
  revision: number;
  timer: DesktopTimer | null;
  notice: CompletionNotice | null;
  noticeCount: number;
}
export function desktopProgress(timer: DesktopTimer, now: number) {
  const remaining = Math.max(
    0,
    timer.endsAt === null ? timer.remaining : Math.ceil((timer.endsAt - now) / 1000),
  );
  const progress = timer.seconds > 0 ? Math.max(0, Math.min(1, 1 - remaining / timer.seconds)) : 0;
  return { remaining, progress, paused: timer.endsAt === null };
}
export function acceptDesktopSnapshot(current: DesktopSnapshot | null, next: DesktopSnapshot) {
  return current && current.revision >= next.revision ? current : next;
}
