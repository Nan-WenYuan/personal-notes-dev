import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Image, ImageReference, Definition } from "mdast";
import { visit } from "unist-util-visit";

function images(content: string) {
  const tree = unified().use(remarkParse).parse(content) as Root;
  const definitions = new Map<string, Definition>();
  visit(tree, "definition", (node) => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node);
  });
  const result: { node: Image | ImageReference; url: string; title?: string | null }[] = [];
  visit(tree, (node) => {
    if (node.type !== "image" && node.type !== "imageReference") return;
    const source = node.type === "image" ? node : definitions.get(node.identifier);
    if (source && /^https?:\/\//i.test(source.url))
      result.push({ node, url: source.url, title: source.title });
  });
  return result;
}

export function remoteImageUrls(content: string): string[] {
  return [...new Set(images(content).map((image) => image.url))];
}

export function replaceRemoteImages(content: string, paths: ReadonlyMap<string, string>): string {
  for (const { node, url, title } of images(content).reverse()) {
    const path = paths.get(url);
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (!path || start === undefined || end === undefined) continue;
    const alt = (node.alt ?? "").replace(/[\\[\]]/g, "\\$&");
    const caption = title ? ` "${title.replace(/[\\"]/g, "\\$&")}"` : "";
    content = content.slice(0, start) + `![${alt}](<${path}>${caption})` + content.slice(end);
  }
  return content;
}
