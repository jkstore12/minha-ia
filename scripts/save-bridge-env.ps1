param(
  [Parameter(Mandatory = $true)]
  [string] $BridgeToken,

  [Parameter(Mandatory = $true)]
  [string] $CloudflareTunnelToken,

  [string] $BridgeUrl = "",
  [string] $BridgePort = "8765",
  [string] $BridgeHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

setx LOCAL_AGENT_BRIDGE_TOKEN $BridgeToken | Out-Null
setx CLOUDFLARE_TUNNEL_TOKEN $CloudflareTunnelToken | Out-Null
setx LOCAL_AGENT_BRIDGE_PORT $BridgePort | Out-Null
setx LOCAL_AGENT_BRIDGE_HOST $BridgeHost | Out-Null

if ($BridgeUrl.Trim()) {
  setx LOCAL_AGENT_BRIDGE_URL $BridgeUrl | Out-Null
}

Write-Host "Variáveis salvas no ambiente do Windows."
Write-Host "Feche e abra o terminal para carregar os novos valores."
