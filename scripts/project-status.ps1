param(
  [switch]$Fetch
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Get-GitText([string[]]$Arguments) {
  $result = & git @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($result -join "`n").Trim()
}

function Write-Section([string]$Title) {
  Write-Host "`n== $Title ==" -ForegroundColor Cyan
}

Write-Host "Taiji project status" -ForegroundColor Green
Write-Host "Root: $projectRoot"

if ($Fetch) {
  Write-Section 'GitHub refresh'
  & git fetch origin main --prune
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'GitHub refresh failed. Local status is still shown below.'
  }
}

$package = Get-Content (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$branch = Get-GitText @('branch', '--show-current')
$head = Get-GitText @('log', '-1', '--format=%h %cs %s')
$remote = Get-GitText @('remote', 'get-url', 'origin')
$changes = @(& git status --short)

Write-Section 'Source'
Write-Host "Version: $($package.version)"
Write-Host "Branch:  $branch"
Write-Host "Commit:  $head"
Write-Host "Origin:  $remote"

$counts = Get-GitText @('rev-list', '--left-right', '--count', '@{upstream}...HEAD')
if ($counts) {
  $parts = $counts -split '\s+'
  Write-Host "Remote delta: behind $($parts[0]), ahead $($parts[1])"
} else {
  Write-Warning 'No upstream comparison is available. Run with -Fetch after GitHub is reachable.'
}

if ($changes.Count -eq 0) {
  Write-Host 'Working tree: clean' -ForegroundColor Green
} else {
  Write-Host 'Working tree: changed' -ForegroundColor Yellow
  $changes | ForEach-Object { Write-Host "  $_" }
}

Write-Section 'Build artifacts'
$releaseDir = Join-Path $projectRoot 'release'
$installer = Join-Path $releaseDir "taiji-office-setup-$($package.version).exe"
$blockmap = "$installer.blockmap"
$latestYml = Join-Path $releaseDir 'latest.yml'
foreach ($item in @($installer, $blockmap, $latestYml)) {
  if (Test-Path -LiteralPath $item) {
    $file = Get-Item -LiteralPath $item
    Write-Host "Present: $($file.Name) ($([math]::Round($file.Length / 1MB, 2)) MB)"
  } else {
    Write-Host "Missing: $(Split-Path -Leaf $item)" -ForegroundColor Yellow
  }
}

Write-Section 'Next handoff command'
Write-Host 'Read docs/CROSS_DEVICE_WORKFLOW.md before making changes.'
