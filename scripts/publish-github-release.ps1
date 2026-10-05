[CmdletBinding()]
param([Parameter(Mandatory)][string]$Executable, [string]$Target = 'main', [string]$ReleaseNotes = '自用开发版本：配置和笔记保存在 EXE 同级；从本仓库下载更新，只替换程序，保留用户数据。')
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repository = 'Nan-WenYuan/personal-notes-dev'
$version = (Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$binary = Get-Item -LiteralPath $Executable
if ($binary.VersionInfo.ProductVersion -ne $version) { throw 'Executable version differs from package.json' }
$assetName = "floral-notepaper_${version}_windows_x64_portable.exe"
$tag = "v$version"
$temporaryDir = Join-Path $repoRoot 'Docs/临时/GitHub发布'
New-Item -ItemType Directory -Path $temporaryDir -Force | Out-Null
$manifestPath = Join-Path $temporaryDir 'update-manifest.json'
$hash = (Get-FileHash -LiteralPath $binary.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = @{
    schemaVersion=1; appId='com.floral-notepaper.app'; productName='花笺'; channel='stable'
    version=$version; tag=$tag; publishedAt=[DateTimeOffset]::UtcNow.ToString('o')
    mandatory=$false; allowDowngrade=$false
    releaseNotes=$ReleaseNotes
    assets=@(@{ os='windows'; arch='x86_64'; kind='portable_exe'; name=$assetName; sha256=$hash; size=$binary.Length
        githubUrl="https://github.com/$repository/releases/download/$tag/$assetName" })
}
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
$token = $env:GITHUB_TOKEN
if (-not $token) {
    $credentialText = "protocol=https`nhost=github.com`n`n" | git credential fill
    if ($LASTEXITCODE -ne 0) { throw 'GitHub authentication unavailable' }
    foreach ($line in $credentialText) { if ($line -match '^password=(.*)$') { $token = $matches[1] } }
}
if (-not $token) { throw 'GitHub authentication unavailable' }
$headers = @{ Authorization="Bearer $token"; Accept='application/vnd.github+json'; 'X-GitHub-Api-Version'='2022-11-28' }
try {
    $existingRelease = $null
    try {
        $existingRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases/tags/$tag" -Headers $headers
    } catch {
        if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 404) { throw }
        # The tag endpoint excludes unpublished drafts. Recover the existing draft from the list.
        $draftReleases = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases?per_page=100" -Headers $headers
        $existingRelease = $draftReleases | Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1
    }
    if ($existingRelease -and -not $existingRelease.draft) {
        $publishedNames = @($existingRelease.assets | ForEach-Object { $_.name })
        if ($assetName -notin $publishedNames -or 'update-manifest.json' -notin $publishedNames) { throw 'Published release is incomplete; refusing to overwrite it' }
        Write-Output "Already published: $tag; existing release assets preserved"
        return
    }
    $body = @{ tag_name=$tag; target_commitish=$Target; name="花笺 $version 自用便携版"; draft=$true; prerelease=$false
        body="$ReleaseNotes`n`n自用笔记软件开发。Windows x64 便携 EXE，无安装包、无压缩包。首次使用请将 EXE 重命名为花笺.exe，所需许可文本位于源码 LICENSE 与 src/assets/fonts。旧版首次切换只替换 EXE，保留配置和数据目录。1.4.0 起支持本仓库应用内更新。SHA256: $hash" } | ConvertTo-Json
    if ($existingRelease) {
        $release = $existingRelease
        foreach ($draftAsset in $release.assets) {
            if ($draftAsset.name -in @($assetName, 'update-manifest.json')) {
                Invoke-RestMethod -Method Delete -Uri $draftAsset.url -Headers $headers | Out-Null
            }
        }
    } else {
        $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repository/releases" -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json'
    }
    $uploadBase = $release.upload_url -replace '\{.*$', ''
    foreach ($asset in @(@{path=$binary.FullName;name=$assetName},@{path=$manifestPath;name='update-manifest.json'})) {
        Write-Output ('Uploading: ' + $asset.name)
        $curlFile = $asset.path.Replace('\', '\\').Replace('"', '\"')
        $curlConfig = @"
url = "$uploadBase`?name=$($asset.name)"
request = "POST"
header = "Authorization: Bearer $token"
header = "Accept: application/vnd.github+json"
header = "Content-Type: application/octet-stream"
data-binary = "@$curlFile"
connect-timeout = 15
max-time = 300
fail-with-body
show-error
progress-bar
"@
        $oldOutputEncoding = $OutputEncoding
        try {
            $OutputEncoding = [Text.UTF8Encoding]::new($false)
            $curlConfig | & curl.exe --config - | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Release asset upload failed: $LASTEXITCODE" }
        } finally {
            $OutputEncoding = $oldOutputEncoding
            $curlConfig = $null
        }
    }
    Invoke-RestMethod -Method Patch -Uri $release.url -Headers $headers -Body '{"draft":false}' -ContentType 'application/json' | Out-Null
    Write-Output ("Published: https://github.com/$repository/releases/tag/$tag")
} catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'network' }
    throw "GitHub publish failed ($status). Any draft release is retained for recovery."
} finally {
    $token = $null; $headers = $null; $credentialText = $null
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
    if (@(Get-ChildItem -LiteralPath $temporaryDir -Force).Count -eq 0) { Remove-Item -LiteralPath $temporaryDir -Force }
}
