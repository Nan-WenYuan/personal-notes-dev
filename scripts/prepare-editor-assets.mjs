import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Keep the editor offline; copy only the renderers this edition supports.
const root = resolve("public/editor/dist");
mkdirSync(root, { recursive: true });
for (const entry of [
  "js/lute",
  "js/i18n",
  "js/icons",
  "js/katex",
  "js/highlight.js",
  "css/content-theme",
  "images/emoji",
]) {
  cpSync(resolve("node_modules/vditor/dist", entry), resolve(root, entry), { recursive: true });
}
cpSync(resolve("node_modules/vditor/LICENSE"), resolve(root, "LICENSE"));
