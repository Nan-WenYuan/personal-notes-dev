import { expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { saveBookProgress, flushBookProgress, saveBookReadingMode } from "./storage";

it("keeps the newest position when an older write is still pending, and retries failures", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  invoke.mockResolvedValue(undefined);
  saveBookProgress("book", "chapter-1", 0.1);
  const first = flushBookProgress();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  saveBookProgress("book", "chapter-2", 0.6);
  finish();
  await first;
  await flushBookProgress();
  expect(invoke).toHaveBeenLastCalledWith("books_progress", {
    id: "book",
    location: "chapter-2",
    fraction: 0.6,
  });
  invoke.mockRejectedValueOnce(new Error("disk full"));
  saveBookProgress("book", "chapter-3", 0.9);
  await expect(flushBookProgress()).rejects.toThrow("disk full");
  await flushBookProgress();
  expect(invoke).toHaveBeenLastCalledWith("books_progress", {
    id: "book",
    location: "chapter-3",
    fraction: 0.9,
  });
  vi.useRealTimers();
});

it("keeps the latest mode during an in-flight save and retries a failed preference write", async () => {
  invoke.mockClear();
  let finish!: () => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  invoke.mockResolvedValue(undefined);
  const first = saveBookReadingMode("book", "scroll");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  saveBookProgress("book", "chapter-2", 0.6);
  const second = saveBookReadingMode("book", "page");
  const other = saveBookReadingMode("other-book", "scroll");
  finish();
  await Promise.all([first, second, other]);
  expect(
    invoke.mock.calls.filter(
      ([command, args]) => command === "books_reading_mode" && args.id === "book",
    ),
  ).toEqual([
    ["books_reading_mode", { id: "book", readingMode: "scroll" }],
    ["books_reading_mode", { id: "book", readingMode: "page" }],
  ]);
  expect(invoke).toHaveBeenCalledWith("books_reading_mode", {
    id: "other-book",
    readingMode: "scroll",
  });
  invoke.mockRejectedValueOnce(new Error("disk full"));
  await expect(saveBookReadingMode("book", "scroll")).rejects.toThrow("disk full");
  await flushBookProgress();
  expect(invoke).toHaveBeenLastCalledWith("books_reading_mode", {
    id: "book",
    readingMode: "scroll",
  });
});
