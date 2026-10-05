import { useEffect, useRef, useState, useImperativeHandle } from "react";
import type { Ref } from "react";
import Vditor from "vditor";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { saveImage } from "../images/api";
import "vditor/dist/index.css";
import "./richEditor.css";

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
  const [ready, setReady] = useState(false);
  useImperativeHandle(
    props.editorRef,
    () => ({
      focus: () => instance.current?.focus(),
      insertMarkdown: (value) => {
        instance.current?.insertMD(value);
      },
      undo: () => host.current?.querySelector<HTMLButtonElement>('[data-type="undo"]')?.click(),
      redo: () => host.current?.querySelector<HTMLButtonElement>('[data-type="redo"]')?.click(),
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
        toolbar: [
          "headings",
          "bold",
          "italic",
          "strike",
          "list",
          "ordered-list",
          "check",
          "quote",
          "code",
          "inline-code",
          "link",
          "upload",
          "table",
          "undo",
          "redo",
        ],
        toolbarConfig: { pin: true },
        preview: {
          maxWidth: 10000,
          markdown: {
            sanitize: true,
            linkBase: props.imageBaseDir
              ? convertFileSrc(props.imageBaseDir.replace(/\\/g, "/") + "/")
              : "",
            codeBlockPreview: false,
          },
          hljs: { enable: false },
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
                editor.insertMD(lines.join("\n") + "\n");
                emit(editor.getValue());
              }
              return "";
            } catch (error) {
              const message = error instanceof Error ? error.message : "图片粘贴失败";
              latest.current.onError(message);
              return message;
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
  return (
    <div
      className="rich-editor flex-1 min-h-0 min-w-0"
      style={{ fontSize: props.fontSize ?? 14 }}
      data-rich-editor="true"
      onContextMenu={(event) => event.stopPropagation()}
      onInput={(event) => {
        if (!(event.nativeEvent as InputEvent).isComposing) syncInput();
      }}
      onCompositionEnd={syncInput}
    >
      <div ref={host} className="h-full" />
      {!ready && <span className="text-ink-ghost text-xs">正在加载编辑器……</span>}
    </div>
  );
}
