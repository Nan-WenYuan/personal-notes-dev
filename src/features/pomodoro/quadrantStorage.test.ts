import { beforeEach, expect, test, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
});
test("exit waits for ordered task writes and reloading waits for the final save", async () => {
  const store = await import("./quadrantStorage");
  let resolve!: () => void;
  invoke
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(["latest"]);
  const first = store.saveQuadrants(["first"]);
  const second = store.saveQuadrants(["second"]);
  const loaded = store.loadQuadrants<string[]>();
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledTimes(1);
  resolve();
  await first;
  await second;
  expect(await loaded).toEqual(["latest"]);
  expect(invoke.mock.calls.map((call) => call[0])).toEqual([
    "quadrants_save",
    "quadrants_save",
    "quadrants_load",
  ]);
});
test("failed save blocks exit and successful retry clears the failure", async () => {
  const store = await import("./quadrantStorage");
  invoke.mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
  await expect(store.saveQuadrants([])).rejects.toThrow("disk full");
  await expect(store.flushQuadrants()).rejects.toThrow("disk full");
  await store.saveQuadrants([]);
  await expect(store.flushQuadrants()).resolves.toBeUndefined();
});
