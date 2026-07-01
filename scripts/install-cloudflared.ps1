$ErrorActionPreference = "Stop"

if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
  cloudflared --version
  Write-Host "cloudflared já está instalado."
  exit 0
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Error "winget não está disponível. Instale o cloudflared manualmente pela documentação da Cloudflare."
}

winget install --id Cloudflare.cloudflared --exact --accept-package-agreements --accept-source-agreements

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Error "cloudflared foi instalado, mas ainda não está no PATH desta janela. Feche e abra o terminal novamente."
}

cloudflared --version
