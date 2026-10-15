import { invoke } from "@tauri-apps/api/core";
export type ReadingMode = "page" | "scroll";

export interface Book {
  id: string;
  title: string;
  fileName: string;
  format: string;
  size: number;
  importedAt: number;
  lastReadAt: number | null;
  location: string | null;
  progress: number;
  readingMode?: ReadingMode | null;
}
export function bookReadingMode(book: Pick<Book, "format" | "readingMode">): ReadingMode {
  return book.readingMode ?? (book.format === "pdf" ? "scroll" : "page");
}
export const BOOK_FORMATS = ["epub", "pdf", "mobi", "azw", "azw3", "fb2", "cbz", "txt"];
const pending = new Map<string, { location: string; fraction: number }>();
const pendingModes = new Map<string, ReadingMode>();
let queue: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
export function saveBookProgress(id: string, location: string, fraction: number) {
  pending.set(id, { location, fraction });
  clearTimeout(timer);
  timer = setTimeout(() => {
    void flushBookProgress().catch(() => {});
  }, 350);
}
export function flushBookProgress(): Promise<void> {
  clearTimeout(timer);
  const run = queue
    .catch(() => {})
    .then(async () => {
      for (const [id, value] of pending) {
        await invoke("books_progress", { id, ...value });
        if (pending.get(id) === value) pending.delete(id);
      }
      for (const [id, readingMode] of pendingModes) {
        await invoke("books_reading_mode", { id, readingMode });
        if (pendingModes.get(id) === readingMode) pendingModes.delete(id);
      }
    });
  queue = run;
  return run;
}
export function saveBookReadingMode(id: string, mode: ReadingMode): Promise<void> {
  pendingModes.set(id, mode);
  return flushBookProgress();
}
