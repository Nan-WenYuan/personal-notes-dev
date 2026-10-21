import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { imageWidth, noteImages, replaceNoteImage, remarkNoteImages } from "./imageMarkup";

describe("note image editing", () => {
  it("changes only the requested occurrence, retaining code, titles and other text", () => {
    const content = '正文\n\n![第一张](图.png "标题")\n\n![第二张](图.png)\n\n`![代码](图.png)`\n';
    const images = noteImages(content);
    expect(images).toHaveLength(2);
    const edited = replaceNoteImage(content, images[1], { width: 37.5 });
    expect(edited).toBe(
      '正文\n\n![第一张](图.png "标题")\n\n<img src="图.png" alt="第二张" style="width:37.5%;" />\n\n`![代码](图.png)`\n',
    );
    expect(noteImages(edited)[1].width).toBe(37.5);
  });
  it("edits a reference image independently of other references", () => {
    const content = '![甲][图]\n\n![乙][图]\n\n[图]: <中文 图片.png> "说明"\n';
    const edited = replaceNoteImage(content, noteImages(content)[0], {
      width: 25,
      url: "新图.png",
    });
    expect(noteImages(edited).map((image) => image.url)).toEqual(["新图.png", "中文 图片.png"]);
    expect(edited).toContain('[图]: <中文 图片.png> "说明"');
  });
  it("escapes attributes and rejects stale edits and invalid widths", () => {
    const content = '<img src="图.png" alt="&quot;&lt;文字&gt;" style="width:50%;" />';
    const image = noteImages(content)[0];
    expect(replaceNoteImage(content, image, { url: '新"图.png' })).toContain(
      'src="新&quot;图.png"',
    );
    expect(() => replaceNoteImage("前缀" + content, image, { width: 10 })).toThrow("笔记已变化");
    for (const width of [0, -1, 101, Infinity, NaN])
      expect(() => replaceNoteImage(content, image, { width })).toThrow();
  });
  it("renders safe image attributes while leaving general HTML disabled", () => {
    const content =
      '<img src="图.png" alt="例子" style="width:50%;position:fixed" onerror="alert(1)" />\n\n<script>alert(1)</script>';
    const tree = unified().use(remarkParse).parse(content);
    remarkNoteImages()(tree);
    const image = tree.children[0];
    expect(image).toMatchObject({
      type: "image",
      url: "图.png",
      data: { hProperties: { style: "width:50%;" } },
    });
    expect(JSON.stringify(image)).not.toContain("onerror");
    expect(tree.children[1].type).toBe("html");
    expect(imageWidth("width:1000%;")).toBeUndefined();
  });
});
