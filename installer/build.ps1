<#
  Builds everything the installer needs into installer\staging:
    node\     a private copy of Node.js (downloaded from nodejs.org, checksum verified)
    server\   compiled API + production node_modules + migrations
    client\   the built React app
    service\  WinSW, the tool that runs the server as a Windows service

  Then compile the installer with Inno Setup:
    ISCC.exe /DAppVersion=0.1.0 installer\billing.iss

  Options (mainly for testing):
    -NodeExe <path>   use this node.exe instead of downloading Node.js
    -SkipService      do not download WinSW
#>
param(
  [int]$NodeMajor = 24,
  [string]$NodeExe = "",
  [switch]$SkipService,
  [string]$WinSwUrl = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

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
Copy-Item "$Repo\server\package.json", "$Repo\server\package-lock.json" "$Staging\server"

Step "Installing production-only server dependencies"
Run "$Staging\server" "npm ci --omit=dev"

Step "Adding Node.js"
if ($NodeExe) {
  Copy-Item $NodeExe "$Staging\node\node.exe"
} else {
  $index = Invoke-RestMethod "https://nodejs.org/dist/index.json"
  $version = ($index | Where-Object { $_.version -like "v$NodeMajor.*" } | Select-Object -First 1).version
  if (-not $version) { throw "No Node.js v$NodeMajor release found" }
  $zipName = "node-$version-win-x64.zip"
  $zip = Join-Path $Cache $zipName
  if (-not (Test-Path $zip)) {
    Write-Host "Downloading $zipName"
    Invoke-WebRequest "https://nodejs.org/dist/$version/$zipName" -OutFile $zip -UseBasicParsing
  }
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing).Content
  $expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1).Split(" ")[0].Trim()
  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) { Remove-Item $zip -Force; throw "Node.js download failed its checksum check" }
  $unzipped = Join-Path $Cache "node-unzipped"
  if (Test-Path $unzipped) { Remove-Item $unzipped -Recurse -Force }
  Expand-Archive $zip $unzipped
  $root = Join-Path $unzipped ("node-$version-win-x64")
  Copy-Item "$root\node.exe" "$Staging\node\node.exe"
  Copy-Item "$root\LICENSE" "$Staging\node\LICENSE" -ErrorAction SilentlyContinue
  Write-Host "Using Node.js $version"
}

Step "Adding the Windows service wrapper (WinSW)"
if ($SkipService) {
  Write-Host "Skipped (-SkipService)"
} else {
  Invoke-WebRequest $WinSwUrl -OutFile "$Staging\service\billing-service.exe" -UseBasicParsing
}

Step "Done"
$mb = [math]::Round(((Get-ChildItem $Staging -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host "Staging folder: $Staging ($mb MB)"
