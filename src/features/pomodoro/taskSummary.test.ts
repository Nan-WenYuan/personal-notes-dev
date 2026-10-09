import { expect, test } from "vitest";
import { summarizeTask, tomatoKind } from "./taskSummary";
test("interrupted focus does not count as a completed tomato", () => {
  expect(
    summarizeTask(
      [
        {
          id: "partial",
          taskId: "task",
          startedAt: 1,
          completedAt: 20001,
          seconds: 20,
          interrupted: true,
        },
      ],
      "task",
    ),
  ).toEqual([]);
});
const record = (seconds: number, taskId = "task") => ({
  id: crypto.randomUUID(),
  seconds,
  taskId,
  startedAt: 1,
  completedAt: 2,
});
test("duration boundaries classify real seconds", () => {
  expect([900, 901, 1800, 1801].map(tomatoKind)).toEqual(["short", "standard", "standard", "long"]);
});
test("mixed short durations combine by count while preserving exact total", () => {
  const records = [300, 300, 900, 900, 900, 1500, 2700].map((seconds) => record(seconds));
  const groups = summarizeTask([...records, record(300, "other")], "task");
  expect(groups.map((group) => [group.kind, group.count, group.bundles, group.remainder])).toEqual([
    ["short", 5, 1, 0],
    ["standard", 1, 0, 1],
    ["long", 1, 0, 1],
  ]);
  expect(groups[0].seconds).toBe(3300);
  expect(groups[0].detail).toBe("5分钟×2、15分钟×3");
  expect(summarizeTask(records.slice(1), "task")[0].bundles).toBe(0);
});
test("large counts retain exact remainder without allocating a matching icon for each record", () => {
  const group = summarizeTask(
    Array.from({ length: 999 }, () => record(1500)),
    "task",
  )[0];
  expect(group.bundles).toBe(199);
  expect(group.remainder).toBe(4);
});
