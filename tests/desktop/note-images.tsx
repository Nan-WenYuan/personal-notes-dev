import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { RichEditor } from "../../src/features/markdown/RichEditor";
import { MarkdownPreview } from "../../src/features/markdown/MarkdownPreview";
import type { Note } from "../../src/features/notes/types";
import "../../src/App.css";

const root = createRoot(document.getElementById("root")!);
let content = "";
let failure: string | null = null;
let revision = 0;
function Harness({ note, base }: { note: Note; base: string }) {
  const [value, setValue] = useState(note.content);
  return (
    <div style={{ height: 600, display: "flex", flexDirection: "column" }} data-revision={revision}>
      <RichEditor
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
    "通过：真实 PNG 粘贴、编辑/预览显示、中文空格路径、重命名移动及重新打开";
  await invoke("image_verification_report", { error: null });
} catch (error) {
  document.getElementById("result")!.textContent = String(error);
  await invoke("image_verification_report", { error: String(error) });
}
