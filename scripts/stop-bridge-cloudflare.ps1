$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$statePath = Join-Path $projectRoot ".local-agent-bridge-state.json"

if (-not (Test-Path $statePath)) {
  Write-Host "Nenhum estado da ponte local encontrado."
  exit 0
}

$state = Get-Content $statePath | ConvertFrom-Json

foreach ($pidValue in @($state.bridgePid, $state.tunnelPid)) {
  if ($pidValue) {
    Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
  }
}

Remove-Item -LiteralPath $statePath -ErrorAction SilentlyContinue
Write-Host "Ponte local e túnel encerrados."
