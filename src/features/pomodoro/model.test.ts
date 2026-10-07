import { describe, expect, test } from "vitest";
import { dateKey, emptyTimer, finishTimer, monthCells, secondsLeft, recoverTimer } from "./model";
describe("pomodoro lifecycle", () => {
  test("task snapshot survives rename and automatic rest retains association", () => {
    const state = {
      ...emptyTimer(),
      startedAt: 1,
      endsAt: 1000,
      sessionId: "linked",
      activeTask: { id: "task", title: "新名称" },
      sessionTask: { id: "task", title: "原名称" },
    };
    state.settings.autoCycle = true;
    const rest = finishTimer(state, 1000);
    expect(rest.records[0].taskId).toBe("task");
    expect(rest.records[0].taskTitle).toBe("原名称");
    expect(rest.sessionTask?.title).toBe("新名称");
    expect(finishTimer(rest, rest.endsAt!).records).toHaveLength(1);
  });
  test("uses elapsed wall time and records a completed focus once", () => {
    const state = { ...emptyTimer(), endsAt: 1_600_000, startedAt: 100_000, sessionId: "focus-1" };
    expect(secondsLeft(state, 1_599_100)).toBe(1);
    expect(finishTimer(state, 1_599_999)).toBe(state);
    const finished = finishTimer(state, 1_700_000);
    expect(finished.records).toEqual([
      { id: "focus-1", startedAt: 100_000, completedAt: 1_600_000, seconds: 1500 },
    ]);
    expect(finishTimer(finished, 1_800_000)).toBe(finished);
    expect(finishTimer({ ...state, records: finished.records }, 1_800_000).records).toHaveLength(1);
  });
  test("pause and rest never count as a completed tomato", () => {
    const paused = { ...emptyTimer(), remaining: 100, startedAt: 1, sessionId: "paused" };
    expect(finishTimer(paused, 10_000)).toBe(paused);
    expect(secondsLeft(paused, 10_000)).toBe(100);
    expect(finishTimer({ ...paused, mode: "short", endsAt: 5000 }, 10_000).records).toEqual([]);
  });
  test("recovery attributes records to completion day, not reopening day", () => {
    const end = new Date(2026, 9, 7, 23, 59).getTime();
    const recovered = finishTimer(
      { ...emptyTimer(), startedAt: end - 1_500_000, endsAt: end, sessionId: "recovered" },
      new Date(2026, 9, 8, 9).getTime(),
    );
    expect(dateKey(new Date(recovered.records[0].completedAt))).toBe("2026-10-07");
  });
  test("calendar starts Monday and includes leap days", () => {
    const october = monthCells(2026, 9);
    expect(october.slice(0, 7)).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(october).toHaveLength(35);
    expect(monthCells(2024, 1).filter(Boolean)).toHaveLength(29);
  });
  test("closed application time is excluded and old running data becomes paused", () => {
    const running = {
      ...emptyTimer(),
      remaining: 200,
      endsAt: 400000,
      lastSeen: 300000,
      startedAt: 1,
      sessionId: "interrupted",
    };
    const recovered = recoverTimer(running, 900000);
    expect(recovered.endsAt).toBeNull();
    expect(recovered.remaining).toBe(100);
    expect(recovered.records).toHaveLength(0);
    expect(recovered.sessionId).toBe("interrupted");
    const legacy = { ...running, lastSeen: 0 };
    expect(recoverTimer(legacy, 900000).remaining).toBe(200);
  });
  test("fourth focus starts long rest and rest returns to focus", () => {
    const running = {
      ...emptyTimer(),
      startedAt: 1,
      endsAt: 10000,
      sessionId: "four",
      cycleCount: 3,
    };
    running.settings.autoCycle = true;
    const rest = finishTimer(running, 10000);
    expect(rest.mode).toBe("long");
    expect(rest.records).toHaveLength(1);
    expect(rest.endsAt).toBe(10000 + 900000);
    const focus = finishTimer(rest, rest.endsAt!);
    expect(focus.mode).toBe("focus");
    expect(focus.cycleCount).toBe(0);
    expect(focus.records).toHaveLength(1);
  });
  test("custom durations persist in records and delayed ticks do not fabricate cycles", () => {
    const running = {
      ...emptyTimer(),
      startedAt: 1,
      endsAt: 10000,
      sessionId: "custom",
      sessionSeconds: 1800,
    };
    running.settings.focusMinutes = 30;
    running.settings.shortMinutes = 7;
    running.settings.autoCycle = true;
    const next = finishTimer(running, 9000000);
    expect(next.records[0].seconds).toBe(1800);
    expect(next.records).toHaveLength(1);
    expect(next.mode).toBe("short");
    expect(next.endsAt).toBe(9000000 + 420000);
  });
});
