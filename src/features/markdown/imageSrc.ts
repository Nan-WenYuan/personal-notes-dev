export type FileSrcConverter = (path: string) => string;

export function resolveMarkdownImageSrc(
  src: string | undefined,
  imageBaseDir: string | undefined,
  convertFileSrc: FileSrcConverter,
): string {
  if (!src) {
    return "";
  }

  const normalizedSrc = src.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!imageBaseDir || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(normalizedSrc)) {
    return src;
  }

  // Markdown may URL-encode Chinese filenames and spaces. Decode each filename
  // before convertFileSrc encodes it, without turning encoded separators into paths.
  const localSrc = normalizedSrc
    .split("/")
    .map((part) => {
      try {
        const decoded = decodeURIComponent(part);
        return /[/\\]/.test(decoded) || decoded === "." || decoded === ".." ? part : decoded;
      } catch {
        return part;
      }
    })
    .join("/");
  const baseDir = imageBaseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  return convertFileSrc(`${baseDir}/${localSrc}`);
}
