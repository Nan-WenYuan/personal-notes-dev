export function moveQuadrantTask<T extends { id: string; quadrant: number; completed: boolean }>(
  tasks: T[],
  id: string,
  quadrant: number,
  before: string | null,
): T[] {
  const task = tasks.find((item) => item.id === id);
  if (
    !task ||
    task.completed ||
    !Number.isInteger(quadrant) ||
    quadrant < 0 ||
    quadrant > 3 ||
    before === id
  )
    return tasks;
  const next = tasks.filter((item) => item.id !== id);
  const index = before
    ? next.findIndex((item) => item.id === before && item.quadrant === quadrant && !item.completed)
    : -1;
  next.splice(index < 0 ? next.length : index, 0, { ...task, quadrant });
  return next.every((item, i) => item.id === tasks[i].id && item.quadrant === tasks[i].quadrant)
    ? tasks
    : next;
}
