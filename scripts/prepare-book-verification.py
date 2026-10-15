"""Prepare public and synthetic samples for tests/desktop/book-reader.html.

Run from the repository root, then open the HTML with the normal Vite server.
Samples stay in Docs/临时 and must never be included in releases.
"""

from pathlib import Path
import hashlib
import json
import shutil
import struct
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "Docs/临时/书籍完整验收/样书"
SOURCES = {
    "Alice-MOBI.mobi": "https://www.gutenberg.org/ebooks/11.kindle.images",
    "Alice-KF8.azw3": "https://www.gutenberg.org/ebooks/11.kf8.images",
    "Alice-EPUB.epub": "https://www.gutenberg.org/ebooks/11.epub3.images",
    "PDF-多页验收.pdf": "https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf",
}


def main():
    SAMPLES.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        target = SAMPLES / name
        if not target.exists():
            request = urllib.request.Request(url, headers={"User-Agent": "FloralBookVerification/1.0"})
            with urllib.request.urlopen(request, timeout=60) as response:
                target.write_bytes(response.read())
        if not target.stat().st_size:
            raise ValueError(f"Empty sample: {name}")

    for name, expected in [("Alice-MOBI.mobi", 6), ("Alice-KF8.azw3", 8)]:
        data = (SAMPLES / name).read_bytes()
        offset = struct.unpack_from(">I", data, 78)[0]
        version = struct.unpack_from(">I", data, offset + 36)[0]
        encryption = struct.unpack_from(">H", data, offset + 12)[0]
        if version != expected or encryption:
            raise ValueError(f"Expected unencrypted MOBI {expected}: {name}")

    # AZW compatibility uses the same unencrypted MOBI 6 container. This is not
    # an independently sourced AZW book and does not test DRM support.
    shutil.copyfile(SAMPLES / "Alice-MOBI.mobi", SAMPLES / "Alice-AZW.azw")
    (SAMPLES / "TXT-中文章节.txt").write_text(
        "\n".join(
            f"第{chapter}章 章节测试\n"
            + "\n".join(
                f"正文第{line}行：阅读进度和目录跳转验收，当前段落属于章节{chapter}。"
                for line in range(1, 101)
            )
            for chapter in range(1, 5)
        ), encoding="utf-8",
    )
    (SAMPLES / "FB2-章节验收.fb2").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">'
        '<description><title-info><genre>fiction</genre><author>'
        '<first-name>QA</first-name><last-name>Test</last-name></author>'
        '<book-title>FB2 阅读验收</book-title><lang>zh</lang></title-info></description><body>'
        + "".join(
            f'<section><title><p>第{chapter}章 章节验收</p></title>'
            + "".join(f'<p>第{chapter}章第{line}段：正文阅读、目录跳转、续读验收。</p>' for line in range(80))
            + '</section>' for chapter in range(1, 4)
        ) + '</body></FictionBook>', encoding="utf-8",
    )
    with zipfile.ZipFile(SAMPLES / "Alice-EPUB.epub") as source:
        name = next(name for name in source.namelist() if name.lower().endswith((".jpg", ".png")))
        image, suffix = source.read(name), Path(name).suffix
    with zipfile.ZipFile(SAMPLES / "CBZ-插图验收.cbz", "w") as target:
        for page in range(1, 4):
            target.writestr(f"{page:03d}{suffix}", image)
    manifest = [
        {"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "source": SOURCES.get(path.name, "synthetic compatibility sample")}
        for path in sorted(SAMPLES.iterdir()) if path.is_file()
    ]
    (SAMPLES.parent / "samples.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Prepared {len(manifest)} samples in {SAMPLES}")


if __name__ == "__main__":
    main()
