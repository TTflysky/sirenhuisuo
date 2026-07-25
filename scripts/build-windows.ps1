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
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$builder = Join-Path $projectRoot 'node_modules\.bin\electron-builder.cmd'
$publishMode = if ($Publish) { 'always' } else { 'never' }
& $builder --win "--publish=$publishMode"
exit $LASTEXITCODE
