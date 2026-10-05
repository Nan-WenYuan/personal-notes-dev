[CmdletBinding()]
param([ValidateSet('RC', 'R')][string]$Type = 'RC', [switch]$BuildOnly)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$temporaryDir = Join-Path $repoRoot 'Docs/临时/便携打包'
New-Item -ItemType Directory -Path $temporaryDir -Force | Out-Null
$overridePath = Join-Path $temporaryDir 'tauri-portable.json'
@{ build = @{ beforeBuildCommand = 'npm run build' } } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $overridePath -Encoding utf8
$oldStrip = $env:CARGO_PROFILE_RELEASE_STRIP
$oldPortable = $env:NOTES_PORTABLE_BUILD
$oldFrontendPortable = $env:VITE_PORTABLE_BUILD
Push-Location $repoRoot
try {
    $env:CARGO_PROFILE_RELEASE_STRIP = 'symbols'
    $env:NOTES_PORTABLE_BUILD = '1'
    $env:VITE_PORTABLE_BUILD = '1'
    & npm.cmd run tauri -- build --no-bundle --config $overridePath
    if ($LASTEXITCODE -ne 0) { throw "Release build failed: $LASTEXITCODE" }
    $binary = Join-Path $repoRoot 'src-tauri/target/release/floral-notepaper.exe'
    if (-not (Test-Path -LiteralPath $binary)) { throw "Executable missing: $binary" }
    if ($BuildOnly) { Write-Output "BUILT_EXECUTABLE=$binary"; return }
    $timestamp = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'China Standard Time').ToString('yyMMdd_HHmmss')
    $outputDir = Join-Path $repoRoot "交付/花笺"
    $outputExe = Join-Path $outputDir "花笺.exe"
    if (@(Get-Process | Where-Object { $_.Path -eq $outputExe }).Count -gt 0) { throw "请先退出正在运行的花笺；配置和数据不会修改。" }
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    Copy-Item -LiteralPath $binary -Destination (Join-Path $outputDir '花笺.exe')
    $licensesDir = Join-Path $outputDir '许可证'
    New-Item -ItemType Directory -Path $licensesDir -Force | Out-Null
    foreach ($name in @('LICENSE', 'THIRD_PARTY_NOTICES.md')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot $name) -Destination $licensesDir
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot 'src/assets/fonts/LICENSE_Fonts') -Destination $licensesDir
    Copy-Item -LiteralPath (Join-Path $repoRoot 'src/assets/fonts/LICENSE_SourceHanSerif') -Destination $licensesDir
    Write-Output "PORTABLE_OUTPUT=$outputDir"
    Get-Item -LiteralPath (Join-Path $outputDir '花笺.exe') | Select-Object FullName, Length
} finally {
    $env:CARGO_PROFILE_RELEASE_STRIP = $oldStrip
    $env:NOTES_PORTABLE_BUILD = $oldPortable
    $env:VITE_PORTABLE_BUILD = $oldFrontendPortable
    Pop-Location
    Remove-Item -LiteralPath $overridePath -Force -ErrorAction SilentlyContinue
    if ((Test-Path -LiteralPath $temporaryDir) -and @(Get-ChildItem -LiteralPath $temporaryDir -Force).Count -eq 0) {
        Remove-Item -LiteralPath $temporaryDir -Force
    }
}
