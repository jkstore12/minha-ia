# Ponte local do agente

A ponte local permite que a Minha IA execute ações controladas no computador onde o projeto está rodando. Ela existe porque o Vercel não deve ter acesso direto ao terminal ou aos arquivos locais.

## O que já está liberado

- `git.status`: consulta o status Git do workspace.
- `workspace.files.read`: lê arquivos dentro do projeto.
- `terminal.run`: executa apenas comandos permitidos:
  - `npm.typecheck`
  - `npm.lint`
  - `npm.build`
  - `node.check.telegram`
  - `node.check.whatsapp`

## Segurança aplicada

- Token obrigatório via `LOCAL_AGENT_BRIDGE_TOKEN`.
- Escuta local por padrão em `127.0.0.1`.
- Bloqueio de caminhos fora do workspace.
- Bloqueio de `.env`, `.env.*`, `.git`, `.vercel` e `node_modules`.
- Sem terminal livre.
- Saída de comandos limitada e com timeout.

## Como rodar localmente

No PowerShell:

```powershell
$env:LOCAL_AGENT_BRIDGE_TOKEN="troque-por-um-token-forte"
$env:LOCAL_AGENT_BRIDGE_PORT="8765"
npm run bridge:local
```

No `.env.local` do app local:

```env
LOCAL_AGENT_BRIDGE_URL=http://127.0.0.1:8765
LOCAL_AGENT_BRIDGE_TOKEN=troque-por-um-token-forte
```

Depois reinicie o app.

## Instalar o Cloudflare Tunnel no Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-cloudflared.ps1
```

## Expor a ponte com Cloudflare Tunnel

### Modo rápido sem domínio

Este modo usa uma URL temporária `trycloudflare.com`. É útil para usar pelo celular sem mexer em nenhum domínio existente.

Iniciar em segundo plano:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-bridge-quick-cloudflare-background.ps1
```

O script mostra:

```text
BRIDGE_URL=https://alguma-coisa.trycloudflare.com
BRIDGE_TOKEN=...
```

Configure esses dois valores na Vercel:

```env
LOCAL_AGENT_BRIDGE_URL=https://alguma-coisa.trycloudflare.com
LOCAL_AGENT_BRIDGE_TOKEN=...
```

Quando quiser parar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop-bridge-cloudflare.ps1
```

Limitação: a URL muda quando o túnel reinicia.

### Modo fixo com domínio separado

Use um túnel remoto gerenciado pela Cloudflare:

1. Entre no painel da Cloudflare.
2. Vá em **Zero Trust > Networks > Connectors > Cloudflare Tunnels**.
3. Crie um túnel do tipo **Cloudflared**.
4. Crie uma rota pública para a ponte:
   - Hostname sugerido: `ponte-minha-ia.seudominio.com`
   - Service URL: `http://127.0.0.1:8765`
5. Copie o token de execução do túnel.

Salve os tokens no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/save-bridge-env.ps1 `
  -BridgeToken "token-forte-da-ponte" `
  -CloudflareTunnelToken "token-do-cloudflare-tunnel" `
  -BridgeUrl "https://ponte-minha-ia.seudominio.com"
```

Abra um novo terminal e inicie:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-bridge-cloudflare.ps1
```

## Configurar a Vercel

Para a Vercel acessar a ponte, ela precisa estar em uma URL HTTPS confiável, por exemplo via túnel seguro ou serviço dedicado. Só configure em produção se você controlar essa URL e o token.

Variáveis necessárias na Vercel:

```env
LOCAL_AGENT_BRIDGE_URL=https://sua-ponte-segura.exemplo.com
LOCAL_AGENT_BRIDGE_TOKEN=token-forte
```

Não exponha a ponte sem autenticação.
