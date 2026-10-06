import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveMarkdownImageSrc } from "./imageSrc";

describe("resolveMarkdownImageSrc", () => {
  const convertFileSrc = vi.fn((path: string) => `asset://${path}`);

  beforeEach(() => {
    convertFileSrc.mockClear();
  });

  test("resolves note image paths under the images directory", () => {
    expect(resolveMarkdownImageSrc("images/photo.png", "/notes/note-1", convertFileSrc)).toBe(
      "asset:///notes/note-1/images/photo.png",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("/notes/note-1/images/photo.png");
  });

  test("normalizes Windows-style separators before resolving note images", () => {
    expect(resolveMarkdownImageSrc("images\\photo.png", "C:/notes/note-1", convertFileSrc)).toBe(
      "asset://C:/notes/note-1/images/photo.png",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("C:/notes/note-1/images/photo.png");
  });

  test("keeps non-note image paths unchanged", () => {
    expect(
      resolveMarkdownImageSrc("https://example.com/photo.png", "/notes/note-1", convertFileSrc),
    ).toBe("https://example.com/photo.png");
    expect(resolveMarkdownImageSrc("./photo.png", "/notes/note-1", convertFileSrc)).toBe(
      "asset:///notes/note-1/photo.png",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("/notes/note-1/photo.png");
  });

  test("resolves encoded Chinese filenames and spaces without double encoding", () => {
    resolveMarkdownImageSrc(
      "./images/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.png",
      "D:\\我的 笔记\\数据\\",
      convertFileSrc,
    );
    expect(convertFileSrc).toHaveBeenCalledWith("D:/我的 笔记/数据/images/中文 图片.png");
  });

  test("preserves literal percent signs and encoded separators", () => {
    resolveMarkdownImageSrc("images/100%.png", "D:/笔记", convertFileSrc);
    expect(convertFileSrc).toHaveBeenLastCalledWith("D:/笔记/images/100%.png");
    resolveMarkdownImageSrc("images/%2e%2e%2fprivate.png", "D:/笔记", convertFileSrc);
    expect(convertFileSrc).toHaveBeenLastCalledWith("D:/笔记/images/%2e%2e%2fprivate.png");
  });

  test("keeps image paths unchanged when the base directory is unavailable", () => {
    expect(resolveMarkdownImageSrc("images/photo.png", undefined, convertFileSrc)).toBe(
      "images/photo.png",
    );
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  test("returns an empty string for missing sources", () => {
    expect(resolveMarkdownImageSrc(undefined, "/notes/note-1", convertFileSrc)).toBe("");
  });
});
