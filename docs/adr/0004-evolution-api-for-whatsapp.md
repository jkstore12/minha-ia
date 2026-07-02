# ADR-0004: Evolution API para WhatsApp pessoal

- **Status**: Aceito
- **Data**: 2026-06
- **Decisor**: @jkstore12

## Contexto

O sistema tem um modo "WhatsApp pessoal": o bot responde mensagens do WhatsApp do owner como se fosse um assistente. Requisitos:
- Webhook inbound (mensagens recebidas).
- Envio outbound (respostas, lembretes, relatorios).
- Audio transcricao (mensagens de voz).
- Suporte a imagem (vision) e PDF.
- Single-tenant: 1 numero de WhatsApp por deploy.

Alternativas:
- **Baileys** (biblioteca Node): nao-oficial, depende de WebSocket. Quebra quando Meta atualiza o protocolo. Requer persistencia local de credenciais (state).
- **WhatsApp Business API** (oficial): onboarding longo, requer Facebook Business Manager, custo por mensagem, sandbox limitado.
- **Twilio**: similar a Business API, custo medio.
- **Evolution API**: SaaS self-hosted ou gerenciado, wrap do Baileys com API HTTP, webhooks prontos, suporte a multi-instancia.

## Decisao

Usamos **Evolution API** como intermediario. O deploy se conecta via:
- `EVOLUTION_API_URL` (base URL da instancia).
- `EVOLUTION_API_KEY` (auth).
- `WHATSAPP_INSTANCE_NAME` (nome da instancia criada na Evolution).
- `WHATSAPP_OWNER_USER_ID` (UUID do owner no Supabase — RLS gate).

## Consequencias

### Positivas
- **Setup rapido**: 5-10 min para criar instancia, escanear QR, comecar a receber mensagens.
- **Webhooks HTTP**:Evolution entrega via POST, nao WebSocket. Mais facil de mockar/testar.
- **Suporte a midia**: audio, image, video, PDF built-in.
- **Painel de administracao**: conversas, contatos, grupos visiveis.
- **Custo**: $0 self-hosted (Docker), $5-15/mes em Railway/Render.

### Negativas
- **Dependencia de um wrapper unofficial**: Evolution usa Baileys internamente. Se Meta bloquear a abordagem, Evolution quebra. Mitigacao: monitorar repositorio Evolution e ter plano de migracao para Business API.
- **Single-tenant**: cada deploy suporta 1 numero. Multi-tenant exigiria rodar multiplas instancias.
- **Latencia**: ~1-2s adicionada vs conexao direta (Evolution -> Baileys -> WhatsApp servers).
- **Vendor risk**: Evolution e open-source, mas mantida por um grupo pequeno. Se o projeto morrer, precisamos migrar.

### Riscos conhecidos
- Meta pode banir contas que usam Baileys/Evolution. Mitigamos com:
  - Rate limit baixo (20 mensagens/min).
  - Mensagens de "humano" no comeco ("Oi, sou a IA do Joao...").
  - Pausa automatica se ban warning for detectado.

### Quando reverter para Business API
- Volume > 1000 mensagens/dia (custo de Business API compensa).
- SLA contratual com clientes.
- Multi-tenant.

## Referencias

- [Evolution API](https://github.com/EvolutionAPI/evolution-api)
- [Baileys](https://github.com/WhiskeySockets/Baileys)
- Configuracao: `DEPLOY.md` §6
- Implementacao: `api/webhook-whatsapp.js`
