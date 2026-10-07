import type { TimerState } from "./model";

export function taskProgress(state: TimerState, remaining: number, taskId: string): number | null {
  if (state.mode !== "focus" || !state.sessionId || state.sessionTask?.id !== taskId) return null;
  if (state.sessionSeconds <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - remaining / state.sessionSeconds) * 100));
}
