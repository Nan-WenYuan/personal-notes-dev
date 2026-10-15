import { describe, it, expect } from "vitest";
import { moveRequirement, requirementStage, type ProjectTask } from "./projectRequirements";
const tasks: ProjectTask[] = [
  { id: "a", text: "A", completed: false },
  { id: "b", text: "B", completed: false, stage: "developing", plannedDate: "2026-10-15" },
  { id: "c", text: "C", completed: true },
];
describe("project requirement movement", () => {
  it("moves across stages, preserves schedule, and reopens completed work", () => {
    const done = moveRequirement(tasks, "b", "done", "c");
    expect(done.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(done[1]).toMatchObject({ completed: true, stage: "done", plannedDate: "2026-10-15" });
    const reopened = moveRequirement(done, "c", "planned", null);
    expect(reopened.find((t) => t.id === "c")).toMatchObject({
      completed: false,
      stage: "planned",
    });
    expect(tasks[1].stage).toBe("developing");
  });
  it("orders within a column without losing or duplicating requirements", () => {
    const rows = moveRequirement(tasks, "a", "developing", null);
    expect(rows.filter((t) => requirementStage(t) === "developing").map((t) => t.id)).toEqual([
      "b",
      "a",
    ]);
    const reordered = moveRequirement(rows, "a", "developing", "b");
    expect(reordered.filter((t) => requirementStage(t) === "developing").map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
    expect(new Set(reordered.map((t) => t.id)).size).toBe(3);
    expect(moveRequirement(rows, "a", "developing", "a")).toBe(rows);
  });
  it("maps older completed flags", () => {
    expect(requirementStage(tasks[0])).toBe("backlog");
    expect(requirementStage(tasks[2])).toBe("done");
  });
});
