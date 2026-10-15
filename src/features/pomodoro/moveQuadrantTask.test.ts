import { describe, expect, it } from "vitest";
import { moveQuadrantTask } from "./moveQuadrantTask";

const tasks = [
  { id: "a", text: "正在专注", quadrant: 0, completed: false },
  { id: "b", text: "下一项", quadrant: 0, completed: false },
  { id: "c", text: "计划", quadrant: 1, completed: false },
  { id: "done", text: "已完成", quadrant: 1, completed: true, completedAt: 123 },
];
describe("quadrant drag placement", () => {
  it("moves across quadrants before a task while preserving identities and archived data", () => {
    const next = moveQuadrantTask(tasks, "a", 1, "c");
    expect(next.map((t) => t.id)).toEqual(["b", "a", "c", "done"]);
    expect(next[1]).toEqual({ ...tasks[0], quadrant: 1 });
    expect(next[3]).toBe(tasks[3]);
    expect(tasks[0].quadrant).toBe(0);
  });
  it("reorders in the same quadrant and appends to an empty quadrant", () => {
    expect(
      moveQuadrantTask(tasks, "b", 0, "a")
        .filter((t) => t.quadrant === 0)
        .map((t) => t.id),
    ).toEqual(["b", "a"]);
    expect(
      moveQuadrantTask(tasks, "a", 0, null)
        .filter((t) => t.quadrant === 0)
        .map((t) => t.id),
    ).toEqual(["b", "a"]);
    expect(moveQuadrantTask(tasks, "a", 3, null)[tasks.length - 1]?.quadrant).toBe(3);
  });
  it("does not resurrect deleted or completed tasks or save an unchanged position", () => {
    expect(moveQuadrantTask(tasks, "missing", 2, null)).toBe(tasks);
    expect(moveQuadrantTask(tasks, "done", 2, null)).toBe(tasks);
    expect(moveQuadrantTask(tasks, "a", 0, "b")).toBe(tasks);
    expect(moveQuadrantTask(tasks, "a", -1, null)).toBe(tasks);
  });
});
