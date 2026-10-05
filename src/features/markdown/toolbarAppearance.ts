// Use the same compact text symbols as the Markdown source toolbar.
export const richToolbar = [
  ["bold", "B", "font-bold"],
  ["italic", "I", "italic"],
  ["headings", "H", "font-bold"],
  ["line", "—", ""],
  ["list", "•", ""],
  ["ordered-list", "1.", "font-mono"],
  ["code", "&lt;&gt;", "font-mono"],
  ["quote", "❝", ""],
  ["strike", "S", "line-through"],
  ["check", "☑", ""],
  ["inline-code", "`", "font-mono"],
  ["link", "↗", ""],
  ["upload", "▧", ""],
  ["table", "▦", ""],
  ["undo", "↶", ""],
  ["redo", "↷", ""],
].map(([name, label, style]) => ({
  name,
  icon: `<span class="editor-tool-symbol ${style}">${label}</span>`,
}));
