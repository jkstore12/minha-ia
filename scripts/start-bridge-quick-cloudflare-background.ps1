$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$statePath = Join-Path $projectRoot ".local-agent-bridge-state.json"
$logDir = Join-Path $projectRoot ".local-agent-bridge-logs"
$bridgePort = if ($env:LOCAL_AGENT_BRIDGE_PORT) { $env:LOCAL_AGENT_BRIDGE_PORT } else { "8765" }
$bridgeHost = if ($env:LOCAL_AGENT_BRIDGE_HOST) { $env:LOCAL_AGENT_BRIDGE_HOST } else { "127.0.0.1" }
$previousState = $null
if (Test-Path $statePath) {
  try {
    $previousState = Get-Content $statePath -Raw | ConvertFrom-Json
  } catch {
    $previousState = $null
  }
}

$bridgeToken = if ($env:LOCAL_AGENT_BRIDGE_TOKEN) {
  $env:LOCAL_AGENT_BRIDGE_TOKEN
} elseif ($previousState -and $previousState.bridgeToken) {
  $previousState.bridgeToken
} else {
  [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  $wingetPath = "C:\Users\wnbat\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
  if (Test-Path $wingetPath) {
    $cloudflaredPath = $wingetPath
  } else {
    Write-Error "cloudflared não está instalado. Rode: powershell -ExecutionPolicy Bypass -File scripts/install-cloudflared.ps1"
  }
} else {
  $cloudflaredPath = $cloudflared.Source
}

$env:LOCAL_AGENT_BRIDGE_TOKEN = $bridgeToken
$env:LOCAL_AGENT_BRIDGE_PORT = $bridgePort
$env:LOCAL_AGENT_BRIDGE_HOST = $bridgeHost
$env:LOCAL_AGENT_WORKSPACE = $projectRoot.Path

$bridgeOut = Join-Path $logDir "bridge.out.log"
$bridgeErr = Join-Path $logDir "bridge.err.log"
$tunnelOut = Join-Path $logDir "cloudflared.out.log"
$tunnelErr = Join-Path $logDir "cloudflared.err.log"

Remove-Item -LiteralPath $bridgeOut,$bridgeErr,$tunnelOut,$tunnelErr -ErrorAction SilentlyContinue

$bridgeProcess = Start-Process `
  -FilePath "node" `
  -ArgumentList "scripts/local-agent-bridge.mjs" `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $bridgeOut `
  -RedirectStandardError $bridgeErr `
  -PassThru

Start-Sleep -Seconds 2
$headers = @{ Authorization = "Bearer $bridgeToken" }
Invoke-RestMethod -Uri "http://${bridgeHost}:${bridgePort}/health" -Headers $headers -Method Get | Out-Null

$tunnelProcess = Start-Process `
  -FilePath $cloudflaredPath `
  -ArgumentList "tunnel","--url","http://${bridgeHost}:${bridgePort}" `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $tunnelOut `
  -RedirectStandardError $tunnelErr `
  -PassThru

$publicUrl = $null
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 1
  $combinedLogs = @()
  if (Test-Path $tunnelOut) { $combinedLogs += Get-Content $tunnelOut -ErrorAction SilentlyContinue }
  if (Test-Path $tunnelErr) { $combinedLogs += Get-Content $tunnelErr -ErrorAction SilentlyContinue }
  $logText = $combinedLogs -join "`n"
  $match = [regex]::Match($logText, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
  if ($match.Success) {
    $publicUrl = $match.Value
    break
  }
}

if (-not $publicUrl) {
  Stop-Process -Id $bridgeProcess.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
  Write-Error "Não consegui capturar a URL do Quick Tunnel. Veja logs em $logDir."
}

$state = [ordered]@{
  bridgeUrl = $publicUrl
  bridgeToken = $bridgeToken
  bridgePid = $bridgeProcess.Id
  tunnelPid = $tunnelProcess.Id
  bridgeHost = $bridgeHost
  bridgePort = $bridgePort
  startedAt = (Get-Date).ToString("o")
  logDir = $logDir
}

$state | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8

Write-Host "BRIDGE_URL=$publicUrl"
Write-Host "BRIDGE_TOKEN=salvo em .local-agent-bridge-state.json"
Write-Host "BRIDGE_PID=$($bridgeProcess.Id)"
Write-Host "TUNNEL_PID=$($tunnelProcess.Id)"
Write-Host "STATE=$statePath"
