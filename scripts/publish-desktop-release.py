"""Publish Windows and Apple Silicon artifacts with the native update manifest."""
import hashlib
import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent.parent
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    repo = os.environ.get("GITHUB_REPOSITORY", "Nan-WenYuan/personal-notes-dev")
    token = os.environ["GITHUB_TOKEN"]
    tag = f"v{version}"
    folder = Path(sys.argv[1])
    assets = []
    for platform, arch, kind, suffix in [
        ("windows", "x86_64", "portable_exe", "windows_x64_portable.exe"),
        ("macos", "aarch64", "app_zip", "macos_aarch64.dmg"),
    ]:
        source_name = f"floral-notepaper_{version}_{suffix}"
        name = "Huajian.exe" if platform == "windows" else "Huajian-macOS.dmg"
        path = folder / source_name
        if not path.exists():
            path = folder / name
        if not path.is_file() or not path.stat().st_size:
            raise RuntimeError(f"Missing release asset: {name}")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        assets.append(dict(os=platform, arch=arch, kind=kind, name=name,
                           size=path.stat().st_size, sha256=digest,
                           githubUrl=f"https://github.com/{repo}/releases/download/{tag}/{urllib.parse.quote(name)}"))
        if path.name != name:
            path.rename(folder / name)
    notes = "新增 Apple Silicon macOS DMG 及应用内更新；Windows 便携版同步发布。Mac 使用 ad-hoc 签名，未经过 Apple 公证，尚需实机验证。打开 DMG 后将花笺拖到应用程序目录，数据保存在用户目录。"
    manifest = dict(schemaVersion=1, appId="com.floral-notepaper.app", productName="花笺",
                    channel="stable", version=version, tag=tag,
                    publishedAt=datetime.now(timezone.utc).isoformat(), mandatory=False,
                    allowDowngrade=False, releaseNotes=notes, assets=assets)
    (folder / "update-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    def request(method, url, body=None, content_type="application/json"):
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        req = urllib.request.Request(url, data=data, method=method,
              headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                       "Content-Type": content_type, "X-GitHub-Api-Version": "2022-11-28"})
        with urllib.request.urlopen(req, timeout=180) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    api = f"https://api.github.com/repos/{repo}/releases"
    releases = request("GET", api + "?per_page=100")
    release = next((r for r in releases if r["tag_name"] == tag), None)
    if release and not release["draft"]:
        expected = {a["name"] for a in assets} | {"update-manifest.json"}
        if not expected.issubset({a["name"] for a in release["assets"]}):
            raise RuntimeError("Published release incomplete; refusing to overwrite")
        print(f"Already published: {tag}")
        return
    if not release:
        release = request("POST", api, dict(tag_name=tag, target_commitish=os.environ["GITHUB_SHA"],
                          name=f"花笺 {version}", body=notes, draft=True, prerelease=False))
    names = {a["name"] for a in assets} | {"update-manifest.json"}
    for existing in release["assets"]:
        if existing["name"] in names:
            request("DELETE", existing["url"])
    for name in sorted(names):
        print(f"Uploading: {name}", flush=True)
        request("POST", release["upload_url"].split("{")[0] + "?name=" + urllib.parse.quote(name),
                (folder / name).read_bytes(), "application/octet-stream")
    request("PATCH", release["url"], dict(draft=False))
    print(f"Published: https://github.com/{repo}/releases/tag/{tag}")


if __name__ == "__main__":
    main()
