<#
  Builds everything the installer needs into installer\staging:
    node\x64\    Node.js for 64-bit Intel/AMD PCs          (Node 24, from nodejs.org, checksum verified)
    node\arm64\  Node.js for ARM PCs (Snapdragon laptops)  (Node 24)
    node\x86\    Node.js for 32-bit Windows 10             (Node 22, the newest line that still ships 32-bit)
    server\      compiled API + production node_modules + migrations + PDF fonts
    client\      the built React app
    service\     WinSW, the tool that runs the server as a Windows service

  The installer picks the right Node.js for the PC it runs on, so one setup file works on every
  Windows 10 and Windows 11 computer.

  Then compile the installer with Inno Setup 6.3 or newer:
    ISCC.exe /DAppVersion=0.2.0 installer\billing.iss

  Options (mainly for testing):
    -NodeExe <path>   use this node.exe for every architecture instead of downloading Node.js
    -SkipService      do not download WinSW
#>
param(
  [int]$NodeMajor = 24,
  [int]$NodeX86Major = 22,
  [string]$NodeExe = "",
  [switch]$SkipService,
  # The .NET Framework 4.6.1 build of WinSW runs natively on x64, x86 and ARM64. Windows 10 (1607+) and 11 include .NET 4.6.2 or newer.
  [string]$WinSwUrl = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Installer = $PSScriptRoot
$Repo = Split-Path $Installer -Parent
$Staging = Join-Path $Installer "staging"
$Cache = Join-Path $Installer ".cache"

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Run($dir, $cmd) {
  Push-Location $dir
  try {
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $cmd" }
  } finally { Pop-Location }
}

Step "Cleaning staging folder"
if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
New-Item -ItemType Directory -Force $Staging, "$Staging\node", "$Staging\server", "$Staging\client", "$Staging\service", $Cache | Out-Null

Step "Building the React app"
Run "$Repo\client" "npm ci"
Run "$Repo\client" "npm run build"
Copy-Item "$Repo\client\dist" "$Staging\client\dist" -Recurse

Step "Building the server"
Run "$Repo\server" "npm ci"
Run "$Repo\server" "npm run build"
Copy-Item "$Repo\server\dist" "$Staging\server\dist" -Recurse
Copy-Item "$Repo\server\migrations" "$Staging\server\migrations" -Recurse
# Fonts for the PDF bills (found at runtime as server\assets\fonts, next to dist).
Copy-Item "$Repo\server\assets" "$Staging\server\assets" -Recurse
Copy-Item "$Repo\server\package.json", "$Repo\server\package-lock.json" "$Staging\server"

Step "Installing production-only server dependencies"
Run "$Staging\server" "npm ci --omit=dev"

# Downloads node.exe for one architecture from nodejs.org and checks it against the published SHA-256.
function Get-Node([int]$major, [string]$arch) {
  $dest = "$Staging\node\$arch"
  New-Item -ItemType Directory -Force $dest | Out-Null
  if ($NodeExe) { Copy-Item $NodeExe "$dest\node.exe"; return }

  $index = Invoke-RestMethod "https://nodejs.org/dist/index.json"
  $release = $index | Where-Object { $_.version -like "v$major.*" -and $_.files -contains "win-$arch-zip" } | Select-Object -First 1
  if (-not $release) { throw "No Node.js v$major release found for win-$arch" }
  $version = $release.version
  $zipName = "node-$version-win-$arch.zip"
  $zip = Join-Path $Cache $zipName
  if (-not (Test-Path $zip)) {
    Write-Host "Downloading $zipName"
    Invoke-WebRequest "https://nodejs.org/dist/$version/$zipName" -OutFile $zip -UseBasicParsing
  }
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing).Content
  $line = $sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($zipName))$" } | Select-Object -First 1
  if (-not $line) { throw "No checksum published for $zipName" }
  $expected = $line.Split(" ")[0].Trim()
  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) { Remove-Item $zip -Force; throw "$zipName failed its checksum check" }

  $unzipped = Join-Path $Cache "node-unzipped-$arch"
  if (Test-Path $unzipped) { Remove-Item $unzipped -Recurse -Force }
  Expand-Archive $zip $unzipped
  $root = Join-Path $unzipped "node-$version-win-$arch"
  Copy-Item "$root\node.exe" "$dest\node.exe"
  Copy-Item "$root\LICENSE" "$dest\LICENSE" -ErrorAction SilentlyContinue
  Write-Host "win-${arch}: Node.js $version"
}

Step "Adding Node.js (x64, ARM64 and 32-bit)"
Get-Node $NodeMajor "x64"
Get-Node $NodeMajor "arm64"
Get-Node $NodeX86Major "x86"

Step "Adding the Windows service wrapper (WinSW)"
if ($SkipService) {
  Write-Host "Skipped (-SkipService)"
} else {
  Invoke-WebRequest $WinSwUrl -OutFile "$Staging\service\billing-service.exe" -UseBasicParsing
}

Step "Done"
$mb = [math]::Round(((Get-ChildItem $Staging -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host "Staging folder: $Staging ($mb MB)"
