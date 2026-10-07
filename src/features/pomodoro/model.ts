export type TimerMode = "focus" | "short" | "long";
export interface TimerSettings {
  focusMinutes: number;
  shortMinutes: number;
  longMinutes: number;
  longEvery: number;
  autoCycle: boolean;
  sound: boolean;
  notification: boolean;
}
export const defaultSettings: TimerSettings = {
  focusMinutes: 25,
  shortMinutes: 5,
  longMinutes: 15,
  longEvery: 4,
  autoCycle: false,
  sound: true,
  notification: true,
};
export const durations: Record<TimerMode, number> = { focus: 1500, short: 300, long: 900 };
export interface FocusRecord {
  taskId?: string;
  taskTitle?: string;
  id: string;
  startedAt: number;
  completedAt: number;
  seconds: number;
}
export interface TimerState {
  activeTask?: { id: string; title: string } | null;
  sessionTask?: { id: string; title: string } | null;
  mode: TimerMode;
  remaining: number;
  endsAt: number | null;
  startedAt: number | null;
  sessionId: string | null;
  records: FocusRecord[];
  settings: TimerSettings;
  sessionSeconds: number;
  cycleCount: number;
  lastSeen: number;
}
export const emptyTimer = (): TimerState => ({
  mode: "focus",
  remaining: 1500,
  endsAt: null,
  startedAt: null,
  sessionId: null,
  records: [],
  settings: { ...defaultSettings },
  sessionSeconds: 1500,
  cycleCount: 0,
  lastSeen: Date.now(),
});
export function modeSeconds(mode: TimerMode, settings: TimerSettings): number {
  return (
    (mode === "focus"
      ? settings.focusMinutes
      : mode === "short"
        ? settings.shortMinutes
        : settings.longMinutes) * 60
  );
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function secondsLeft(state: TimerState, now: number): number {
  return state.endsAt === null
    ? state.remaining
    : Math.max(0, Math.ceil((state.endsAt - now) / 1000));
}
export function recoverTimer(saved: TimerState, now: number): TimerState {
  const settings = { ...defaultSettings, ...saved.settings };
  const next = {
    ...emptyTimer(),
    ...saved,
    settings,
    sessionSeconds: saved.sessionSeconds || modeSeconds(saved.mode, settings),
  };
  // Never count time while the application was closed or after a crash.
  if (next.endsAt !== null) {
    next.remaining = saved.lastSeen ? secondsLeft(next, saved.lastSeen) : next.remaining;
    next.endsAt = null;
  }
  next.lastSeen = now;
  return next;
}
export function finishTimer(state: TimerState, now: number): TimerState {
  if (state.endsAt === null || now < state.endsAt) return state;
  const settings = state.settings ?? defaultSettings;
  const seconds = state.sessionSeconds || modeSeconds(state.mode, settings);
  const record =
    state.mode === "focus" &&
    state.sessionId &&
    state.startedAt !== null &&
    !state.records.some((r) => r.id === state.sessionId)
      ? [
          {
            id: state.sessionId,
            startedAt: state.startedAt,
            completedAt: state.endsAt,
            seconds,
            ...(state.sessionTask
              ? { taskId: state.sessionTask.id, taskTitle: state.sessionTask.title }
              : {}),
          },
        ]
      : [];
  const cycleCount =
    state.mode === "focus"
      ? (state.cycleCount ?? 0) + 1
      : state.mode === "long"
        ? 0
        : (state.cycleCount ?? 0);
  const mode =
    state.mode === "focus" ? (cycleCount >= settings.longEvery ? "long" : "short") : "focus";
  if (!settings.autoCycle)
    return {
      ...state,
      remaining: 0,
      endsAt: null,
      startedAt: null,
      sessionId: null,
      records: [...state.records, ...record],
      cycleCount,
      lastSeen: now,
    };
  const duration = modeSeconds(mode, settings);
  // Start one next phase now; don't fabricate multiple sessions after system sleep.
  return {
    ...state,
    mode,
    remaining: duration,
    sessionSeconds: duration,
    endsAt: now + duration * 1000,
    startedAt: now,
    sessionId: crypto.randomUUID(),
    sessionTask: state.activeTask,
    records: [...state.records, ...record],
    cycleCount,
    lastSeen: now,
  };
}
export function monthCells(year: number, month: number): (number | null)[] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function clockText(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
