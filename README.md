# Minha IA

Agente pessoal web com login Supabase, historico persistente, memoria adaptativa e modelos de IA configuraveis.

## Como Rodar

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

O arquivo `.env.local` ja foi criado com OpenRouter como padrao. Preencha as chaves e reinicie o servidor.

## Abrir No Celular Ou Outro Navegador

Para acessar de outro dispositivo na mesma rede Wi-Fi:

```bash
npm run dev:lan
```

Depois descubra o IP do computador:

```powershell
ipconfig
```

No celular, abra:

```text
http://SEU-IP:3000
```

Exemplo: `http://192.168.31.43:3000`.

Se nao abrir, permita Node.js/Next.js no Firewall do Windows para redes privadas.

## Supabase

1. Crie um projeto Supabase.
2. Copie `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` para `.env.local`.
3. Aplique `supabase/setup.sql` no SQL Editor do Supabase.
4. Habilite Auth por email/senha no painel do Supabase.

## Modelos De IA

O app ja vem preparado para varios modelos. Voce so troca envs e coloca a chave.

OpenAI:

```bash
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_MODEL=gpt-5.4-mini
```

OpenRouter:

```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=openai/gpt-chat-latest
AI_FALLBACK_MODELS=openai/gpt-chat-latest,deepseek/deepseek-v4-flash,deepseek/deepseek-v4-flash:free
AI_TEMPERATURE=0.4
AI_MAX_TOKENS=4096
AI_FAST_MODE=true
AI_AUTO_LEARNING=true
WEB_SEARCH_ENABLED=true
```

Com OpenRouter, a tela do chat ja mostra varias opcoes prontas, incluindo modelos OpenAI, Anthropic, Google, xAI, Mistral, DeepSeek, Qwen, Ling, Ring e opcoes gratuitas quando disponiveis.

O runtime do modelo tem fallback automatico: se um modelo falhar, o sistema tenta os modelos em `AI_FALLBACK_MODELS` e mostra qual modelo realmente respondeu. O painel tambem exibe contexto, preco por 1M tokens, modalidades suportadas e parametros informados pelo catalogo do OpenRouter.

O chat tambem avisa quando voce anexa um arquivo que talvez nao seja suportado pelo modelo selecionado. Nesse caso, ele tenta automaticamente um modelo compativel antes de falhar.

## Tempo De Resposta

O app vem com `AI_FAST_MODE=true`. Esse modo nao troca o modelo e nao reduz o raciocinio: ele apenas remove trabalho secundario do caminho critico, como logs e aprendizado automatico, que passam a rodar depois que a resposta ja foi enviada. O contexto principal continua usando historico, memorias, agentes, anexos e instrucoes.

Para desligar aprendizado automatico por IA e deixar somente memorias manuais, use `AI_AUTO_LEARNING=false` ou ajuste a memoria em `Configuracoes`.

## Pesquisa Na Internet

Com `AI_PROVIDER=openrouter`, o app ativa busca web automaticamente quando a mensagem pede informacao atual, noticias, precos, clima, resultados ou quando voce escreve "pesquise", "internet" ou "web". Internamente ele usa o modo `:online` do OpenRouter. Para desligar, defina `WEB_SEARCH_ENABLED=false`.

Voce tambem pode controlar isso pela tela `Configuracoes` ou pelo botao `Instrucoes da IA` dentro do chat:

- `Automatica`: pesquisa quando detectar necessidade.
- `Sempre tentar`: usa busca web em toda resposta.
- `Desligada`: responde sem busca web.

## Arquivos E Fotos No Chat

O chat aceita anexos pelo botao de clipe. Arquivos ficam salvos no Supabase Storage privado, vinculados a mensagem e visiveis no historico. Imagens, PDFs e arquivos de texto/codigo sao enviados para a IA quando o modelo escolhido suporta esse tipo de entrada; outros formatos ficam anexados com metadados para consulta e download.

## Audio E Microfone

O chat tem gravador de voz com microfone, cancelamento de eco, reducao de ruido e controle automatico de ganho quando o navegador oferece suporte. Ao enviar um audio, o servidor transcreve a fala com Whisper Large V3 via OpenRouter e entrega a transcricao como contexto para a IA. Isso permite que qualquer modelo de chat escolhido entenda o audio, mesmo quando o modelo nao aceita audio nativamente.

Para ativar transcricao de voz em producao, configure:

