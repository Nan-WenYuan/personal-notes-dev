import { useState, useEffect } from "react";
import { getImagesBaseDir } from "./api";

export function useImageBaseDir(noteId?: string | null, revision?: string): string | null {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getImagesBaseDir(noteId ?? undefined)
      .then((value) => {
        if (!cancelled) setDir(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [noteId, revision]);
  return dir;
}
