<#
.SYNOPSIS
  Downloads and verifies the binary tools of the Farfield asset pipeline.

.DESCRIPTION
  Installs locally, inside untracked folders:
    tools/bin/ktx       Khronos texture tools (ktx, toktx) for KTX2 encoding
    tools/blender/...   portable Blender LTS, driven headless by the bake script

  The script is idempotent: a tool that is already present and answers a version
  probe is skipped. Every download is checked against SHA-256 before extraction,
  then the tool is executed once to confirm it actually runs. It finally writes
  tools/bin/toolchain.json, the file the npm scripts read to locate executables.

  The official Blender host is not reachable from every corporate network, so the
  mirror list is walked in order until one answers; they are all official mirrors
  published by Blender.

.PARAMETER Force
  Downloads and reinstalls even when the tool is already present.

.PARAMETER SkipBlender
  Installs the texture toolchain only (useful on CI, where no bake runs).

.PARAMETER BlenderVersion
  LTS version to install (default 4.5.12).

.PARAMETER KtxVersion
  KTX-Software release to install (default 4.4.2).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/setup-tools.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/setup-tools.ps1 -Force
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$SkipBlender,
  [string]$BlenderVersion = '4.5.12',
  [string]$KtxVersion = '4.4.2'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRoot    = Split-Path -Parent $PSScriptRoot
$ToolsRoot   = Join-Path $RepoRoot 'tools'
$BinRoot     = Join-Path $ToolsRoot 'bin'
$BlenderRoot = Join-Path $ToolsRoot 'blender'
$CacheRoot   = Join-Path $BinRoot '.cache'

# Hash of the KTX-Software Windows x64 release: it is the only artefact shipped
# without a checksum next to it, so it is pinned here and has to be updated by
# hand together with KtxVersion.
$KtxSha256 = @{
  '4.4.2' = '1F323B0FEC19794F5E6C0425A61D4B1DA396872A10BE862D105F4F4B2D2957FE'
}

# Official mirrors, in order of preference. The first one is the Blender host.
$BlenderMirrors = @(
  'https://download.blender.org/release',
  'https://mirror.clarkson.edu/blender/release',
  'https://ftp.nluug.nl/pub/graphics/blender/release'
)

function Write-Step([string]$Text) { Write-Host "==> $Text" }
function Write-Note([string]$Text) { Write-Host "    $Text" }

