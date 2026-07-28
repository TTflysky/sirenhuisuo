param(
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$owner = 'TTflysky'
$repository = 'sirenhuisuo'
$branch = 'main'
$projectRoot = Split-Path -Parent $PSScriptRoot
$repoName = "$owner/$repository"

. (Join-Path $PSScriptRoot 'github-auth.ps1')

function Invoke-CheckedCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
  }
}

function Get-ReleaseNotes([string]$Version) {
  $changelogPath = Join-Path $projectRoot 'CHANGELOG.md'
  $changelog = Get-Content -LiteralPath $changelogPath -Encoding UTF8 -Raw
  $escapedVersion = [Regex]::Escape($Version)
  $match = [Regex]::Match(
    $changelog,
    "(?ms)^## v$escapedVersion \([^\r\n]+\)\r?\n(?<body>.*?)(?=^## v|\z)"
  )
  if (-not $match.Success) {
    throw "CHANGELOG.md does not contain release notes for v$Version."
  }
  return $match.Groups['body'].Value.Trim()
}

function Assert-VersionReferences([string]$Version) {
  $lockVersionsJson = & node -e "const p=require('./package-lock.json'); process.stdout.write(JSON.stringify([p.version,p.packages[''].version]))"
  if ($LASTEXITCODE -ne 0) { throw 'Unable to read package-lock.json with Node.js.' }
  $lockVersions = $lockVersionsJson | ConvertFrom-Json
  if ([string]$lockVersions[0] -ne $Version -or [string]$lockVersions[1] -ne $Version) {
    throw "package-lock.json does not match package.json version $Version."
  }

  $checks = @(
    @{ Path = 'README.md'; Lines = 12; Pattern = "v$([Regex]::Escape($Version))" },
    @{ Path = 'CHANGELOG.md'; Lines = 8; Pattern = "(?m)^## v$([Regex]::Escape($Version)) \(" },
    @{ Path = 'docs/PROJECT_HANDOFF.md'; Lines = 8; Pattern = "v$([Regex]::Escape($Version))" },
    @{ Path = 'handoff.md'; Lines = 8; Pattern = "v$([Regex]::Escape($Version))" }
  )

  foreach ($check in $checks) {
    $content = (Get-Content -LiteralPath (Join-Path $projectRoot $check.Path) -Encoding UTF8 | Select-Object -First $check.Lines) -join "`n"
    if ($content -notmatch $check.Pattern) {
      throw "$($check.Path) does not reference v$Version in its current-version field."
    }
  }
}

Set-Location $projectRoot

$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid package version: $version" }
$tag = "v$version"

$currentBranch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne $branch) {
  throw "Releases must run from the $branch branch. Current branch: $currentBranch"
}

