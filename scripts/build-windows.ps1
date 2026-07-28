param([switch]$Publish)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sharedCache = Join-Path (Split-Path -Parent $projectRoot) 'eb-cache'
$localCache = Join-Path $projectRoot '.electron-builder-cache'
$cache = if (Test-Path -LiteralPath $sharedCache) { $sharedCache } else { $localCache }
$builderNodeVersion = '20.18.3'
$builderNodeSha256 = '11D483DFBA711BC7C9BCB513E80A2941BE0C2E7CBF62753755785B9A6E80A731'
$builderNodeArchive = Join-Path $cache "node-v$builderNodeVersion-win-x64.zip"
$builderNodeRoot = Join-Path $cache "node-v$builderNodeVersion-win-x64"
$builderNodeExe = Join-Path $builderNodeRoot 'node.exe'
$builderTemp = Join-Path $cache 'temp'

New-Item -ItemType Directory -Path $cache -Force | Out-Null
New-Item -ItemType Directory -Path $builderTemp -Force | Out-Null
$env:ELECTRON_BUILDER_CACHE = $cache
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
$env:TEMP = $builderTemp
$env:TMP = $builderTemp

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

if (-not (Test-Path -LiteralPath $builderNodeExe)) {
  if (-not (Test-Path -LiteralPath $builderNodeArchive)) {
    Write-Host "Stable Node $builderNodeVersion builder runtime is missing; downloading the official portable archive..."
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$builderNodeVersion/node-v$builderNodeVersion-win-x64.zip" -OutFile $builderNodeArchive -UseBasicParsing
  }
  $actualBuilderNodeSha256 = (Get-FileHash -LiteralPath $builderNodeArchive -Algorithm SHA256).Hash
  if ($actualBuilderNodeSha256 -ne $builderNodeSha256) {
    Remove-Item -LiteralPath $builderNodeArchive -Force
    throw "Stable builder runtime checksum mismatch. Expected $builderNodeSha256 but received $actualBuilderNodeSha256"
  }
  Expand-Archive -LiteralPath $builderNodeArchive -DestinationPath $cache -Force
}
if (-not (Test-Path -LiteralPath $builderNodeExe)) { throw "Unable to prepare stable builder runtime: $builderNodeExe" }
$actualBuilderNodeVersion = (& $builderNodeExe --version).Trim()
if ($actualBuilderNodeVersion -ne "v$builderNodeVersion") { throw "Unexpected builder runtime version: $actualBuilderNodeVersion" }

$builder = Join-Path $projectRoot 'node_modules\electron-builder\out\cli\cli.js'
$publishMode = if ($Publish) { 'always' } else { 'never' }
$builderExitCode = 1
for ($attempt = 1; $attempt -le 3; $attempt += 1) {
  & $builderNodeExe $builder --win "--publish=$publishMode"
  $builderExitCode = $LASTEXITCODE
  if ($builderExitCode -eq 0) { break }
  if ($attempt -lt 3) {
    Write-Warning "electron-builder attempt $attempt failed (exit $builderExitCode). Waiting for Windows file locks before retrying..."
    Start-Sleep -Seconds (2 * $attempt)
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'release') -Filter '*.nsis.7z' -ErrorAction SilentlyContinue |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
}
if ($builderExitCode -ne 0) { exit $builderExitCode }

& $builderNodeExe (Join-Path $projectRoot 'scripts\verify-packaged-app.cjs')
exit $LASTEXITCODE
