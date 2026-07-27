param([switch]$Publish)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sharedCache = Join-Path (Split-Path -Parent $projectRoot) 'eb-cache'
$localCache = Join-Path $projectRoot '.electron-builder-cache'
$cache = if (Test-Path -LiteralPath $sharedCache) { $sharedCache } else { $localCache }

New-Item -ItemType Directory -Path $cache -Force | Out-Null
$env:ELECTRON_BUILDER_CACHE = $cache
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Set-Location $projectRoot

$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$electronVersion = ([string]$package.devDependencies.electron) -replace '^[^0-9]*', ''
$electronDist = Join-Path $projectRoot 'node_modules\electron\dist'
$electronExe = Join-Path $electronDist 'electron.exe'
$electronPathFile = Join-Path $projectRoot 'node_modules\electron\path.txt'
if (-not (Test-Path -LiteralPath $electronExe)) {
  $electronCache = if ($env:ELECTRON_CACHE) { $env:ELECTRON_CACHE } else { Join-Path $env:LOCALAPPDATA 'electron\Cache' }
  $electronArchive = Join-Path $electronCache "electron-v$electronVersion-win32-x64.zip"
  $sevenZip = Join-Path $projectRoot 'node_modules\7zip-bin\win\x64\7za.exe'
  if ((Test-Path -LiteralPath $electronArchive) -and (Test-Path -LiteralPath $sevenZip)) {
    Write-Host "Electron $electronVersion runtime is missing; restoring from local cache: $electronArchive"
    & $sevenZip t $electronArchive | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Electron cache archive is invalid: $electronArchive" }
    New-Item -ItemType Directory -Path $electronDist -Force | Out-Null
    & $sevenZip x $electronArchive "-o$electronDist" -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to extract Electron cache archive: $electronArchive" }
  } else {
    Write-Host "Electron $electronVersion runtime and local cache are missing; downloading the locked version..."
    & npm.cmd rebuild electron
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  if (-not (Test-Path -LiteralPath $electronExe)) { throw "Electron runtime restore did not produce: $electronExe" }
}
if (-not (Test-Path -LiteralPath $electronPathFile) -or (Get-Content -LiteralPath $electronPathFile -Raw).Trim() -ne 'electron.exe') {
  Set-Content -LiteralPath $electronPathFile -Value 'electron.exe' -Encoding ascii -NoNewline
  Write-Host "Restored Electron runtime locator: $electronPathFile"
}

& npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$builder = Join-Path $projectRoot 'node_modules\.bin\electron-builder.cmd'
$publishMode = if ($Publish) { 'always' } else { 'never' }
& $builder --win "--publish=$publishMode"
exit $LASTEXITCODE
