import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { fromHtml } from "hast-util-from-html";
import type { Root, Image, Html, Definition } from "mdast";
import type { Element } from "hast";

export interface NoteImage {
  start: number;
  end: number;
  source: string;
  url: string;
  alt: string;
  title?: string | null;
  width?: number;
}
export function imageWidth(value: unknown): number | undefined {
  const match = String(value ?? "").match(/(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)%\s*(?:;|$)/i);
  const width = match ? Number(match[1]) : NaN;
  return width >= 1 && width <= 100 ? width : undefined;
}
function htmlImage(value: string): Element | undefined {
  const nodes = fromHtml(value, { fragment: true }).children.filter(
    (node) => node.type !== "text" || node.value.trim(),
  );
  const node = nodes[0];
  return nodes.length === 1 && node.type === "element" && node.tagName === "img" ? node : undefined;
}
export function noteImages(content: string): NoteImage[] {
  const tree = unified().use(remarkParse).parse(content) as Root;
  const definitions = new Map<string, Definition>();
  visit(tree, "definition", (node) => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node);
  });
  const images: NoteImage[] = [];
  visit(tree, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    let image: Pick<NoteImage, "url" | "alt" | "title" | "width"> | undefined;
    if (node.type === "image") image = { ...node, alt: node.alt ?? "" };
    if (node.type === "imageReference") {
      const definition = definitions.get(node.identifier);
      if (definition) image = { ...definition, alt: node.alt ?? "" };
    }
    if (node.type === "html") {
      const parsed = htmlImage(node.value);
      if (parsed)
        image = {
          url: String(parsed.properties.src ?? ""),
          alt: String(parsed.properties.alt ?? ""),
          title: String(parsed.properties.title ?? ""),
          width: imageWidth(parsed.properties.style),
        };
    }
    if (image)
      images.push({
        ...image,
        alt: image.alt ?? "",
        start,
        end,
        source: content.slice(start, end),
      });
  });
  return images;
}
const escapeAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function replaceNoteImage(
  content: string,
  image: NoteImage,
  patch: { url?: string; width?: number },
): string {
  if (content.slice(image.start, image.end) !== image.source)
    throw Error("笔记已变化，请重新打开图片");
  const { url, width, alt, title } = { ...image, ...patch };
  if (width !== undefined && (!Number.isFinite(width) || width < 1 || width > 100))
    throw Error("请输入 1 到 100 之间的比例");
  const markup = `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}"${title ? ` title="${escapeAttribute(title)}"` : ""}${width !== undefined ? ` style="width:${width}%;"` : ""} />`;
  return content.slice(0, image.start) + markup + content.slice(image.end);
}
// Render only a single image tag when general HTML rendering is disabled.
// All other HTML stays literal; image attributes are explicitly allowlisted.
export function remarkNoteImages() {
  return (tree: Root) =>
    visit(tree, "html", (node: Html) => {
      const image = htmlImage(node.value);
      if (!image) return;
      const width = imageWidth(image.properties.style);
      const replacement: Image = {
        type: "image",
        url: String(image.properties.src ?? ""),
        alt: String(image.properties.alt ?? ""),
        title: String(image.properties.title ?? ""),
        position: node.position,
        data: { hProperties: width ? { style: `width:${width}%;` } : {} },
      };
      Object.assign(node, replacement);
      delete (node as Partial<Html>).value;
    });
}
