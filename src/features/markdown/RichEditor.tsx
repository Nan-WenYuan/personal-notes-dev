import { useEffect, useRef, useState, useImperativeHandle } from "react";
import type { Ref } from "react";
import { createPortal } from "react-dom";
import Vditor from "vditor";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { saveImage, saveImageFromPath } from "../images/api";
import { createRichToolbar, editorTools } from "./toolbarAppearance";
import { captureInsertionPosition, restoreInsertionPosition } from "./insertionPosition";
import { NoteContextMenu, type NoteMenuState } from "../images/NoteContextMenu";
import { noteImages, replaceNoteImage, type NoteImage } from "../images/imageMarkup";
import { copyNoteSelection, pasteNoteClipboard } from "../images/clipboard";
import { ImageViewer } from "../images/ImageViewer";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Scan, ExternalLink, Link, Copy, Rows3, Columns3, Trash2 } from "lucide-react";
import type { NoteMenuAction } from "../images/NoteContextMenu";
import { resolveMarkdownImageSrc } from "./imageSrc";
import "vditor/dist/index.css";
import "./richEditor.css";
import "./codeHighlight.css";

export interface RichEditorHandle {
  focus(): void;
  insertMarkdown(value: string): void;
  undo(): void;
  redo(): void;
}
interface Props {
  content: string;
  onChange(value: string): void;
  onEnsureNoteSaved(): Promise<string | null>;
  imageBaseDir?: string;
  disabled?: boolean;
  fontSize?: number;
  compactToolbar?: boolean;
  toolbarHost?: HTMLElement | null;
  editorRef?: Ref<RichEditorHandle>;
  onError(message: string): void;
}
const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

