$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskTemp = Join-Path $taskRoot 'Docs/临时/笔记图片原生测试'
$taskRunner = Join-Path $taskTemp 'desktop-test.exe'
$taskManifest = Join-Path $taskTemp 'test.manifest'
$taskStdout = Join-Path $taskTemp 'stdout.log'
$taskStderr = Join-Path $taskTemp 'stderr.log'
$taskSdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$taskMt = Get-ChildItem -LiteralPath $taskSdk -Directory |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64/mt.exe' } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
if (-not $taskMt) { throw '需要 Windows SDK 的 mt.exe 来为原生窗口测试添加 Common Controls 清单。' }
New-Item -ItemType Directory -Path $taskTemp -Force | Out-Null
try {
    $taskLines = & cargo test --offline --manifest-path (Join-Path $taskRoot 'src-tauri/Cargo.toml') --features desktop-verification --lib --no-run --message-format=json
    if ($LASTEXITCODE -ne 0) { throw '原生窗口测试编译失败。' }
    $taskArtifact = $taskLines | ForEach-Object { $_ | ConvertFrom-Json } |
        Where-Object { $_.reason -eq 'compiler-artifact' -and $_.profile.test -and $_.executable } |
        Select-Object -Last 1
    if (-not $taskArtifact) { throw '未找到原生测试程序。' }
    Copy-Item -LiteralPath $taskArtifact.executable -Destination $taskRunner
    # Cargo unit-test executables don't inherit Tauri's application manifest.
    # GUI imports require Common Controls v6 before the executable starts.
    @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency></assembly>
'@ | Set-Content -LiteralPath $taskManifest -Encoding UTF8
    & $taskMt '-manifest' $taskManifest "-outputresource:$taskRunner;#1"
    if ($LASTEXITCODE -ne 0) { throw '原生测试清单写入失败。' }
    $taskProcess = Start-Process -FilePath $taskRunner -ArgumentList 'image_verification::native_note_images_', '--ignored', '--nocapture' -WindowStyle Hidden -RedirectStandardOutput $taskStdout -RedirectStandardError $taskStderr -PassThru
    if (-not $taskProcess.WaitForExit(40000)) {
        # Bound a WebView deadlock; stop only the exact isolated runner created here.
        $taskProcess.Kill()
        $taskProcess.WaitForExit()
        throw '原生窗口验收超时，可能卡在 WebView 创建或 IPC 回调。'
    }
    $taskProcess.Refresh()
    if ($taskProcess.ExitCode -ne 0) { throw '原生窗口验收失败；请确认 localhost:1420 的开发预览正在运行。' }
} finally {
    foreach ($taskLog in @($taskStdout, $taskStderr)) {
        if (Test-Path -LiteralPath $taskLog) { Get-Content -LiteralPath $taskLog }
    }
    # Delete only this runner's exact generated files, never other workspace data.
    foreach ($taskFile in @($taskRunner, $taskManifest, $taskStdout, $taskStderr)) {
        if (Test-Path -LiteralPath $taskFile) { Remove-Item -LiteralPath $taskFile -Force }
    }
    if (-not (Get-ChildItem -LiteralPath $taskTemp -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $taskTemp
    }
}
