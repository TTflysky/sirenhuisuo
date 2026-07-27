function Get-TaijiGitHubToken {
  try {
    $request = "protocol=https`nhost=github.com`nusername=TTflysky`n`n"
    $response = $request | & git credential fill 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }

    $passwordLine = $response | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
    if ($passwordLine) { return $passwordLine.Substring('password='.Length) }
  } catch {}

  return $null
}