export function RichEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Vditor | null>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);
  const tableCommand = useRef<{ type: string; index: number } | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const lastValue = useRef(props.content);
  const replayingPaste = useRef(false);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState<
    | (NoteMenuState & {
        target: HTMLElement;
        range: Range | null;
        noteImage?: NoteImage;
        element?: HTMLImageElement;
        actions: NoteMenuAction[];
      })
    | null
  >(null);
  const [viewImage, setViewImage] = useState<{
    src: string;
    image: NoteImage;
    editor: Vditor;
  } | null>(null);
  const closeMenu = () => setMenu(null);
  const closeViewer = () => setViewImage(null);
  const selectedImage = (element: HTMLImageElement) => {
    const index = [
      ...(host.current?.querySelectorAll<HTMLImageElement>(".vditor-wysiwyg img") ?? []),
    ].indexOf(element);
    const image = instance.current ? noteImages(instance.current.getValue())[index] : undefined;
    if (!image) return undefined;
    const comparable = (value: string) => {
      try {
        return decodeURIComponent(value)
          .replace(/\\/g, "/")
          .replace(/([^:])\/{2,}/g, "$1/");
      } catch {
        return value;
      }
    };
    const expected = resolveMarkdownImageSrc(image.url, props.imageBaseDir, convertFileSrc);
    // Do not edit a different Markdown image when arbitrary HTML contains extra images.
    return comparable(new URL(expected, location.href).href) === comparable(element.src)
      ? image
      : undefined;
  };
  const changeImage = (image: NoteImage, patch: { url?: string; width?: number }) => {
    const editor = instance.current;
    if (!editor) throw Error("请重新打开笔记");
    const value = replaceNoteImage(editor.getValue(), image, patch);
    // Keep Vditor's undo stack: resizing or annotating must remain undoable.
    editor.vditor.undo?.addToUndoStack(editor.vditor);
    editor.setValue(value);
    editor.vditor.undo?.addToUndoStack(editor.vditor);
    lastValue.current = editor.getValue();
    latest.current.onChange(lastValue.current);
  };
  const gallery = viewImage ? noteImages(props.content) : [];
  const galleryIndex = viewImage
    ? gallery.findIndex(
        (image) => image.start === viewImage.image.start && image.url === viewImage.image.url,
      )
    : -1;
  const navigateImage = (index: number) => {
    const image = gallery[index];
    if (!image || !instance.current) return;
    setViewImage({
      src: resolveMarkdownImageSrc(image.url, props.imageBaseDir, convertFileSrc),
      image,
      editor: instance.current,
    });
  };
  useImperativeHandle(
    props.editorRef,
    () => ({
      focus: () => instance.current?.focus(),
      insertMarkdown: (value) => {
        instance.current?.insertMD(value);
        syncInput();
      },
      undo: () => {
        toolbarRef.current?.querySelector<HTMLButtonElement>('[data-type="undo"]')?.click();
        syncInput();
      },
      redo: () => {
        toolbarRef.current?.querySelector<HTMLButtonElement>('[data-type="redo"]')?.click();
        syncInput();
      },
    }),
    [],
  );

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let editor: Vditor;
    const mount = document.createElement("div");
    mount.style.height = "100%";
    host.current.appendChild(mount);
    setReady(false);
    const emit = (value: string) => {
      if (disposed || value === lastValue.current) return;
      lastValue.current = value;
      latest.current.onChange(value);
    };
    queueMicrotask(() => {
      if (disposed) return;
      editor = new Vditor(mount, {
        cdn: `${window.location.origin}/editor`,
        mode: "wysiwyg",
        height: "100%",
        minHeight: 100,
        cache: { enable: false },
        value: latest.current.content,
        placeholder: "开始写作……",
        lang: "zh_CN",
        toolbar: createRichToolbar(() => editor, props.compactToolbar),
        toolbarConfig: { pin: true },
        customWysiwygToolbar: (type, toolbar) => {
          toolbar.style.visibility = type === "table" ? "hidden" : "";
          if (type === "table" && tableCommand.current) {
            const { type: commandType, index } = tableCommand.current;
            tableCommand.current = null;
            queueMicrotask(() => {
              toolbar
                .querySelectorAll<HTMLButtonElement>(`[data-type="${commandType}"]`)
                [index]?.click();
              syncInput();
            });
          }
          toolbar
            .querySelectorAll('[data-type="up"], [data-type="down"], [data-type="remove"]')
            .forEach((button) => button.remove());
          if (type === "heading" || type === "code-block" || type === "image")
            toolbar.replaceChildren();
        },
        preview: {
          maxWidth: 10000,
          markdown: {
            sanitize: true,
            linkBase: props.imageBaseDir
              ? convertFileSrc(props.imageBaseDir.replace(/\\/g, "/") + "/")
              : "",
            codeBlockPreview: true,
          },
          hljs: { enable: true, style: "github", lineNumber: false },
        },
        link: {
          isOpen: false,
          click: (element) => {
            const href = element.getAttribute("href");
            if (href && /^https?:\/\//i.test(href)) void openUrl(href);
          },
        },
        input: emit,
        blur: () => {
          if (instance.current) emit(editor.getValue());
        },
        after: () => {
          if (disposed) {
            editor.destroy();
            return;
          }
          instance.current = editor;
          toolbarRef.current = mount.querySelector<HTMLElement>(".vditor-toolbar");
          editor.setValue(latest.current.content, true);
          lastValue.current = latest.current.content;
          if (latest.current.disabled) editor.disabled();
          setReady(true);
        },
        upload: {
          accept: "image/*",
          multiple: true,
          max: 20 * 1024 * 1024,
          handler: async (files) => {
            const position = captureInsertionPosition(host.current);
            try {
              const id = await latest.current.onEnsureNoteSaved();
              if (!id) throw new Error("请先保存笔记再插入图片");
              const lines: string[] = [];
              for (const file of files) {
                const ext = extensions[file.type];
                if (!ext) throw new Error("不支持此图片格式");
                if (file.size > 20 * 1024 * 1024) throw new Error("图片文件过大（上限 20 MB）");
                const path = await saveImage(id, new Uint8Array(await file.arrayBuffer()), ext);
                lines.push(`![](${path})`);
              }
              if (!disposed) {
                restoreInsertionPosition(host.current, position);
                editor.insertMD(lines.join("\n") + "\n");
                emit(editor.getValue());
              }
              return null;
            } catch (error) {
              const message = error instanceof Error ? error.message : "图片粘贴失败";
              latest.current.onError(message);
              return null;
            }
          },
        },
      });
    });
    return () => {
      disposed = true;
      // Return the native toolbar before destroying its editor, including note/mode switches.
      if (toolbarRef.current && !mount.contains(toolbarRef.current)) {
        mount.prepend(toolbarRef.current);
      }
      toolbarRef.current = null;
      if (editor && instance.current === editor) {
        editor.destroy();
        instance.current = null;
      }
      mount.remove();
    };
  }, [props.imageBaseDir]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    const destination = props.toolbarHost;
    if (!ready || !toolbar || !destination) return;
    const originalParent = toolbar.parentElement;
    const originalNext = toolbar.nextSibling;
    const sync = () => syncInput();
    destination.append(toolbar);
    toolbar.addEventListener("click", sync);
    return () => {
      toolbar.removeEventListener("click", sync);
      if (toolbar.parentElement === destination && originalParent?.isConnected) {
        originalParent.insertBefore(
          toolbar,
          originalNext?.parentNode === originalParent ? originalNext : null,
        );
      } else if (toolbar.parentElement === destination) {
        toolbar.remove();
      }
    };
  }, [ready, props.toolbarHost]);

  useEffect(() => {
    const editor = instance.current;
    if (!editor || !ready) return;
    if (props.content !== lastValue.current) {
      editor.setValue(props.content, true);
      lastValue.current = props.content;
    }
    if (props.disabled) editor.disabled();
    else editor.enable();
  }, [props.content, props.disabled, ready]);

  const syncInput = () => {
    const editor = instance.current;
    if (!editor) return;
    queueMicrotask(() => {
      if (instance.current !== editor) return;
      const value = editor.getValue();
      if (value !== lastValue.current) {
        lastValue.current = value;
        latest.current.onChange(value);
      }
    });
  };
  const convertTaskShorthand = () => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    const paragraph = element?.closest("p");
    if (
      !paragraph ||
      !host.current?.contains(paragraph) ||
      paragraph.closest('li, blockquote, [data-type="code-block"]')
    )
      return;
    // Only a paragraph prefix is a shortcut; code and inline occurrences stay literal.
    const first = paragraph.firstChild;
    if (
      first?.nodeType !== Node.TEXT_NODE ||
      !/^(?:\[\]|【】)(?:[ \t\u200b]|$)/.test(first.textContent ?? "")
    )
      return;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !range.collapsed) return;
    first.textContent = first.textContent!.replace(/^(?:\[\]|【】)[ \t\u200b]*/, "");
    const caret = document.createRange();
    caret.selectNodeContents(paragraph);
    caret.collapse(false);
    selection!.removeAllRanges();
    selection!.addRange(caret);
    toolbarRef.current?.querySelector<HTMLButtonElement>('[data-type="check"]')?.click();
    syncInput();
  };
  useEffect(() => {
    const updateActiveCode = () => {
      const node = window.getSelection()?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      const active = element?.closest('.vditor-wysiwyg__block[data-type="code-block"]');
      host.current
        ?.querySelectorAll('.vditor-wysiwyg__block[data-type="code-block"]')
        .forEach((block) => {
          block.classList.toggle("rich-code-editing", block === active);
        });
    };
    document.addEventListener("selectionchange", updateActiveCode);
    return () => document.removeEventListener("selectionchange", updateActiveCode);
  }, [ready]);
  return (
    <div
      className={`rich-editor flex-1 min-h-0 min-w-0 ${props.compactToolbar ? "rich-editor-compact" : ""}`}
      style={{ fontSize: props.fontSize ?? 14 }}
      data-rich-editor="true"
      onPasteCapture={(event) => {
        if (replayingPaste.current || props.disabled || !instance.current) return;
        const target = event.target as HTMLElement;
        if (!target.closest('[contenteditable="true"]')) return;
        const editor = instance.current;
        const position = captureInsertionPosition(host.current);
        const files = Array.from(event.clipboardData.files).filter(
          (file) => file.type in extensions,
        );
        const data = new DataTransfer();
        for (const type of event.clipboardData.types) {
          if (type !== "Files") data.setData(type, event.clipboardData.getData(type));
        }
        event.preventDefault();
        event.stopPropagation();
        void (async () => {
          try {
            const paths = files.length ? [] : await invoke<string[]>("images_clipboard_paths");
            if (instance.current !== editor) return;
            if (!files.length && !paths.length) {
              restoreInsertionPosition(host.current, position);
              replayingPaste.current = true;
              try {
                target.dispatchEvent(
                  new ClipboardEvent("paste", {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: data,
                  }),
                );
              } finally {
                replayingPaste.current = false;
              }
              return;
            }
            const id = await latest.current.onEnsureNoteSaved();
            if (!id) throw new Error("请先保存笔记再插入图片");
            const links: string[] = [];
            for (const file of files) {
              if (file.size > 20 * 1024 * 1024) throw new Error("图片文件过大（上限 20 MB）");
              links.push(
                await saveImage(
                  id,
                  new Uint8Array(await file.arrayBuffer()),
                  extensions[file.type],
                ),
              );
            }
            for (const path of paths) links.push(await saveImageFromPath(id, path));
            if (instance.current !== editor) return;
            restoreInsertionPosition(host.current, position);
            editor.insertMD(links.map((path) => `![](${path})`).join("\n") + "\n");
            const value = editor.getValue();
            lastValue.current = value;
            latest.current.onChange(value);
          } catch (error) {
            latest.current.onError(error instanceof Error ? error.message : "图片粘贴失败");
          }
        })();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const target = event.target as HTMLElement;
        const editable =
          target.closest<HTMLElement>('[contenteditable="true"]') ??
          host.current?.querySelector<HTMLElement>('[contenteditable="true"]');
        if (!editable || props.disabled) return;
        const image = target.closest<HTMLImageElement>("img") ?? undefined;
        const noteImage = image ? selectedImage(image) : undefined;
        const selection = window.getSelection();
        let range = captureInsertionPosition(host.current);
        const actions: NoteMenuAction[] = [];
        const run = (action: () => void | Promise<void>) => () => {
          closeMenu();
          void Promise.resolve()
            .then(action)
            .catch((e) => latest.current.onError(e instanceof Error ? e.message : String(e)));
        };
        if (image && noteImage && instance.current) {
          const editor = instance.current;
          actions.push({
            label: "预览与标注",
            icon: Scan,
            run: run(() => setViewImage({ src: image.src, image: noteImage, editor })),
          });
          range = document.createRange();
          range.setStartAfter(image);
          range.collapse(true);
        } else if (target.closest("td, th")) {
          const cell = target.closest<HTMLElement>("td, th")!;
          // Ask Vditor to create its own table actions at this exact cell.
          // Reuse these commands so selection, Markdown and undo stay native.
          const cellRange = document.createRange();
          cellRange.selectNodeContents(cell);
          cellRange.collapse(true);
          if (!range || !cell.contains(range.startContainer)) range = cellRange;
          editable.focus();
          selection?.removeAllRanges();
          selection?.addRange(cellRange);
          cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          const commands = [
            ["在上方插入行", "insertRow", 0, Rows3],
            ["在下方插入行", "insertRow", 1, Rows3],
            ["在左侧插入列", "insertColumn", 0, Columns3],
            ["在右侧插入列", "insertColumn", 1, Columns3],
            ["删除当前行", "deleteRow", 0, Trash2],
            ["删除当前列", "deleteColumn", 0, Trash2],
          ] as const;
          const savedRange = cellRange.cloneRange();
          commands.forEach(([label, type, index, icon]) => {
            actions.push({
              label,
              icon,
              danger: type.startsWith("delete"),
              run: run(() => {
                editable.focus();
                restoreInsertionPosition(host.current, savedRange);
                tableCommand.current = { type, index };
                cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              }),
            });
          });
        } else if (target.closest("a[href]")) {
          const url = target.closest<HTMLAnchorElement>("a[href]")!.href;
          if (/^https?:\/\//i.test(url))
            actions.push({ label: "打开链接", icon: ExternalLink, run: run(() => openUrl(url)) });
          actions.push({ label: "复制链接", icon: Link, run: run(() => writeText(url)) });
        } else if (target.closest('[data-type="code-block"]')) {
          const code =
            target.closest('[data-type="code-block"]')!.querySelector("pre > code")?.textContent ??
            "";
          actions.push({ label: "复制代码", icon: Copy, run: run(() => writeText(code)) });
        }
        setMenu({
          x: event.clientX,
          y: event.clientY,
          target: editable,
          range,
          actions,
          element: image,
          noteImage,
          image: noteImage ? { width: noteImage.width } : undefined,
        });
      }}
      onClickCapture={(event) => {
        const image = (event.target as HTMLElement).closest<HTMLImageElement>(
          ".vditor-wysiwyg img",
        );
        const source = image ? selectedImage(image) : undefined;
        if (image && source && instance.current) {
          event.preventDefault();
          event.stopPropagation();
          setViewImage({ src: image.src, image: source, editor: instance.current });
        }
        syncInput();
      }}
      onKeyUpCapture={() => {
        queueMicrotask(convertTaskShorthand);
        syncInput();
      }}
      onKeyDownCapture={(event) => {
        // Disable whole-block shortcuts while retaining ordinary cut/delete/undo.
        if (
          (event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          !event.altKey &&
          ["x", "u", "d"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onInput={(event) => {
        if (!(event.nativeEvent as InputEvent).isComposing) {
          convertTaskShorthand();
          syncInput();
        }
      }}
      onCompositionEnd={() => {
        convertTaskShorthand();
        syncInput();
      }}
    >
      <div ref={host} className="h-full" />
      {menu && (
        <NoteContextMenu
          state={menu}
          onClose={closeMenu}
          actions={menu.actions}
          onCopy={() => {
            const current = menu;
            closeMenu();
            void Promise.resolve()
              .then(() => {
                if (!current.element) {
                  current.target.focus();
                  restoreInsertionPosition(host.current, current.range);
                }
                return copyNoteSelection(current.element?.src);
              })
              .catch((e) => latest.current.onError(String(e)));
          }}
          onPaste={() => {
            const current = menu;
            closeMenu();
            void Promise.resolve()
              .then(() => {
                current.target.focus();
                restoreInsertionPosition(host.current, current.range);
                return pasteNoteClipboard(current.target);
              })
              .catch((e) => latest.current.onError(String(e)));
          }}
          onResize={(width) => {
            try {
              if (menu.noteImage) changeImage(menu.noteImage, { width });
            } catch (e) {
              latest.current.onError(String(e));
            }
            closeMenu();
          }}
        />
      )}
      {viewImage && (
        <ImageViewer
          imageKey={`${viewImage.image.start}:${viewImage.image.url}`}
          position={{ current: galleryIndex + 1, total: gallery.length }}
          onPrevious={galleryIndex > 0 ? () => navigateImage(galleryIndex - 1) : undefined}
          onNext={
            galleryIndex >= 0 && galleryIndex < gallery.length - 1
              ? () => navigateImage(galleryIndex + 1)
              : undefined
          }
          src={viewImage.src}
          alt={viewImage.image.alt}
          onClose={closeViewer}
          onSave={async (blob) => {
            const current = viewImage;
            const id = await latest.current.onEnsureNoteSaved();
            if (!id || instance.current !== current.editor)
              throw Error("笔记已切换，请重新打开图片");
            const url = await saveImage(
              id,
              new Uint8Array(await blob.arrayBuffer()),
              "png",
              current.image.url,
            );
            if (instance.current !== current.editor) throw Error("笔记已切换，请重新打开图片");
            changeImage(current.image, { url });
            // Saving annotations discards the source file after autosave;
            // old undo entries must not resurrect a link to that deleted file.
            current.editor.clearStack();
          }}
        />
      )}
      {ready &&
        editorTools.map(({ name, icon: Icon }) => {
          const target = toolbarRef.current?.querySelector<HTMLElement>(
            `[data-editor-icon="${name}"]`,
          );
          return target
            ? createPortal(<Icon size={14} strokeWidth={1.7} aria-hidden="true" />, target, name)
            : null;
        })}
      {!ready && <span className="text-ink-ghost text-xs">正在加载编辑器……</span>}
    </div>
  );
}
