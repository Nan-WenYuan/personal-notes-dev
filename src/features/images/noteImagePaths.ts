// Match the backend URL encoding used by relative image links.
export function remapNoteImageLinks(
  content: string,
  oldFileName: string,
  newFileName: string,
): string {
  const prefix = (name: string) => {
    const url = new URL("https://local.invalid/");
    url.pathname = name.replace(/\.md$/i, "") + "/";
    return url.pathname.slice(1);
  };
  return content.split(prefix(oldFileName)).join(prefix(newFileName));
}
