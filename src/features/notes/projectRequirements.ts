export type RequirementStage = "backlog" | "planned" | "developing" | "done";
export interface ProjectTask {
  id: string;
  text: string;
  completed: boolean;
  stage?: RequirementStage;
  plannedDate?: string;
}
export const requirementStage = (task: ProjectTask): RequirementStage =>
  task.stage ?? (task.completed ? "done" : "backlog");
export function moveRequirement(
  tasks: ProjectTask[],
  id: string,
  stage: RequirementStage,
  beforeId: string | null,
): ProjectTask[] {
  const source = tasks.find((t) => t.id === id);
  if (!source || beforeId === id) return tasks;
  const next = tasks.filter((t) => t.id !== id);
  const moved = { ...source, stage, completed: stage === "done" };
  const beforeIndex = next.findIndex((t) => t.id === beforeId && requirementStage(t) === stage);
  const last = next.map((t) => requirementStage(t)).lastIndexOf(stage);
  next.splice(beforeIndex >= 0 ? beforeIndex : last >= 0 ? last + 1 : next.length, 0, moved);
  return next;
}
