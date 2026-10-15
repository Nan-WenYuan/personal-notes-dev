import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Pin the upstream engine in package-lock; ship its native ES modules offline.
const root = resolve("public/book-engine");
mkdirSync(resolve(root, "vendor"), { recursive: true });
for (const file of readdirSync("node_modules/foliate-js")) {
  if (file.endsWith(".js") && !["reader.js", "pdf.js"].includes(file)) {
    cpSync(resolve("node_modules/foliate-js", file), resolve(root, file));
  }
}
for (const file of ["zip.js", "fflate.js"]) {
  cpSync(resolve("node_modules/foliate-js/vendor", file), resolve(root, "vendor", file));
}
// Expose the reader DOM for host accessibility/inspection; book isolation is enforced by CSP.
for (const file of ["view.js", "paginator.js", "fixed-layout.js"]) {
  const path = resolve(root, file);
  const source = readFileSync(path, "utf8");
  const marker = "attachShadow({ mode: 'closed' })";
  if (source.split(marker).length !== 2) throw new Error(`Reader shadow adapter mismatch: ${file}`);
  writeFileSync(path, source.replace(marker, "attachShadow({ mode: 'open' })"));
}
// Load already-sanitized HTML as srcdoc: embedded webviews may reject blob iframe navigation.
// Keep the upstream renderer/pagination intact and fail loudly if the pinned source changes.
for (const [file, frame] of [
  ["paginator.js", "this.#iframe"],
  ["fixed-layout.js", "iframe"],
]) {
  const path = resolve(root, file);
  const source = readFileSync(path, "utf8");
  const marker = `${frame}.src = src`;
  if (source.split(marker).length !== 2) throw new Error(`Reader adapter mismatch: ${file}`);
  writeFileSync(
    path,
    source.replace(
      marker,
      `if (src.startsWith('data:text/html,')) ${frame}.srcdoc = decodeURIComponent(src.slice(15)); else ${marker}`,
    ),
  );
}
cpSync(resolve("node_modules/foliate-js/LICENSE"), resolve(root, "LICENSE-foliate-js"));
// SVG comic pages require their MIME type; raster images are sniffed by the browser.
const comicPath = resolve(root, "comic-book.js");
writeFileSync(
  comicPath,
  readFileSync(comicPath, "utf8")
    .replace(
      "await loadBlob(name)",
      "await loadBlob(name, name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : undefined)",
    )
    .replace("name.endsWith(ext)", "name.toLowerCase().endsWith(ext)"),
);
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  cpSync(resolve("node_modules/pdfjs-dist", dir), resolve(root, "pdf", dir), { recursive: true });
}
cpSync(resolve("node_modules/pdfjs-dist/LICENSE"), resolve(root, "LICENSE-pdfjs"));
for (const name of ["zip-js", "fflate"]) {
  cpSync(resolve("src/assets/licenses", `${name}.txt`), resolve(root, `LICENSE-${name}`));
}
