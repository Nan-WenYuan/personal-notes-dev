import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Windows portable development keeps data beside the executable in target.
// Use the same allowlist and integrity checks as the manual cleanup command.
if (process.platform === "win32") {
  const limit = process.env.ZHIXING_RUST_CACHE_LIMIT_GIB ?? "10";
  if (!Number.isFinite(Number(limit)) || Number(limit) <= 0 || Number(limit) > 1048576) {
    throw new Error(
      "ZHIXING_RUST_CACHE_LIMIT_GIB must be a positive number no greater than 1048576.",
    );
  }
  const script = fileURLToPath(new URL("./clean-rust-cache.ps1", import.meta.url));
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-Automatic",
      "-MaxCacheGiB",
      limit,
    ],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
