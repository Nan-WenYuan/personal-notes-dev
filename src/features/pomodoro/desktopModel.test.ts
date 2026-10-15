import { describe, expect, it } from "vitest";
import {
  acceptDesktopSnapshot,
  desktopProgress,
  type DesktopSnapshot,
  type DesktopTimer,
} from "./desktopModel";

const timer: DesktopTimer = {
  title: "专注",
  mode: "focus",
  endsAt: 1_500_000,
  remaining: 1500,
  seconds: 1500,
};
describe("desktop Pomodoro", () => {
  it("uses the deadline after a suspended webview instead of accumulating ticks", () => {
    expect(desktopProgress(timer, 140_000)).toEqual({
      remaining: 1360,
      progress: 1 - 1360 / 1500,
      paused: false,
    });
    expect(desktopProgress(timer, 1_700_000)).toEqual({ remaining: 0, progress: 1, paused: false });
  });
  it("freezes paused progress and clamps stale/invalid durations", () => {
    expect(desktopProgress({ ...timer, endsAt: null, remaining: 800 }, 1_700_000)).toEqual({
      remaining: 800,
      progress: 1 - 800 / 1500,
      paused: true,
    });
    expect(desktopProgress(timer, -1000).progress).toBe(0);
    expect(desktopProgress({ ...timer, seconds: 0 }, 2_000_000).progress).toBe(0);
  });
  it("does not replace a newly received completion with an older snapshot response", () => {
    const next: DesktopSnapshot = {
      revision: 9,
      timer: null,
      notice: { id: "done", title: "任务", focus: true, seconds: 1500 },
      noticeCount: 1,
    };
    expect(acceptDesktopSnapshot(next, { ...next, revision: 8, notice: null })).toBe(next);
    expect(acceptDesktopSnapshot(null, next)).toBe(next);
  });
});