```bash
AUDIO_TRANSCRIPTION_ENABLED=true
OPENROUTER_API_KEY=...
AUDIO_TRANSCRIPTION_MODEL=openai/whisper-large-v3
```

Por padrao, a transcricao usa a propria `OPENROUTER_API_KEY`. Se quiser separar custos ou credenciais, defina `AUDIO_TRANSCRIPTION_API_KEY`. A transcricao nao depende do modelo ativo do chat; depois que o Whisper gera o texto, esse texto e enviado ao modelo escolhido.

Limites padrao:

- ate 8 anexos por mensagem;
- ate 25 MB por arquivo;
- ate 5 minutos por gravacao de voz pelo microfone;
- bucket privado `chat-attachments`.

## Acoes Reais Pelo Chat

O agente ja executa algumas acoes internas sem integrações externas:

- `Guarde que eu prefiro respostas curtas` salva uma memoria persistente.
- `Crie uma tarefa para revisar meus leads toda semana` cria uma tarefa na Agenda.
- `Me lembre amanha as 9 de tomar remedio` cria um lembrete com data e hora na area Habilidades.
- `Leia este link https://... e resuma` busca o conteudo da pagina e entrega como contexto para a IA.

Essas acoes entram como suporte interno para a resposta, sem mostrar um painel grande de processos para o usuario.

Seguranca aplicada:

- leitura de links bloqueia enderecos locais/privados;
- conteudo de sites e arquivos e tratado como dado nao confiavel;
- memorias iguais nao sao duplicadas;
- respostas podem ser copiadas diretamente pelo botao "Copiar".

Provedor customizado OpenAI-compatible:

```bash
AI_PROVIDER=custom
AI_API_KEY=...
AI_BASE_URL=https://seu-provedor/v1
AI_MODEL=...
```

## Bot Telegram

O projeto inclui o webhook `api/webhook-telegram.js`, compativel com Vercel Serverless Functions. Ele recebe mensagens do Telegram por webhook, usa a mesma chave/modelo do OpenRouter configurados no app e responde no chat do Telegram.

O bot tambem entende midias automaticamente:

- audio: transcreve com `openai/whisper-large-v3` via OpenRouter e responde com `🎤 Você disse:`;
- imagens: baixa a foto, envia para `openai/gpt-4o` com fallback para Claude Sonnet Latest e responde com `🖼️ Sobre a imagem:`;
- PDFs: extrai texto do documento, envia para o modelo ativo da conversa e responde com `📄 Sobre o documento:`.

Variavel obrigatoria:

```bash
TELEGRAM_BOT_TOKEN=token_do_botfather
```

Variavel opcional recomendada:

```bash
TELEGRAM_WEBHOOK_SECRET=um_segredo_longo
```

Depois do deploy, registre o webhook no Telegram:

```bash
https://api.telegram.org/botSEU_TOKEN/setWebhook?url=https://minha-ia-orquestrador.vercel.app/api/webhook-telegram
```

Com segredo:

```bash
curl -X POST "https://api.telegram.org/botSEU_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://minha-ia-orquestrador.vercel.app/api/webhook-telegram\",\"secret_token\":\"SEU_TELEGRAM_WEBHOOK_SECRET\"}"
```

O historico recente e mantido por `chat.id` durante a sessao ativa da funcao serverless.

## Onde Mexer

- `src/lib/env.ts`: variaveis de ambiente e provedor padrao.
- `src/lib/ai/model-presets.ts`: lista de modelos exibida na UI.
- `src/lib/ai/brain.ts`: prompt, comportamento e memoria do agente.
- `src/lib/user-preferences.ts`: instrucoes pessoais, modo de memoria e modo de busca.
- `src/app/api/chat/route.ts`: fluxo de chat, persistencia e atualizacao do cerebro.
- `api/webhook-telegram.js`: webhook do bot Telegram para Vercel.
- `src/app/api/settings/route.ts`: configuracoes pessoais usadas pelo agente.
- `src/app/(platform)/abilities/page.tsx`: central de habilidades, lembretes e agentes customizados.
- `src/app/setup/page.tsx`: tela de status para producao local.
- `src/app/api/health/route.ts`: healthcheck para saber se esta pronto.
- `src/components/chat/chat-shell.tsx`: interface principal.
- `supabase/setup.sql`: setup completo do banco, indices e RLS.

## Verificacao

```bash
npm run typecheck
npm run lint
npm run build
```
