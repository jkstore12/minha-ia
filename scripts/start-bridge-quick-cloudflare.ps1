$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$bridgePort = if ($env:LOCAL_AGENT_BRIDGE_PORT) { $env:LOCAL_AGENT_BRIDGE_PORT } else { "8765" }
$bridgeHost = if ($env:LOCAL_AGENT_BRIDGE_HOST) { $env:LOCAL_AGENT_BRIDGE_HOST } else { "127.0.0.1" }
$bridgeToken = if ($env:LOCAL_AGENT_BRIDGE_TOKEN) { $env:LOCAL_AGENT_BRIDGE_TOKEN } else { [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N") }

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

Write-Host "Token local da ponte:"
Write-Host $bridgeToken
Write-Host ""
Write-Host "Iniciando ponte local em http://${bridgeHost}:${bridgePort}"

$env:LOCAL_AGENT_BRIDGE_TOKEN = $bridgeToken
$env:LOCAL_AGENT_BRIDGE_PORT = $bridgePort
$env:LOCAL_AGENT_BRIDGE_HOST = $bridgeHost
$env:LOCAL_AGENT_WORKSPACE = $projectRoot.Path

$bridgeProcess = Start-Process `
  -FilePath "node" `
  -ArgumentList "scripts/local-agent-bridge.mjs" `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -PassThru

try {
  Start-Sleep -Seconds 2
  $headers = @{ Authorization = "Bearer $bridgeToken" }
  Invoke-RestMethod -Uri "http://${bridgeHost}:${bridgePort}/health" -Headers $headers -Method Get | Out-Null

  Write-Host "Ponte local validada."
  Write-Host "Iniciando Cloudflare Quick Tunnel. Copie a URL https://*.trycloudflare.com que aparecer abaixo."
  Write-Host "Depois configure na Vercel:"
  Write-Host "LOCAL_AGENT_BRIDGE_URL=<url-do-tunnel>"
  Write-Host "LOCAL_AGENT_BRIDGE_TOKEN=$bridgeToken"
  Write-Host ""

  & $cloudflaredPath tunnel --url "http://${bridgeHost}:${bridgePort}"
}
finally {
  if ($bridgeProcess -and -not $bridgeProcess.HasExited) {
    Stop-Process -Id $bridgeProcess.Id -Force
  }
}
