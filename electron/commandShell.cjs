function buildPowerShellCommand(command) {
  return `[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); $OutputEncoding = [Text.UTF8Encoding]::new(); $ProgressPreference = 'SilentlyContinue'; $ErrorActionPreference = 'Stop'; $global:LASTEXITCODE = 0; try { & { ${command} }; if (-not $?) { exit 1 }; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
}

module.exports = { buildPowerShellCommand };
