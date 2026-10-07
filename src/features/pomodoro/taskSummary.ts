import type { FocusRecord } from "./model";
export type TomatoKind = "short" | "standard" | "long";
export const tomatoKinds: TomatoKind[] = ["short", "standard", "long"];
export const tomatoLabels = {
  short: "短时（≤15分钟）",
  standard: "标准（16～30分钟）",
  long: "长时（>30分钟）",
};
export function tomatoKind(seconds: number): TomatoKind {
  return seconds <= 900 ? "short" : seconds <= 1800 ? "standard" : "long";
}
export function summarizeTask(records: FocusRecord[], taskId: string) {
  return tomatoKinds
    .map((kind) => {
      const matching = records.filter(
        (record) => record.taskId === taskId && tomatoKind(record.seconds) === kind,
      );
      const durations = new Map<number, number>();
      matching.forEach((record) =>
        durations.set(record.seconds, (durations.get(record.seconds) ?? 0) + 1),
      );
      const seconds = matching.reduce((sum, record) => sum + record.seconds, 0);
      return {
        kind,
        count: matching.length,
        seconds,
        bundles: Math.floor(matching.length / 5),
        remainder: matching.length % 5,
        detail: [...durations]
          .sort(([a], [b]) => a - b)
          .map(([duration, count]) => `${duration / 60}分钟×${count}`)
          .join("、"),
      };
    })
    .filter((group) => group.count > 0);
}