$worktreeState = @(& git status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Git worktree.' }
if ($worktreeState.Count -gt 0) {
  throw "The Git worktree is not clean. Commit the release changes first:`n$($worktreeState -join "`n")"
}

Assert-VersionReferences $version
Invoke-CheckedCommand git @('diff', '--check')

if (-not $SkipTests) {
  $verificationScripts = @(
    'lint',
    'verify:execution-controller',
    'verify:agent-kernel',
    'verify:foundation',
    'verify:connector-adapters',
    'verify:connector-protocol',
    'verify:skill-atomic',
    'verify:update-download',
    'verify:web-search',
    'verify:docx'
  )
  foreach ($script in $verificationScripts) {
    Invoke-CheckedCommand npm.cmd @('run', $script)
  }
}

Invoke-CheckedCommand npm.cmd @('run', 'dist:win')

$installerName = "taiji-office-setup-$version.exe"
$assetPaths = @(
  (Join-Path $projectRoot "release\$installerName"),
  (Join-Path $projectRoot "release\$installerName.blockmap"),
  (Join-Path $projectRoot 'release\latest.yml')
)
foreach ($assetPath in $assetPaths) {
  if (-not (Test-Path -LiteralPath $assetPath) -or (Get-Item -LiteralPath $assetPath).Length -le 0) {
    throw "Release asset is missing or empty: $assetPath"
  }
}

$postBuildState = @(& git status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Git worktree after packaging.' }
if ($postBuildState.Count -gt 0) {
  throw "Packaging changed tracked or unignored files. Review and commit them before publishing:`n$($postBuildState -join "`n")"
}

$latestYaml = Get-Content -LiteralPath $assetPaths[2] -Encoding UTF8 -Raw
if ($latestYaml -notmatch "(?m)^version:\s*$([Regex]::Escape($version))\s*$") {
  throw "release/latest.yml does not describe v$version."
}

$localAssets = @{}
foreach ($assetPath in $assetPaths) {
  $item = Get-Item -LiteralPath $assetPath
  $localAssets[$item.Name] = [pscustomobject]@{
    Path = $item.FullName
    Size = [long]$item.Length
    Sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

Invoke-CheckedCommand git @('push', 'origin', $branch)

$token = Get-TaijiGitHubToken
if (-not $token) {
  throw 'Git Credential Manager has no GitHub credential. Run one authenticated git push, then retry.'
}

$previousToken = $env:GH_TOKEN
$notesPath = Join-Path ([IO.Path]::GetTempPath()) "taiji-release-$version-$([Guid]::NewGuid().ToString('N')).md"
try {
  $env:GH_TOKEN = $token
  [IO.File]::WriteAllText($notesPath, (Get-ReleaseNotes $version), [Text.UTF8Encoding]::new($false))

  $releaseListJson = & gh release list --repo $repoName --limit 100 --json tagName
  if ($LASTEXITCODE -ne 0) { throw 'Unable to query existing GitHub Releases.' }
  $releaseList = @($releaseListJson | ConvertFrom-Json)
  $releaseExists = @($releaseList | Where-Object { $_.tagName -eq $tag }).Count -gt 0
  if ($releaseExists) {
    Invoke-CheckedCommand gh @('release', 'upload', $tag, $assetPaths[0], $assetPaths[1], $assetPaths[2], '--repo', $repoName, '--clobber')
    Invoke-CheckedCommand gh @('release', 'edit', $tag, '--repo', $repoName, '--title', "Taiji Office $tag", '--notes-file', $notesPath)
  } else {
    Invoke-CheckedCommand gh @('release', 'create', $tag, $assetPaths[0], $assetPaths[1], $assetPaths[2], '--repo', $repoName, '--target', $branch, '--title', "Taiji Office $tag", '--notes-file', $notesPath)
  }

  $headSha = (& git rev-parse HEAD).Trim()
  $remoteSha = (& gh api "repos/$owner/$repository/commits/$branch" --jq '.sha').Trim()
  if ($LASTEXITCODE -ne 0 -or $remoteSha -ne $headSha) {
    throw "Remote $branch does not match local HEAD. Local: $headSha Remote: $remoteSha"
  }

  $tagSha = (& gh api "repos/$owner/$repository/commits/$tag" --jq '.sha').Trim()
  if ($LASTEXITCODE -ne 0 -or $tagSha -ne $headSha) {
    throw "Release tag $tag does not point to local HEAD. Local: $headSha Tag: $tagSha"
  }

  $releaseJson = & gh release view $tag --repo $repoName --json url,targetCommitish,assets
  if ($LASTEXITCODE -ne 0) { throw "Unable to verify GitHub Release $tag." }
  $remoteRelease = $releaseJson | ConvertFrom-Json
  if ([string]$remoteRelease.targetCommitish -ne $branch) {
    throw "Release target is '$($remoteRelease.targetCommitish)', expected '$branch'."
  }

  foreach ($assetName in $localAssets.Keys) {
    $localAsset = $localAssets[$assetName]
    $remoteAsset = $remoteRelease.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
    if (-not $remoteAsset) { throw "GitHub Release is missing asset: $assetName" }
    if ([long]$remoteAsset.size -ne $localAsset.Size) {
      throw "Remote size mismatch for $assetName. Local: $($localAsset.Size) Remote: $($remoteAsset.size)"
    }
    $remoteDigest = ([string]$remoteAsset.digest -replace '^sha256:', '').ToLowerInvariant()
    if (-not $remoteDigest -or $remoteDigest -ne $localAsset.Sha256) {
      throw "Remote SHA-256 mismatch for $assetName. Local: $($localAsset.Sha256) Remote: $remoteDigest"
    }
  }

  Write-Host ''
  Write-Host "Published and verified: $($remoteRelease.url)" -ForegroundColor Green
  Write-Host "Commit: $headSha"
  Write-Host "Installer: $($assetPaths[0])"
  Write-Host "Installer SHA-256: $($localAssets[$installerName].Sha256.ToUpperInvariant())"
} finally {
  if ($null -eq $previousToken) { Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue } else { $env:GH_TOKEN = $previousToken }
  if (Test-Path -LiteralPath $notesPath) { Remove-Item -LiteralPath $notesPath -Force }
}
