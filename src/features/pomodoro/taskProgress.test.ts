import { describe, expect, it } from "vitest";
import { emptyTimer } from "./model";
import { taskProgress } from "./taskProgress";

describe("task focus progress", () => {
  const state = {
    ...emptyTimer(),
    sessionId: "session",
    sessionTask: { id: "task", title: "task" },
    sessionSeconds: 300,
  };
  it("uses this session duration and keeps progress while paused", () => {
    expect(taskProgress(state, 180, "task")).toBe(40);
    expect(taskProgress({ ...state, endsAt: null }, 180, "task")).toBe(40);
  });
  it("hides progress for rest, reset, and other tasks", () => {
    expect(taskProgress({ ...state, mode: "short" }, 180, "task")).toBeNull();
    expect(taskProgress({ ...state, sessionId: null }, 180, "task")).toBeNull();
    expect(taskProgress(state, 180, "other")).toBeNull();
  });
  it("clamps clock boundary values", () => {
    expect(taskProgress(state, -1, "task")).toBe(100);
    expect(taskProgress(state, 301, "task")).toBe(0);
    expect(taskProgress({ ...state, sessionSeconds: 0 }, 0, "task")).toBe(0);
  });
});
