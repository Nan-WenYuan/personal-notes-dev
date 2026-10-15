import { bookReadingMode, type Book } from "./storage";
import { scrollOffset, scrollProgress } from "./progress";
import { engineBase, loadEngine, type ReaderView, type TocItem } from "./engine";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

export interface ReaderController {
  next: () => void;
  prev: () => void;
  seek: (fraction: number) => void;
  navigate: (href: string) => void;
  size: (value: number) => void;
  flow: (scrolled: boolean) => void;
  presentation?: (active: boolean) => void;
  destroy: () => void;
}
interface Callbacks {
  keydown?: (event: KeyboardEvent) => void;
  wheel?: (event: WheelEvent) => void;
  toc: (toc: TocItem[]) => void;
  position: (location: string, fraction: number, label: string) => void;
  ready: () => void;
  error: (error: unknown) => void;
}
export async function openRenderer(
  host: HTMLDivElement,
  url: string,
  book: Book,
  cb: Callbacks,
  signal: AbortSignal,
): Promise<ReaderController | undefined> {
  if (book.format === "pdf") return openPDF(host, url, book, cb, signal);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("书籍文件读取失败");
  const source = await loadEngine(new File([await response.blob()], `book.${book.format}`));
  if (signal.aborted) {
    source.destroy?.();
    return;
  }
  const view = document.createElement("foliate-view") as ReaderView;
  view.style.cssText = "display:block;width:100%;height:100%";
  host.append(view);
  let initialized = false;
  let disposed = false;
  const run = (action: Promise<void>) => {
    void action.catch(cb.error);
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    initialized = false;
    view.close();
    source.destroy?.();
    view.remove();
  };
  signal.addEventListener("abort", cleanup, { once: true });
  const report = (detail: { cfi: string; fraction: number; tocItem?: TocItem }) => {
    if (initialized && detail.cfi)
      cb.position(detail.cfi, detail.fraction || 0, detail.tocItem?.label ?? "");
  };
  view.addEventListener("relocate", (event) => report((event as CustomEvent).detail));
  view.addEventListener("external-link", (event) => event.preventDefault());
  view.addEventListener("load", (event) => {
    const doc = (event as CustomEvent<{ doc: Document }>).detail.doc;
    if (cb.keydown) {
      doc.addEventListener("keydown", cb.keydown, true);
      signal.addEventListener(
        "abort",
        () => doc.removeEventListener("keydown", cb.keydown!, true),
        { once: true },
      );
    }
    if (cb.wheel) {
      doc.addEventListener("wheel", cb.wheel, { capture: true, passive: false });
      signal.addEventListener("abort", () => doc.removeEventListener("wheel", cb.wheel!, true), {
        once: true,
      });
    }
  });
  try {
    await view.open(source);
    if (signal.aborted) {
      cleanup();
      return;
    }
    view.renderer.setAttribute("max-column-count", "1");
    view.renderer.setAttribute(
      "flow",
      bookReadingMode(book) === "scroll" ? "scrolled" : "paginated",
    );
    view.renderer.setAttribute("max-inline-size", "850px");
    const style = (size: number) => {
      const theme = getComputedStyle(host);
      const ink = theme.getPropertyValue("--color-ink").trim() || "#222";
      const paper = theme.getPropertyValue("--color-cloud").trim() || "white";
      view.renderer.setStyles?.(
        `html { color: ${ink} !important; background: ${paper} !important; font-size: ${size}px !important; } body { line-height: 1.8 !important; } p { margin-block: .6em; } img,svg { max-width:100%; }`,
      );
    };
    style(18);
    const observer = new MutationObserver(() => style(fontSize));
    let fontSize = 18;
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    signal.addEventListener("abort", () => observer.disconnect(), { once: true });
    cb.toc(source.toc ?? []);
    await view.init({ lastLocation: book.location ?? undefined });
    if (signal.aborted) return;
    initialized = true;
    if (view.lastLocation) report(view.lastLocation);
    cb.ready();
    return {
      next: () => run(view.next()),
      prev: () => run(view.prev()),
      seek: (fraction) => run(view.goToFraction(fraction)),
      navigate: (href) => run(view.goTo(href)),
      size: (value) => {
        fontSize = value;
        if (book.format === "cbz") view.renderer.setAttribute("zoom", String(value / 18));
        else style(value);
      },
      flow: (scrolled) => view.renderer.setAttribute("flow", scrolled ? "scrolled" : "paginated"),
      destroy: () => {
        observer.disconnect();
        cleanup();
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function openPDF(
  host: HTMLDivElement,
  url: string,
  book: Book,
  cb: Callbacks,
  signal: AbortSignal,
): Promise<ReaderController | undefined> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
  const { PDFViewer, PDFLinkService, EventBus } = await import("pdfjs-dist/web/pdf_viewer.mjs");
  if (signal.aborted) return;
  const container = document.createElement("div");
  container.className = "book-pdf-container";
  const pages = document.createElement("div");
  pages.className = "pdfViewer";
  container.append(pages);
  host.append(container);
  const eventBus = new EventBus();
  const links = new PDFLinkService({ eventBus });
  links.externalLinkEnabled = false;
  const viewer = new PDFViewer({
    container,
    viewer: pages,
    eventBus,
    linkService: links,
    annotationMode: 1,
    maxCanvasPixels: 16777216,
  });
  viewer.scrollMode = bookReadingMode(book) === "scroll" ? 0 : 3;
  links.setViewer(viewer);
  const task = pdfjs.getDocument({
    url,
    cMapUrl: `${engineBase}pdf/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${engineBase}pdf/standard_fonts/`,
    wasmUrl: `${engineBase}pdf/wasm/`,
  });
  let disposed = false;
  let ready = false;
  let resizeFrame = 0;
  let reportFrame = 0;
  let progressResizeFrame = 0;
  const progressResize = new ResizeObserver(() => {
    cancelAnimationFrame(progressResizeFrame);
    progressResizeFrame = requestAnimationFrame(() => {
      if (ready && !disposed) viewer.update();
    });
  });
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    // PDFViewer changes layout while fitting a page; apply it outside observer delivery.
    resizeFrame = requestAnimationFrame(() => {
      if (ready && !disposed) viewer.currentScaleValue = scale;
    });
  });
  let scale = "page-width";
  let beforePresentation: { scale: string } | undefined;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    ready = false;
    resize.disconnect();
    progressResize.disconnect();
    cancelAnimationFrame(resizeFrame);
    cancelAnimationFrame(reportFrame);
    cancelAnimationFrame(progressResizeFrame);
    viewer.setDocument(null);
    links.setDocument(null);
    void task.destroy();
    container.remove();
  };
  signal.addEventListener("abort", cleanup, { once: true });
  try {
    const document = await task.promise;
    if (signal.aborted) {
      cleanup();
      return;
    }
    eventBus.on("pagesinit", () => {
      viewer.currentScaleValue = scale;
      if (book.location) links.setHash(book.location.replace(/^#/, ""));
      ready = true;
      if (!book.location) container.scrollTop = 0;
      resize.observe(host);
      progressResize.observe(container);
      progressResize.observe(pages);
      viewer.update();
      cb.ready();
    });
    eventBus.on(
      "updateviewarea",
      ({ location }: { location: { pageNumber: number; pdfOpenParams: string } }) => {
        if (!ready) return;
        cancelAnimationFrame(reportFrame);
        // Read the final scroll range after PDF layout and scrollbar changes settle.
        reportFrame = requestAnimationFrame(() => {
          if (!ready || disposed) return;
          cb.position(
            location.pdfOpenParams,
            viewer.scrollMode === 0
              ? scrollProgress(container)
              : document.numPages <= 1
                ? 1
                : (location.pageNumber - 1) / (document.numPages - 1),
            `${location.pageNumber} / ${document.numPages} 页`,
          );
        });
      },
    );
    eventBus.on("pagerendered", ({ error }: { error?: unknown }) => {
      if (error && !disposed) cb.error(error);
      else if (ready && !disposed) viewer.update();
    });
    viewer.setDocument(document);
    links.setDocument(document);
    const outline = await document.getOutline();
    if (signal.aborted) return;
    const destinations = new Map<string, string | unknown[]>();
    type Outline = NonNullable<typeof outline>;
    const mapOutline = (items: Outline): TocItem[] =>
      items.map((item) => {
        const href = String(destinations.size);
        if (item.dest) destinations.set(href, item.dest);
        return { href, label: item.title, subitems: mapOutline(item.items) };
      });
    cb.toc(outline ? mapOutline(outline) : []);
    return {
      next: () => {
        viewer.currentPageNumber = Math.min(document.numPages, viewer.currentPageNumber + 1);
      },
      prev: () => {
        viewer.currentPageNumber = Math.max(1, viewer.currentPageNumber - 1);
      },
      seek: (fraction) => {
        if (viewer.scrollMode === 0) {
          container.scrollTop = scrollOffset(fraction, container);
          viewer.update();
        } else
          viewer.currentPageNumber = Math.max(
            1,
            Math.round(fraction * (document.numPages - 1)) + 1,
          );
      },
      navigate: (href) => {
        const dest = destinations.get(href);
        if (dest) void links.goToDestination(dest).catch(cb.error);
      },
      size: (value) => {
        scale = String(value / 18);
        viewer.currentScaleValue = scale;
      },
      flow: (scrolled) => {
        viewer.scrollMode = scrolled ? 0 : 3;
        viewer.update();
      },
      presentation: (active) => {
        if (active && beforePresentation) return;
        if (!active && !beforePresentation) return;
        const pageNumber = viewer.currentPageNumber;
        if (active) {
          beforePresentation = { scale };
          scale = "page-fit";
        } else {
          scale = beforePresentation!.scale;
          beforePresentation = undefined;
        }
        viewer.currentScaleValue = scale;
        viewer.scrollPageIntoView({ pageNumber });
      },
      destroy: cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
