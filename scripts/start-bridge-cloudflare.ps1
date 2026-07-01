$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$bridgePort = if ($env:LOCAL_AGENT_BRIDGE_PORT) { $env:LOCAL_AGENT_BRIDGE_PORT } else { "8765" }
$bridgeHost = if ($env:LOCAL_AGENT_BRIDGE_HOST) { $env:LOCAL_AGENT_BRIDGE_HOST } else { "127.0.0.1" }

if (-not $env:LOCAL_AGENT_BRIDGE_TOKEN) {
  Write-Error "Defina LOCAL_AGENT_BRIDGE_TOKEN antes de iniciar."
}

if (-not $env:CLOUDFLARE_TUNNEL_TOKEN) {
  Write-Error "Defina CLOUDFLARE_TUNNEL_TOKEN com o token copiado da Cloudflare."
}

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Error "cloudflared não está instalado. Rode: powershell -ExecutionPolicy Bypass -File scripts/install-cloudflared.ps1"
}

Write-Host "Iniciando ponte local em http://${bridgeHost}:${bridgePort}"
$bridgeProcess = Start-Process `
  -FilePath "node" `
  -ArgumentList "scripts/local-agent-bridge.mjs" `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -PassThru

try {
  Start-Sleep -Seconds 2
  $headers = @{ Authorization = "Bearer $env:LOCAL_AGENT_BRIDGE_TOKEN" }
  Invoke-RestMethod -Uri "http://${bridgeHost}:${bridgePort}/health" -Headers $headers -Method Get | Out-Null

  Write-Host "Ponte local validada. Iniciando Cloudflare Tunnel."
  cloudflared tunnel run --token $env:CLOUDFLARE_TUNNEL_TOKEN
}
finally {
  if ($bridgeProcess -and -not $bridgeProcess.HasExited) {
    Stop-Process -Id $bridgeProcess.Id -Force
  }
}