function Get-SevenZip {
  $candidates = @(
    'C:\Program Files\7-Zip\7z.exe',
    'C:\Program Files (x86)\7-Zip\7z.exe'
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $cmd = Get-Command '7z' -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Get-RemoteFile {
  param([string[]]$Urls, [string]$Destination, [int]$MinBytes = 102400)
  $errors = @()
  foreach ($url in $Urls) {
    try {
      Write-Note "download $url"
      $sw = [Diagnostics.Stopwatch]::StartNew()
      Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing -TimeoutSec 900
      $sw.Stop()
      $size = (Get-Item $Destination).Length
      # An intercepting proxy answers 200 with an HTML page instead of the file:
      # that is not a network error and has to be caught here, not downstream.
      $head = ''
      $bytes = Get-Content $Destination -Encoding Byte -TotalCount 64 -ErrorAction SilentlyContinue
      if ($bytes) { $head = [Text.Encoding]::ASCII.GetString($bytes) }
      if ($size -lt $MinBytes -or $head -match '(?i)^\s*(<!doctype|<html)') {
        $errors += "$url returned $size invalid bytes (proxy interception is the likely cause)"
        Remove-Item $Destination -Force -ErrorAction SilentlyContinue
        continue
      }
      Write-Note ("received {0:N1} MB in {1:N1} s" -f ($size / 1MB), $sw.Elapsed.TotalSeconds)
      return $url
    } catch {
      $errors += "$url :: $($_.Exception.Message)"
    }
  }
  throw "no reachable source:`n  " + ($errors -join "`n  ")
}

function Assert-Sha256 {
  param([string]$Path, [string]$Expected)
  $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash
  if ($actual -ne $Expected.ToUpperInvariant()) {
    throw "checksum mismatch for $Path`n  expected $Expected`n  actual   $actual"
  }
  Write-Note "sha256 verified"
}

function Expand-ArchiveFast {
  param([string]$Path, [string]$Destination)
  $sevenZip = Get-SevenZip
  if ($sevenZip) {
    & $sevenZip x $Path "-o$Destination" -y -bso0 -bsp0 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "extraction failed ($Path)" }
  } else {
    Expand-Archive -Path $Path -DestinationPath $Destination -Force
  }
}

# Confirms the executable actually starts and returns its version banner. Some
# tools print the version on stderr, so both streams are read back from files:
# that is the only reliable way to do it in Windows PowerShell 5.1.
function Test-Tool {
  param([string]$Exe, [string[]]$ToolArgs)
  if (-not (Test-Path $Exe)) { return $null }
  $out = [IO.Path]::GetTempFileName()
  $err = [IO.Path]::GetTempFileName()
  try {
    $proc = Start-Process -FilePath $Exe -ArgumentList $ToolArgs -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput $out -RedirectStandardError $err
    if ($proc.ExitCode -ne 0) { return $null }
    $text = Get-Content $out -Raw
    if (-not $text) { $text = Get-Content $err -Raw }
    if (-not $text) { return 'ok' }
    return ($text -split "`r?`n")[0].Trim()
  } catch {
    return $null
  } finally {
    Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Force -Path $BinRoot, $BlenderRoot, $CacheRoot | Out-Null

# --------------------------------------------------------------- KTX-Software
$KtxDir = Join-Path $BinRoot 'ktx'
$KtxExe = Join-Path $KtxDir 'ktx.exe'
$ToktxExe = Join-Path $KtxDir 'toktx.exe'

Write-Step "KTX-Software $KtxVersion"
$ktxVersionLine = Test-Tool -Exe $KtxExe -ToolArgs @('--version')
if ($ktxVersionLine -and -not $Force) {
  Write-Note "already installed: $ktxVersionLine"
} else {
  if (-not $KtxSha256.ContainsKey($KtxVersion)) {
    throw "no known checksum for KTX-Software ${KtxVersion}: add one to the KtxSha256 table"
  }
  $sevenZip = Get-SevenZip
  if (-not $sevenZip) {
    throw "7-Zip is required to unpack the KTX-Software installer (https://www.7-zip.org)"
  }
  $installer = Join-Path $CacheRoot "KTX-Software-$KtxVersion-Windows-x64.exe"
  if ($Force -or -not (Test-Path $installer)) {
    Get-RemoteFile -Urls @("https://github.com/KhronosGroup/KTX-Software/releases/download/v$KtxVersion/KTX-Software-$KtxVersion-Windows-x64.exe") -Destination $installer | Out-Null
  } else {
    Write-Note "installer already cached"
  }
  Assert-Sha256 -Path $installer -Expected $KtxSha256[$KtxVersion]

  $staging = Join-Path $CacheRoot 'ktx-staging'
  if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
  # The installer is just an archive: unpacking it installs nothing system wide.
  & $sevenZip x $installer "-o$staging" 'bin\*' -y -bso0 -bsp0 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "KTX-Software extraction failed" }

  if (Test-Path $KtxDir) { Remove-Item $KtxDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $KtxDir | Out-Null
  Copy-Item (Join-Path $staging 'bin\*') $KtxDir -Recurse -Force
  Remove-Item $staging -Recurse -Force

  $ktxVersionLine = Test-Tool -Exe $KtxExe -ToolArgs @('--version')
  if (-not $ktxVersionLine) { throw "ktx.exe does not answer after installation" }
  Write-Note "installed: $ktxVersionLine"
}

if (-not (Test-Path $ToktxExe)) { Write-Note "warning: toktx.exe not found in $KtxDir" }

# --------------------------------------------------------------------- Blender
$BlenderDir = Join-Path $BlenderRoot "blender-$BlenderVersion-windows-x64"
$BlenderExe = Join-Path $BlenderDir 'blender.exe'
$blenderVersionLine = $null

if ($SkipBlender) {
  Write-Step "Blender $BlenderVersion (skipped)"
} else {
  Write-Step "Blender $BlenderVersion LTS"
  $blenderVersionLine = Test-Tool -Exe $BlenderExe -ToolArgs @('--version')
  if ($blenderVersionLine -and -not $Force) {
    Write-Note "already installed: $blenderVersionLine"
  } else {
    $series = $BlenderVersion -replace '^(\d+\.\d+).*$', '$1'
    $zipName = "blender-$BlenderVersion-windows-x64.zip"
    $zipPath = Join-Path $CacheRoot $zipName
    $sumName = "blender-$BlenderVersion.sha256"
    $sumPath = Join-Path $CacheRoot $sumName

    $sumUrls = $BlenderMirrors | ForEach-Object { "$_/Blender$series/$sumName" }
    Get-RemoteFile -Urls $sumUrls -Destination $sumPath -MinBytes 200 | Out-Null
    $expected = $null
    foreach ($line in Get-Content $sumPath) {
      if ($line -match "^([0-9a-fA-F]{64})\s+\*?(.+)$") {
        if ($Matches[2].Trim() -eq $zipName) { $expected = $Matches[1] }
      }
    }
    if (-not $expected) { throw "no checksum for $zipName inside $sumName" }

    if ($Force -or -not (Test-Path $zipPath)) {
      $zipUrls = $BlenderMirrors | ForEach-Object { "$_/Blender$series/$zipName" }
      Get-RemoteFile -Urls $zipUrls -Destination $zipPath | Out-Null
    } else {
      Write-Note "archive already cached"
    }
    Assert-Sha256 -Path $zipPath -Expected $expected

    if (Test-Path $BlenderDir) { Remove-Item $BlenderDir -Recurse -Force }
    Write-Note "extracting into $BlenderRoot"
    Expand-ArchiveFast -Path $zipPath -Destination $BlenderRoot

    $blenderVersionLine = Test-Tool -Exe $BlenderExe -ToolArgs @('--version')
    if (-not $blenderVersionLine) { throw "blender.exe does not answer after extraction" }
    Write-Note "installed: $blenderVersionLine"
  }
}

# ------------------------------------------------------------- toolchain.json
$toolchain = [ordered]@{
  generatedAt = (Get-Date).ToString('s')
  ktx = [ordered]@{
    version = $KtxVersion
    exe     = $KtxExe
    toktx   = $ToktxExe
    banner  = $ktxVersionLine
  }
  blender = [ordered]@{
    version = $BlenderVersion
    exe     = $BlenderExe
    banner  = $blenderVersionLine
    present = (Test-Path $BlenderExe)
  }
}
$toolchainPath = Join-Path $BinRoot 'toolchain.json'
# UTF-8 without BOM: this file is parsed by Node, which chokes on a BOM.
[IO.File]::WriteAllText($toolchainPath,
  ($toolchain | ConvertTo-Json -Depth 4),
  (New-Object Text.UTF8Encoding($false)))

Write-Step 'toolchain ready'
Write-Note $toolchainPath
