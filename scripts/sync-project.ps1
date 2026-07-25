param(
  [ValidateSet('Status', 'Source', 'Installer', 'All')]
  [string]$Mode = 'All',
  [string]$Destination,
  [switch]$Install,
  [string]$InstallDirectory = 'E:\AI办公会所\hermes-office-pro'
)

$ErrorActionPreference = 'Stop'
$owner = 'TTflysky'
$repository = 'sirenhuisuo'
$branch = 'main'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $projectRoot
$apiRoot = "https://api.github.com/repos/$owner/$repository"

function Get-GitHubToken {
  try {
    $request = "protocol=https`nhost=github.com`nusername=$owner`n`n"
    $response = $request | & git credential fill 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $line = $response | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
    if ($line) { return $line.Substring('password='.Length) }
  } catch {}
  return $null
}

$headers = @{
  Accept = 'application/vnd.github+json'
  'User-Agent' = 'hermes-office-project-sync'
  'X-GitHub-Api-Version' = '2022-11-28'
}
$token = Get-GitHubToken
if ($token) { $headers.Authorization = "Bearer $token" }

function Invoke-GitHubJson([string]$Uri) {
  Invoke-RestMethod -Uri $Uri -Headers $headers -Method Get
}

function Save-RemoteFile([string]$Uri, [string]$Path) {
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  try {
    Import-Module BitsTransfer -ErrorAction Stop
    Start-BitsTransfer -Source $Uri -Destination $Path -DisplayName 'Hermes Office sync' -Description 'Downloading verified project artifact'
  } catch {
    Invoke-WebRequest -Uri $Uri -Headers $headers -OutFile $Path -UseBasicParsing
  }
}

function Get-RemoteState {
  $commit = Invoke-GitHubJson "$apiRoot/commits/$branch"
  $packageFile = Invoke-GitHubJson "$apiRoot/contents/package.json?ref=$($commit.sha)"
  $packageText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($packageFile.content -replace '\s', '')))
  $package = $packageText | ConvertFrom-Json
  $release = $null
  try { $release = Invoke-GitHubJson "$apiRoot/releases/tags/v$($package.version)" } catch {}
  [pscustomobject]@{
    Sha = [string]$commit.sha
    ShortSha = ([string]$commit.sha).Substring(0, 7)
    Version = [string]$package.version
    CommitDate = [string]$commit.commit.committer.date
    Message = [string]$commit.commit.message
    Release = $release
  }
}

function Sync-Source($State) {
  $target = $Destination
  if (-not $target) {
    $target = Join-Path $workspaceRoot "sirenhuisuo-v$($State.Version)-$($State.ShortSha)"
  }
  $target = [IO.Path]::GetFullPath($target)

  if (Test-Path -LiteralPath $target) {
    $packagePath = Join-Path $target 'package.json'
    if (-not (Test-Path -LiteralPath $packagePath)) {
      throw "Destination exists but is not a project snapshot: $target"
    }
    Write-Host "Source already present: $target" -ForegroundColor Green
    return $target
  }

  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "hermes-office-sync-$([Guid]::NewGuid().ToString('N'))"
  $archive = Join-Path $tempRoot 'source.zip'
  $expanded = Join-Path $tempRoot 'expanded'
  New-Item -ItemType Directory -Path $expanded -Force | Out-Null
  try {
    Write-Host "Downloading source commit $($State.ShortSha)..." -ForegroundColor Cyan
    Save-RemoteFile "$apiRoot/zipball/$($State.Sha)" $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
    $archiveRoot = Get-ChildItem -LiteralPath $expanded -Directory | Select-Object -First 1
    if (-not $archiveRoot -or -not (Test-Path -LiteralPath (Join-Path $archiveRoot.FullName 'package.json'))) {
      throw 'Downloaded archive is not a valid project snapshot.'
    }
    Move-Item -LiteralPath $archiveRoot.FullName -Destination $target

    $existingModules = Join-Path $projectRoot 'node_modules'
    $targetModules = Join-Path $target 'node_modules'
    if ((Test-Path -LiteralPath $existingModules) -and -not (Test-Path -LiteralPath $targetModules)) {
      New-Item -ItemType Junction -Path $targetModules -Target $existingModules | Out-Null
    }
    Write-Host "Source ready: $target" -ForegroundColor Green
    return $target
  } finally {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
      Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
  }
}

function Sync-Installer($State) {
  if (-not $State.Release) { throw "GitHub Release v$($State.Version) is not available." }
  $asset = $State.Release.assets | Where-Object { $_.name -eq "hermes-office-pro-setup-$($State.Version).exe" } | Select-Object -First 1
  if (-not $asset) { throw "Release v$($State.Version) does not contain the installer." }

  $downloadDir = Join-Path $workspaceRoot "downloads\v$($State.Version)"
  $installer = Join-Path $downloadDir $asset.name
  if ((Test-Path -LiteralPath $installer) -and (Get-Item -LiteralPath $installer).Length -ne [long]$asset.size) {
    Remove-Item -LiteralPath $installer -Force
  }
  if (-not (Test-Path -LiteralPath $installer)) {
    Write-Host "Downloading installer v$($State.Version)..." -ForegroundColor Cyan
    Save-RemoteFile $asset.browser_download_url $installer
  }
  $actualSize = (Get-Item -LiteralPath $installer).Length
  if ($actualSize -ne [long]$asset.size) {
    throw "Installer size check failed. Expected $($asset.size), received $actualSize."
  }
  Write-Host "Installer verified: $installer ($actualSize bytes)" -ForegroundColor Green

  if ($Install) {
    Write-Host "Installing to $InstallDirectory..." -ForegroundColor Cyan
    Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$InstallDirectory") -Wait
    Write-Host 'Installation finished.' -ForegroundColor Green
  }
  return $installer
}

$state = Get-RemoteState
Write-Host "Hermes Office v$($state.Version) | $($state.ShortSha) | $($state.CommitDate)" -ForegroundColor Green
Write-Host ($state.Message -split "`n" | Select-Object -First 1)

if ($Mode -in @('Source', 'All')) { [void](Sync-Source $state) }
if ($Mode -in @('Installer', 'All')) { [void](Sync-Installer $state) }
if ($Mode -eq 'Status') {
  Write-Host "Release: $(if ($state.Release) { 'available' } else { 'not published' })"
}
