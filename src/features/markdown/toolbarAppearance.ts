import type Vditor from "vditor";
export const editorTools = [
  { name: "bold", label: "B", style: "font-bold", title: "粗体", action: "bold" },
  { name: "italic", label: "I", style: "italic", title: "斜体", action: "italic" },
  { name: "headings", label: "H", style: "font-bold", title: "标题", action: "heading" },
  { name: "line", label: "—", style: "", title: "分割线", action: "hr" },
  { name: "list", label: "•", style: "", title: "无序列表", action: "ul" },
  { name: "ordered-list", label: "1.", style: "font-mono", title: "有序列表", action: "ol" },
  { name: "code", label: "<>", style: "font-mono", title: "代码块", action: "codeBlock" },
  { name: "quote", label: "❝", style: "", title: "引用", action: "quote" },
  { name: "strike", label: "S", style: "line-through", title: "删除线", action: "strike" },
  { name: "check", label: "☑", style: "", title: "任务列表", action: "check" },
  { name: "inline-code", label: "`", style: "font-mono", title: "行内代码", action: "code" },
  { name: "link", label: "↗", style: "", title: "链接", action: "link" },
  { name: "upload", label: "▧", style: "", title: "图片", action: "upload" },
  { name: "table", label: "▦", style: "", title: "表格", action: "table" },
  { name: "inlineMath", label: "∑", style: "font-mono", title: "行内公式", action: "inlineMath" },
  { name: "blockMath", label: "∫", style: "font-mono", title: "块级公式", action: "blockMath" },
  { name: "undo", label: "↶", style: "", title: "撤销", action: "undo" },
  { name: "redo", label: "↷", style: "", title: "重做", action: "redo" },
] as const;
export function createRichToolbar(editor: () => Vditor) {
  return editorTools.map(({ name, label, style, title }) => ({
    name,
    tip: title,
    icon: `<span class="editor-tool-symbol ${style}">${label === "<>" ? "&lt;&gt;" : label}</span>`,
    ...(name === "inlineMath" || name === "blockMath"
      ? {
          click: () => {
            const instance = editor();
            const text = instance.getSelection() || "E=mc^2";
            instance.insertMD(name === "inlineMath" ? `$${text}$` : `\n$$\n${text}\n$$\n`);
          },
        }
      : {}),
  }));
}
