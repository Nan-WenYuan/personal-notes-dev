import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";

const windows = process.platform === "win32";

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "知行 cache ' "));
  const retained = [
    "debug/配置/settings.json",
    "debug/数据/note.pdb",
    "debug/floral-notepaper.exe",
    "debug/floral_notepaper_lib.dll",
    "debug/unknown/keep.txt",
    "release/bundle/installer.exe",
    "release/数据/note.md",
  ];
  const caches = [
    "debug/incremental/cache.bin",
    "debug/deps/lib.rlib",
    "release/build/out.bin",
    "debug/example.pdb",
  ];
  const target = join(root, "src-tauri/target");
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(
    new URL("./clean-rust-cache.ps1", import.meta.url),
    join(root, "scripts/clean-rust-cache.ps1"),
  );
  for (const relative of [...retained, ...caches]) {
    const path = join(target, relative);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, `fixture:${relative}`);
  }
  const invoke = (...args) =>
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(root, "scripts/clean-rust-cache.ps1"),
        ...args,
      ],
      { encoding: "utf8", windowsHide: true },
    );
  try {
    run({ root, target, retained, caches, invoke });
  } finally {
    // Only this newly created temporary fixture may be recursively removed.
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  "automatic cleanup keeps small caches and clears large caches while preserving data",
  { skip: !windows },
  () => {
    withFixture(({ target, retained, caches, invoke }) => {
      const below = invoke("-Automatic", "-MaxCacheGiB", "10");
      assert.equal(below.status, 0, below.stderr);
      assert.match(below.stdout, /keeping cache/);
      for (const path of caches) assert.ok(existsSync(join(target, path)));

      const above = invoke("-Automatic", "-MaxCacheGiB", "0.000000001");
      assert.equal(above.status, 0, above.stderr);
      assert.match(above.stdout, /cleaning before build/);
      for (const path of caches) assert.equal(existsSync(join(target, path)), false);
      for (const path of retained)
        assert.equal(readFileSync(join(target, path), "utf8"), `fixture:${path}`);
    });
  },
);

test("threshold cleanup preview never deletes cache or data", { skip: !windows }, () => {
  withFixture(({ target, retained, caches, invoke }) => {
    const result = invoke("-Automatic", "-MaxCacheGiB", "0.000000001", "-WhatIf");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /What\s?if:/i);
    for (const path of [...retained, ...caches])
      assert.equal(readFileSync(join(target, path), "utf8"), `fixture:${path}`);
  });
});

test(
  "cleanup refuses directory junctions without deleting their contents",
  { skip: !windows },
  () => {
    withFixture(({ root, target, caches, invoke }) => {
      const outside = join(root, "outside");
      const link = join(target, "debug/incremental/link");
      mkdirSync(outside);
      writeFileSync(join(outside, "keep.txt"), "keep");
      symlinkSync(outside, link, "junction");
      try {
        const result = invoke("-Automatic", "-MaxCacheGiB", "0.000000001");
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /link or junction/);
        assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep");
        for (const path of caches) assert.ok(existsSync(join(target, path)));
      } finally {
        unlinkSync(link);
      }
    });
  },
);
