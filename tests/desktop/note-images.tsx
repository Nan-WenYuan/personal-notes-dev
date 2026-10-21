import React, { createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { RichEditor, type RichEditorHandle } from "../../src/features/markdown/RichEditor";
import { MarkdownPreview } from "../../src/features/markdown/MarkdownPreview";
import type { Note } from "../../src/features/notes/types";
import "../../src/App.css";
import { noteImages } from "../../src/features/images/imageMarkup";

const root = createRoot(document.getElementById("root")!);
const editorRef = createRef<RichEditorHandle>();
let content = "";
let failure: string | null = null;
let revision = 0;
function Harness({ note, base }: { note: Note; base: string }) {
  const [value, setValue] = useState(note.content);
  return (
    <div style={{ height: 600, display: "flex", flexDirection: "column" }} data-revision={revision}>
      <RichEditor
        editorRef={editorRef}
        content={value}
        onChange={(v) => {
          content = v;
          setValue(v);
        }}
        onEnsureNoteSaved={async () => note.id}
        imageBaseDir={base}
        onError={(message) => {
          failure = message;
        }}
      />
      <div id="split-preview">
        <MarkdownPreview content={value} imageBaseDir={base} />
      </div>
    </div>
  );
}
async function until(test: () => boolean, label: string) {
  const start = performance.now();
  while (!test()) {
    if (failure) throw Error(failure);
    if (performance.now() - start > 8000) throw Error(label);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function mount(note: Note) {
  const base = await invoke<string>("images_get_base_dir", { noteId: note.id });
  content = note.content;
  revision++;
  root.render(<Harness key={revision} note={note} base={base} />);
  await until(
    () => !!document.querySelector(`[data-revision="${revision}"] .editor-tool-icon svg`),
    "editor did not initialize",
  );
}
async function checkImages() {
  await until(() => {
    const rich = document.querySelector<HTMLImageElement>(".vditor-wysiwyg img");
    const preview = document.querySelector<HTMLImageElement>("#split-preview img");
    return rich?.naturalWidth === 32 && preview?.naturalWidth === 32;
  }, "image failed to load through the native asset protocol");
}
try {
  const id = await invoke<string>("image_verification_fixture");
  await mount(await invoke<Note>("notes_get", { id }));
  const bytes = await (await fetch("/src-tauri/icons/32x32.png")).arrayBuffer();
  const editor = document.querySelector<HTMLElement>('.vditor-wysiwyg [contenteditable="true"]')!;
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const clipboard = new DataTransfer();
  clipboard.items.add(new File([bytes], "中文 图片.png", { type: "image/png" }));
  editor.dispatchEvent(
    new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }),
  );
  await checkImages();
  if (!content.includes("![](") || content.includes("asset.localhost"))
    throw Error("saved image link must remain relative");
  const original = noteImages(content)[0];
  const originalElement = document.querySelector<HTMLImageElement>(".vditor-wysiwyg img")!;
  const originalBytes = await (await fetch(originalElement.src)).arrayBuffer();
  // Exercise the actual menu: width persists, the HTML image has no code background,
  // and outside clicks dismiss it rather than leaving it over the editor.
  originalElement.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }),
  );
  await until(() => !!document.querySelector('[role="menu"]'), "image menu did not open");
  [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((button) => button.textContent === "50%")!
    .click();
  await until(() => noteImages(content)[0]?.width === 50, "image width was not saved");
  await checkImages();
  if (document.querySelector<HTMLImageElement>("#split-preview img")!.style.width !== "50%")
    throw Error("split preview did not retain the image width");
  editorRef.current!.undo();
  await until(
    () =>
      noteImages(content)[0]?.url === original.url && noteImages(content)[0]?.width === undefined,
    "image resize was not undoable",
  );
  editorRef.current!.redo();
  await until(() => noteImages(content)[0]?.width === 50, "image resize was not redoable");
  await checkImages();
  const resized = document.querySelector<HTMLImageElement>(".vditor-wysiwyg img")!;
  if (getComputedStyle(resized.parentElement!).backgroundColor !== "rgba(0, 0, 0, 0)")
    throw Error("resized image must not have a block background");
  resized.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await until(() => !!document.querySelector('[role="menu"]'), "image menu did not reopen");
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  await until(
    () => !document.querySelector('[role="menu"]'),
    "outside click did not dismiss image menu",
  );
  // Exercise the actual viewer's text annotation and Save Copy button, using
  // native Tauri asset origins and IPC rather than a browser save mock.
  resized.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await until(
    () =>
      !!document.querySelector(".image-viewer-original") &&
      document.querySelector<HTMLImageElement>(".image-viewer-original")?.naturalWidth === 32,
    "image viewer did not open",
  );
  document.querySelector<HTMLButtonElement>('[aria-label="文字标注"]')!.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const drawingImage = document
    .querySelector<HTMLImageElement>(".image-viewer-original")!
    .getBoundingClientRect();
  document.querySelector(".image-annotation-layer")!.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: drawingImage.left + drawingImage.width / 5,
      clientY: drawingImage.top + drawingImage.height / 5,
    }),
  );
  await until(
    () => !!document.querySelector('[aria-label="标注文字"]'),
    "text annotation did not start",
  );
  const label = document.querySelector<HTMLInputElement>('[aria-label="标注文字"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(label, "A");
  label.dispatchEvent(new Event("input", { bubbles: true }));
  await until(
    () => !document.querySelector<HTMLButtonElement>(".image-save")!.disabled,
    "text annotation did not enable saving",
  );
  label.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await until(
    () => !document.querySelector('[aria-label="标注文字"]'),
    "Enter did not commit text annotation",
  );
  document.querySelector<HTMLButtonElement>(".image-save")!.click();
  await until(
    () => !document.querySelector(".image-viewer") && noteImages(content)[0]?.url !== original.url,
    "annotated copy was not saved by the viewer",
  );
  const copy = noteImages(content)[0].url;
  if (copy === original.url) throw Error("annotation overwrote the original image");
  const unchanged = new Uint8Array(await (await fetch(resized.src)).arrayBuffer());
  if (
    unchanged.length !== originalBytes.byteLength ||
    unchanged.some((byte, i) => byte !== new Uint8Array(originalBytes)[i])
  )
    throw Error("original image was modified");
  await until(
    () =>
      document
        .querySelector<HTMLImageElement>(".vditor-wysiwyg img")
        ?.src.includes(copy.split("/").pop()!) ?? false,
    "annotated copy did not replace the image reference",
  );
  await checkImages();
  document
    .querySelector<HTMLImageElement>(".vditor-wysiwyg img")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await until(() => !!document.querySelector(".image-viewer"), "viewer did not reopen");
  document
    .querySelector(".image-viewer")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await until(() => !document.querySelector(".image-viewer"), "Escape did not close the viewer");
  document.querySelector<HTMLImageElement>("#split-preview img")!.click();
  await until(
    () => !!document.querySelector(".image-viewer"),
    "single click did not open split preview image",
  );
  document.querySelector<HTMLButtonElement>('[aria-label="关闭图片预览"]')!.click();
  await until(() => !document.querySelector(".image-viewer"), "split image preview did not close");
  // Renaming and moving rewrite the attachment path; resolve and authorize the new location.
  const renamed = await invoke<Note>("notes_update", {
    id,
    request: { title: "重命名 图片", content, category: "项目 资料/插图" },
  });
  await mount(renamed);
  await checkImages();
  await mount(await invoke<Note>("notes_get", { id }));
  await checkImages();
  document.getElementById("result")!.textContent =
    "通过：PNG 粘贴、图片比例、透明背景、菜单关闭、原生标注导出和副本保存、重命名移动及重新打开";
  await invoke("image_verification_report", { error: null });
} catch (error) {
  document.getElementById("result")!.textContent = String(error);
  await invoke("image_verification_report", { error: String(error) });
}
