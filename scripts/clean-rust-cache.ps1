[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Automatic,
    [ValidateRange(0.000000000001, 1048576)][double]$MaxCacheGiB = 10
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$targetRoot = Join-Path $repoRoot 'src-tauri/target'
if (-not (Test-Path -LiteralPath $targetRoot)) { return }

# Never follow a link while inspecting or removing build output.
foreach ($path in @($repoRoot, (Join-Path $repoRoot 'src-tauri'), $targetRoot)) {
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing linked directory: $path"
    }
}
if (@(Get-ChildItem -LiteralPath $targetRoot -Force -Recurse -Attributes ReparsePoint).Count -gt 0) {
    throw 'Refusing cleanup: target contains a link or junction.'
}

$targetPrefix = [IO.Path]::GetFullPath($targetRoot) + [IO.Path]::DirectorySeparatorChar
# Only known cache directories and intermediate file types are eligible.
# Keep EXE/DLL files, configuration, data, installers and unknown directories.
$candidates = @()
$protectedRoots = @()
foreach ($profile in @('debug', 'release')) {
    $profileRoot = Join-Path $targetRoot $profile
    if (-not (Test-Path -LiteralPath $profileRoot)) { continue }
    foreach ($item in Get-ChildItem -LiteralPath $profileRoot -Force) {
        if (($item.PSIsContainer -and $item.Name -in @('.fingerprint', 'build', 'deps', 'examples', 'incremental')) -or
            (-not $item.PSIsContainer -and $item.Extension -in @('.d', '.lib', '.rlib', '.pdb', '.exp'))) {
            $candidates += $item
        } else {
            $protectedRoots += $item
        }
    }
}

$cacheBytes = [long]0
foreach ($item in $candidates) {
    $bytes = if ($item.PSIsContainer) {
        (Get-ChildItem -LiteralPath $item.FullName -File -Force -Recurse | Measure-Object Length -Sum).Sum
    } else { $item.Length }
    $cacheBytes += $bytes
}
if ($Automatic -and $cacheBytes -le ($MaxCacheGiB * 1GB)) {
    Write-Output ('Rust cache: {0:N2} GiB; limit {1:N2} GiB; keeping cache.' -f ($cacheBytes / 1GB), $MaxCacheGiB)
    return
}

$busy = @(Get-Process | Where-Object {
    $_.ProcessName -in @('cargo', 'rustc') -or
    ($_.Path -and $_.Path.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase))
})
if ($busy.Count -gt 0) {
    if ($Automatic) {
        Write-Warning 'Rust builds or target programs are running; cache cleanup deferred until a later build.'
        return
    }
    throw 'Close Rust builds and programs running from target before cleanup.'
}
if ($Automatic) {
    Write-Output ('Rust cache exceeds {0:N2} GiB; cleaning before build.' -f $MaxCacheGiB)
}

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString($algorithm.ComputeHash($stream))
    } finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

function Get-ProtectedSnapshot {
    $snapshot = @{}
    foreach ($item in $protectedRoots) {
        $files = if ($item.PSIsContainer) {
            @(Get-ChildItem -LiteralPath $item.FullName -File -Force -Recurse)
        } else { @($item) }
        foreach ($file in $files) {
            $snapshot[$file.FullName] = Get-Sha256 $file.FullName
        }
    }
    return $snapshot
}

$before = Get-ProtectedSnapshot
$removedBytes = [long]0
foreach ($item in $candidates) {
    $resolved = (Resolve-Path -LiteralPath $item.FullName).ProviderPath
    if (-not $resolved.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing path outside target: $resolved"
    }
    $bytes = if ($item.PSIsContainer) {
        (Get-ChildItem -LiteralPath $resolved -File -Force -Recurse | Measure-Object Length -Sum).Sum
    } else { $item.Length }
    if ($PSCmdlet.ShouldProcess($resolved, 'Remove Rust build cache')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
        $removedBytes += $bytes
    }
}
$after = Get-ProtectedSnapshot
if ($before.Count -ne $after.Count) { throw 'Protected file count changed during cleanup.' }
foreach ($path in $before.Keys) {
    if ($before[$path] -ne $after[$path]) { throw 'Protected file hash changed during cleanup.' }
}
Write-Output ('Removed {0:N2} GiB; verified {1} retained files (SHA256).' -f ($removedBytes / 1GB), $after.Count)
