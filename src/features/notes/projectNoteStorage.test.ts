import { expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { saveProjectNote, flushProjectNotes } from "./projectNoteStorage";
it("serializes edits and retries the latest failed draft before leaving", async () => {
  invoke.mockRejectedValueOnce(new Error("disk full")).mockResolvedValue([]);
  const note = { id: "note", title: "标题", content: "正文", updatedAt: 0 };
  await expect(saveProjectNote("a", note)).rejects.toThrow("disk full");
  await flushProjectNotes();
  expect(invoke).toHaveBeenLastCalledWith("projects_save_note", { projectId: "a", note });
  const first = saveProjectNote("a", { ...note, content: "旧" });
  const second = saveProjectNote("a", { ...note, content: "新" });
  await Promise.all([first, second]);
  await flushProjectNotes();
  expect(invoke).toHaveBeenLastCalledWith("projects_save_note", {
    projectId: "a",
    note: { ...note, content: "新" },
  });
});
