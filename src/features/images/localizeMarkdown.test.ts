import { describe, expect, it } from "vitest";
import { remoteImageUrls, replaceRemoteImages } from "./localizeMarkdown";

describe("网络图片本地化", () => {
  it("识别直接和引用图片，跳过代码与普通链接并去重", () => {
    const markdown =
      '![一](https://example.com/a.png)\n![二][img]\n\n[img]: https://example.com/a.png "标题"\n[网页](https://example.com/b.png)\n`![代码](https://example.com/c.png)`\n```md\n![代码](https://example.com/d.png)\n```';
    expect(remoteImageUrls(markdown)).toEqual(["https://example.com/a.png"]);
    const result = replaceRemoteImages(
      markdown,
      new Map([["https://example.com/a.png", "images/id/本地.png"]]),
    );
    expect(result).toContain("![一](<images/id/本地.png>)");
    expect(result).toContain('![二](<images/id/本地.png> "标题")');
    expect(result).toContain("[网页](https://example.com/b.png)");
    expect(result).toContain("![代码](https://example.com/d.png)");
  });
  it("保留失败链接和下载期间新增文字", () => {
    const content = "![成功](https://example.com/a) ![失败](https://example.com/b)\n新增文字";
    expect(
      replaceRemoteImages(content, new Map([["https://example.com/a", "images/id/a.png"]])),
    ).toBe("![成功](<images/id/a.png>) ![失败](https://example.com/b)\n新增文字");
  });
});
