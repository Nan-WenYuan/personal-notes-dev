import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../../components/ProjectList";
export interface ProjectNote {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}
let queue: Promise<unknown> = Promise.resolve();
const failed = new Map<string, { projectId: string; note: ProjectNote }>();
export function saveProjectNote(projectId: string, note: ProjectNote): Promise<Project[]> {
  const key = `${projectId}/${note.id}`;
  const run = queue.then(() => invoke<Project[]>("projects_save_note", { projectId, note }));
  queue = run.then(
    () => {
      failed.delete(key);
    },
    () => {
      failed.set(key, { projectId, note });
    },
  );
  return run;
}
export async function flushProjectNotes() {
  await Promise.all(pendingContent);
  if (contentFailed) throw new Error("项目保存失败，请重试后再离开");
  await queue;
  for (const { projectId, note } of [...failed.values()]) await saveProjectNote(projectId, note);
  await queue;
}

const pendingContent = new Set<Promise<boolean>>();
let contentFailed = false;
export function trackProjectContentSave(run: Promise<boolean>) {
  pendingContent.add(run);
  void run.then(
    (ok) => {
      contentFailed = !ok;
      pendingContent.delete(run);
    },
    () => {
      contentFailed = true;
      pendingContent.delete(run);
    },
  );
}
