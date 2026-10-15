export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}
interface Section {
  id: string | number;
  size?: number;
  load: () => Promise<string> | string;
  unload?: () => void;
}
export interface EngineBook {
  sections: Section[];
  toc?: TocItem[];
  destroy?: () => void;
  [key: string]: unknown;
}
export interface ReaderView extends HTMLElement {
  open: (book: EngineBook) => Promise<void>;
  init: (options: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>;
  close: () => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  goTo: (href: string | number) => Promise<void>;
  goToFraction: (fraction: number) => Promise<void>;
  lastLocation?: { cfi: string; fraction: number; tocItem?: TocItem };
  renderer: HTMLElement & { setStyles?: (styles: string) => void };
}
export const engineBase = `${import.meta.env.BASE_URL}book-engine/`;
export async function loadEngine(file: File): Promise<EngineBook> {
  const url = new URL(`${engineBase}view.js`, document.baseURI).href;
  const engine = await import(/* @vite-ignore */ url);
  const book: EngineBook = file.name.endsWith(".txt")
    ? await textBook(file)
    : await engine.makeBook(file);
  if (file.name.endsWith(".cbz")) book.rendition = { layout: "pre-paginated", spread: "none" };
  // Book HTML is untrusted. Block scripts, navigation and network loads before it enters an iframe.
  for (const section of book.sections) {
    const load = section.load.bind(section);
    const unload = section.unload?.bind(section);
    let safeUrl: string | undefined;
    section.load = async () => {
      if (safeUrl) return safeUrl;
      const source = await load();
      const response = await fetch(source);
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      doc
        .querySelectorAll("script,iframe,object,embed,base,form,meta[http-equiv]")
        .forEach((el) => el.remove());
      for (const el of doc.querySelectorAll("*")) {
        // Snapshot the live NamedNodeMap before removing unsafe attributes.
        // oxlint-disable-next-line unicorn/no-useless-spread
        for (const attr of [...el.attributes]) {
          if (/^on/i.test(attr.name) || /^(?:javascript|vbscript):/i.test(attr.value.trim()))
            el.removeAttribute(attr.name);
        }
      }
      const csp = doc.createElement("meta");
      csp.httpEquiv = "Content-Security-Policy";
      csp.content =
        "default-src 'none'; script-src 'none'; img-src blob: data:; style-src blob: data: 'unsafe-inline'; font-src blob: data:; media-src blob: data:; form-action 'none'; base-uri 'none'";
      doc.head.prepend(csp);
      safeUrl = `data:text/html,${encodeURIComponent("<!doctype html>" + doc.documentElement.outerHTML)}`;
      return safeUrl;
    };
    section.unload = () => {
      safeUrl = undefined;
      unload?.();
    };
  }
  const destroy = book.destroy?.bind(book);
  book.destroy = () => {
    book.sections.forEach((s) => s.unload?.());
    destroy?.();
  };
  return book;
}
async function textBook(file: File): Promise<EngineBook> {
  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("gb18030").decode(bytes);
  }
  const chunks: { title: string; lines: string[] }[] = [];
  let chunk = { title: "正文", lines: [] as string[] };
  for (const line of text.split(/\r?\n/)) {
    const heading =
      /^\s*(第.{1,20}[章节回卷部篇]|chapter\s+\d+|序言|前言|后记)/i.test(line) && line.length < 80;
    if ((heading && chunk.lines.length) || chunk.lines.length >= 200) {
      chunks.push(chunk);
      chunk = { title: heading ? line.trim() : `正文 ${chunks.length + 1}`, lines: [] };
    } else if (heading) chunk.title = line.trim();
    chunk.lines.push(line);
  }
  chunks.push(chunk);
  const urls: string[] = [];
  return {
    metadata: { language: "zh" },
    sections: chunks.map((chunk, i) => ({
      id: String(i),
      size: chunk.lines.join("").length,
      load: () => {
        if (urls[i]) return urls[i];
        const doc = document.implementation.createHTMLDocument(chunk.title);
        for (const line of chunk.lines) {
          const p = doc.createElement("p");
          p.textContent = line || "\u00a0";
          doc.body.append(p);
        }
        urls[i] = URL.createObjectURL(
          new Blob([doc.documentElement.outerHTML], { type: "text/html" }),
        );
        return urls[i];
      },
    })),
    toc: chunks.map((chunk, i) => ({ label: chunk.title, href: String(i) })),
    resolveHref: (href: string) => ({ index: Number(href) }),
    splitTOCHref: (href: string) => [href, null],
    getTOCFragment: (doc: Document) => doc.body,
    destroy: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  };
}
