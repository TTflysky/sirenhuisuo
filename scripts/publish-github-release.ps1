param(
  [switch]$SkipTests,
  [switch]$SkipBuild
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
    'verify:execution-evidence',
    'verify:agent-kernel',
    'verify:foundation',
    'verify:task-runner',
    'verify:task-context',
    'verify:context-router',
    'verify:context-tool-pairs',
    'verify:layered-memory',
    'verify:learning-review',
    'verify:skill-drafts',
    'verify:task-history',
    'verify:task-delegation',
    'verify:worktree',
    'verify:ecosystem-health',
    'verify:connector-adapters',
    'verify:connector-protocol',
    'verify:task-runtime-store',
    'verify:task-worker',
    'verify:tool-registry',
    'verify:native-execution',
    'verify:office-layout',
    'verify:team-membership',
    'verify:skill-atomic',
    'verify:update-download',
    'verify:web-search',
    'verify:docx'
  )
  foreach ($script in $verificationScripts) {
    Invoke-CheckedCommand npm.cmd @('run', $script)
  }
}

if (-not $SkipBuild) {
  Invoke-CheckedCommand npm.cmd @('run', 'dist:win')
}

function Invoke-GitHubApi {
  param(
    [ValidateSet('GET', 'POST', 'PATCH', 'DELETE')]
    [string]$Method,
    [string]$Path,
    [string]$Token,
    [object]$Body = $null,
    [string]$InFile = '',
    [string]$ContentType = 'application/json',
    [switch]$AllowNotFound
  )

  $uri = if ($Path -match '^https://') { $Path } else { "https://api.github.com$Path" }
  $headers = @{
    Authorization = "Bearer $Token"
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'taiji-office-release'
  }
  $request = @{
    Method = $Method
    Uri = $uri
    Headers = $headers
    ErrorAction = 'Stop'
  }
  if ($InFile) {
    $request.InFile = $InFile
    $request.ContentType = $ContentType
  } elseif ($null -ne $Body) {
    $request.Body = $Body | ConvertTo-Json -Depth 20 -Compress
    $request.ContentType = 'application/json; charset=utf-8'
  }

  try {
    return Invoke-RestMethod @request
  } catch {
    $statusCode = 0
    try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
    if ($AllowNotFound -and $statusCode -eq 404) { return $null }
    throw
  }
}

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

# Office and home machines may alternate between a live local proxy and direct
# access. Try the configured route first, then fall back to a direct connection.
& git push origin $branch
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'Git push through the configured network failed; retrying without Git proxy settings...'
  Invoke-CheckedCommand git @('-c', 'http.proxy=', '-c', 'https.proxy=', 'push', 'origin', $branch)
}

$token = Get-TaijiGitHubToken
if (-not $token) {
  throw 'Git Credential Manager has no GitHub credential. Run one authenticated git push, then retry.'
}

try {
  $notes = Get-ReleaseNotes $version
  $remoteRelease = Invoke-GitHubApi -Method GET -Path "/repos/$owner/$repository/releases/tags/$tag" -Token $token -AllowNotFound
  if ($null -eq $remoteRelease) {
    $remoteRelease = Invoke-GitHubApi -Method POST -Path "/repos/$owner/$repository/releases" -Token $token -Body @{
      tag_name = $tag
      target_commitish = $branch
      name = "Taiji Office $tag"
      body = $notes
      draft = $false
      prerelease = $false
    }
  } else {
    $remoteRelease = Invoke-GitHubApi -Method PATCH -Path "/repos/$owner/$repository/releases/$($remoteRelease.id)" -Token $token -Body @{
      name = "Taiji Office $tag"
      body = $notes
      draft = $false
      prerelease = $false
    }
  }

  foreach ($assetName in $localAssets.Keys) {
    $existingAsset = @($remoteRelease.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1)
    if ($existingAsset.Count -gt 0) {
      Invoke-GitHubApi -Method DELETE -Path "/repos/$owner/$repository/releases/assets/$($existingAsset[0].id)" -Token $token | Out-Null
    }
    $localAsset = $localAssets[$assetName]
    $encodedName = [Uri]::EscapeDataString($assetName)
    $assetContentType = if ($assetName -eq 'latest.yml') { 'application/x-yaml' } else { 'application/octet-stream' }
    Invoke-GitHubApi -Method POST -Path "https://uploads.github.com/repos/$owner/$repository/releases/$($remoteRelease.id)/assets?name=$encodedName" -Token $token -InFile $localAsset.Path -ContentType $assetContentType | Out-Null
  }

  $headSha = (& git rev-parse HEAD).Trim()
  $remoteSha = [string](Invoke-GitHubApi -Method GET -Path "/repos/$owner/$repository/commits/$branch" -Token $token).sha
  if ($remoteSha -ne $headSha) {
    throw "Remote $branch does not match local HEAD. Local: $headSha Remote: $remoteSha"
  }

  $tagSha = [string](Invoke-GitHubApi -Method GET -Path "/repos/$owner/$repository/commits/$tag" -Token $token).sha
  if ($tagSha -ne $headSha) {
    throw "Release tag $tag does not point to local HEAD. Local: $headSha Tag: $tagSha"
  }

  $remoteRelease = Invoke-GitHubApi -Method GET -Path "/repos/$owner/$repository/releases/tags/$tag" -Token $token
  if ([string]$remoteRelease.target_commitish -ne $branch) {
    throw "Release target is '$($remoteRelease.target_commitish)', expected '$branch'."
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
  Write-Host "Published and verified: $($remoteRelease.html_url)" -ForegroundColor Green
  Write-Host "Commit: $headSha"
  Write-Host "Installer: $($assetPaths[0])"
  Write-Host "Installer SHA-256: $($localAssets[$installerName].Sha256.ToUpperInvariant())"
} finally {
  $token = $null
}
