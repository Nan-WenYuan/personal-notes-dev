import { invoke } from "@tauri-apps/api/core";
let queue: Promise<void> = Promise.resolve();
let failure: unknown = null;
let lastTasks: unknown[] | null = null;
export function saveQuadrants(tasks: unknown[]): Promise<void> {
  lastTasks = tasks;
  const run = queue.then(() => invoke<void>("quadrants_save", { tasks }));
  queue = run.then(
    () => {
      failure = null;
    },
    (error) => {
      failure = error;
    },
  );
  return run;
}
export async function retryQuadrants(): Promise<void> {
  await queue;
  if (failure && lastTasks) await saveQuadrants(lastTasks);
}
export async function flushQuadrants(): Promise<void> {
  await queue;
  if (failure) throw failure;
}
export async function loadQuadrants<T>(): Promise<T> {
  await flushQuadrants();
  return invoke<T>("quadrants_load");
}
