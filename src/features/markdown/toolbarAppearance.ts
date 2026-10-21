import type Vditor from "vditor";
import {
  Bold,
  Italic,
  Heading,
  Minus,
  List,
  ListOrdered,
  FileCode2,
  Quote,
  Strikethrough,
  ListTodo,
  CodeXml,
  Link,
  ImagePlus,
  Table2,
  Sigma,
  SquareFunction,
  Undo2,
  Redo2,
} from "lucide-react";
export const editorTools = [
  { name: "bold", icon: Bold, title: "粗体", action: "bold" },
  { name: "italic", icon: Italic, title: "斜体", action: "italic" },
  { name: "headings", icon: Heading, title: "标题", action: "heading" },
  { name: "line", icon: Minus, title: "分割线", action: "hr" },
  { name: "list", icon: List, title: "无序列表", action: "ul" },
  { name: "ordered-list", icon: ListOrdered, title: "有序列表", action: "ol" },
  { name: "code", icon: FileCode2, title: "代码块", action: "codeBlock" },
  { name: "quote", icon: Quote, title: "引用", action: "quote" },
  { name: "strike", icon: Strikethrough, title: "删除线", action: "strike" },
  { name: "check", icon: ListTodo, title: "任务列表", action: "check" },
  { name: "inline-code", icon: CodeXml, title: "行内代码", action: "code" },
  { name: "link", icon: Link, title: "链接", action: "link" },
  { name: "upload", icon: ImagePlus, title: "图片", action: "upload" },
  { name: "table", icon: Table2, title: "表格", action: "table" },
  { name: "inlineMath", icon: Sigma, title: "行内公式", action: "inlineMath" },
  { name: "blockMath", icon: SquareFunction, title: "块级公式", action: "blockMath" },
  { name: "undo", icon: Undo2, title: "撤销", action: "undo" },
  { name: "redo", icon: Redo2, title: "重做", action: "redo" },
] as const;
export function createRichToolbar(editor: () => Vditor, compact = false) {
  const tools = editorTools.map(({ name, title }) => ({
    name,
    tip: title,
    icon: `<span class="editor-tool-icon" data-editor-icon="${name}" aria-hidden="true"></span>`,
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
  if (!compact) return tools;
  const common = new Set(["bold", "italic", "headings", "list", "check"]);
  return [
    ...tools.filter((tool) => common.has(tool.name)),
    { name: "more", tip: "更多格式", toolbar: tools.filter((tool) => !common.has(tool.name)) },
  ];
}
