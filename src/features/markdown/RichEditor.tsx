import { useEffect, useRef, useState, useImperativeHandle } from "react";
import type { Ref } from "react";
import Vditor from "vditor";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { saveImage, saveImageFromPath } from "../images/api";
import { createRichToolbar } from "./toolbarAppearance";
import { captureInsertionPosition, restoreInsertionPosition } from "./insertionPosition";
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
  const latest = useRef(props);
  latest.current = props;
  const lastValue = useRef(props.content);
  const replayingPaste = useRef(false);
  const [ready, setReady] = useState(false);
  useImperativeHandle(
    props.editorRef,
    () => ({
      focus: () => instance.current?.focus(),
      insertMarkdown: (value) => {
        instance.current?.insertMD(value);
        syncInput();
      },
      undo: () => {
        host.current?.querySelector<HTMLButtonElement>('[data-type="undo"]')?.click();
        syncInput();
      },
      redo: () => {
        host.current?.querySelector<HTMLButtonElement>('[data-type="redo"]')?.click();
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
        toolbar: createRichToolbar(() => editor),
        toolbarConfig: { pin: true },
        customWysiwygToolbar: (type, toolbar) => {
          toolbar
            .querySelectorAll('[data-type="up"], [data-type="down"], [data-type="remove"]')
            .forEach((button) => button.remove());
          if (type === "heading" || type === "code-block") toolbar.replaceChildren();
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
      if (editor && instance.current === editor) {
        editor.destroy();
        instance.current = null;
      }
      mount.remove();
    };
  }, [props.imageBaseDir]);

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
    host.current?.querySelector<HTMLButtonElement>('[data-type="check"]')?.click();
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
      className="rich-editor flex-1 min-h-0 min-w-0"
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
      onContextMenu={(event) => event.stopPropagation()}
      onClickCapture={syncInput}
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
      {!ready && <span className="text-ink-ghost text-xs">正在加载编辑器……</span>}
    </div>
  );
}
