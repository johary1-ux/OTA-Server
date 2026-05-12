<#
.SYNOPSIS
  Installs the BeautyBay OTA server as a Windows service using NSSM.

.DESCRIPTION
  - Resolves nssm.exe (PATH lookup or -NssmPath parameter).
  - Builds the TypeScript project (npm install + npm run build).
  - Registers a service that runs `node dist\index.js`.
  - Configures auto-start, working directory, env-file source, and log paths.
  - Idempotent: re-running updates the existing service rather than failing.

.PARAMETER ServiceName
  Windows service name. Default: BeautyBayOTA.

.PARAMETER InstallDir
  Repo root on disk. Default: directory containing this script's parent.

.PARAMETER NodeExe
  Path to node.exe. Default: looked up on PATH.

.PARAMETER NssmPath
  Path to nssm.exe. Default: looked up on PATH.

.PARAMETER LogDir
  Directory where stdout/stderr rotated logs go. Default: C:\OTA\logs.

.EXAMPLE
  .\install-service.ps1
  .\install-service.ps1 -ServiceName BeautyBayOTA -NodeExe "C:\Program Files\nodejs\node.exe"
#>

[CmdletBinding()]
param(
  [string]$ServiceName = 'BeautyBayOTA',
  [string]$InstallDir,
  [string]$NodeExe,
  [string]$NssmPath,
  [string]$LogDir = 'C:\OTA\logs'
)

$ErrorActionPreference = 'Stop'

function Resolve-Tool {
  param([string]$Name, [string]$Override)
  if ($Override) {
    if (-not (Test-Path $Override)) { throw "Path not found: $Override" }
    return (Resolve-Path $Override).Path
  }
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "$Name not found on PATH. Pass an explicit path via the corresponding -* parameter." }
  return $cmd.Source
}

if (-not (([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator))) {
  throw 'This script must be run from an elevated PowerShell session (Run as Administrator).'
}

if (-not $InstallDir) {
  $InstallDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
if (-not (Test-Path $InstallDir)) { throw "InstallDir not found: $InstallDir" }

$node = Resolve-Tool -Name 'node.exe' -Override $NodeExe
$nssm = Resolve-Tool -Name 'nssm.exe' -Override $NssmPath
$entry = Join-Path $InstallDir 'dist\index.js'
$envFile = Join-Path $InstallDir '.env'

Write-Host "Service name : $ServiceName"
Write-Host "Install dir  : $InstallDir"
Write-Host "Node         : $node"
Write-Host "NSSM         : $nssm"
Write-Host "Entry point  : $entry"
Write-Host "Log dir      : $LogDir"

# --- Build the project -----------------------------------------------------
Push-Location $InstallDir
try {
  if (Test-Path 'package-lock.json') {
    Write-Host 'Running npm ci...'
    & npm ci
  } else {
    Write-Host 'Running npm install...'
    & npm install
  }
  Write-Host 'Running npm run build...'
  & npm run build
}
finally {
  Pop-Location
}

if (-not (Test-Path $entry)) {
  throw "Build did not produce $entry. Check the npm output."
}
if (-not (Test-Path $envFile)) {
  Write-Warning ".env not found at $envFile. The service will start but may exit on missing OTA_PUBLISH_KEY. Copy .env.example to .env and edit it before continuing."
}

# --- Prepare directories ---------------------------------------------------
$null = New-Item -ItemType Directory -Force -Path $LogDir
$bundlesPath = if ($env:OTA_BUNDLES_PATH) { $env:OTA_BUNDLES_PATH } else { 'C:\OTA\bundles' }
$tmpPath     = if ($env:OTA_UPLOADS_TMP)  { $env:OTA_UPLOADS_TMP }  else { 'C:\OTA\tmp' }
$null = New-Item -ItemType Directory -Force -Path $bundlesPath
$null = New-Item -ItemType Directory -Force -Path $tmpPath

# --- Install / update the service -----------------------------------------
$existing = (& sc.exe query $ServiceName) 2>$null
if ($LASTEXITCODE -eq 0 -and $existing -match 'SERVICE_NAME') {
  Write-Host "Service $ServiceName already exists — stopping for update..."
  & $nssm stop $ServiceName confirm | Out-Null
} else {
  Write-Host "Installing service $ServiceName..."
  & $nssm install $ServiceName $node $entry | Out-Null
}

& $nssm set $ServiceName AppDirectory       $InstallDir          | Out-Null
& $nssm set $ServiceName AppParameters      "`"$entry`""         | Out-Null
& $nssm set $ServiceName DisplayName        'BeautyBay OTA Server' | Out-Null
& $nssm set $ServiceName Description        'Expo Updates v1 OTA server for the BeautyBay mobile app.' | Out-Null
& $nssm set $ServiceName Start              SERVICE_AUTO_START   | Out-Null
& $nssm set $ServiceName AppStdout          (Join-Path $LogDir 'service-stdout.log') | Out-Null
& $nssm set $ServiceName AppStderr          (Join-Path $LogDir 'service-stderr.log') | Out-Null
& $nssm set $ServiceName AppRotateFiles     1                    | Out-Null
& $nssm set $ServiceName AppRotateOnline    1                    | Out-Null
& $nssm set $ServiceName AppRotateBytes     10485760             | Out-Null  # 10 MB
& $nssm set $ServiceName AppThrottle        5000                 | Out-Null
& $nssm set $ServiceName AppExit            Default Restart      | Out-Null
& $nssm set $ServiceName AppRestartDelay    2000                 | Out-Null

# dotenv (loaded by the app at startup) reads $InstallDir\.env, so no env-var
# wiring is required in NSSM itself. To override anything, edit .env and
# restart the service.

Write-Host "Starting $ServiceName..."
& $nssm start $ServiceName | Out-Null

Start-Sleep -Seconds 2
& sc.exe query $ServiceName

Write-Host ''
Write-Host "Done. Useful commands:"
Write-Host "  nssm restart $ServiceName"
Write-Host "  nssm stop    $ServiceName"
Write-Host "  nssm remove  $ServiceName confirm   # uninstall"
Write-Host "  Get-Content -Wait '$LogDir\service-stdout.log'"
