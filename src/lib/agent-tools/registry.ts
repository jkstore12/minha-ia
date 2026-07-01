import { z } from "zod";
import { env, getSetupStatus } from "@/lib/env";

export type ToolCategory = "diagnostics" | "web" | "text" | "data" | "workspace" | "automation";
export type ToolRisk = "low" | "medium" | "high";
export type ToolAvailability = "available" | "requires_configuration" | "requires_local_bridge";

export type PublicAgentTool = {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  risk: ToolRisk;
  availability: ToolAvailability;
  enabled: boolean;
  inputHint: string;
  exampleInput: unknown;
  notes?: string;
};

export type AgentToolRunResult = {
  toolId: string;
  ok: boolean;
  message: string;
  durationMs: number;
  output?: unknown;
};

type AgentTool<Input> = {
  definition: PublicAgentTool;
  schema: z.ZodType<Input>;
  execute: (input: Input) => Promise<Omit<AgentToolRunResult, "toolId" | "durationMs">>;
};

export class AgentToolError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 8000;
const MAX_FETCH_BYTES = 180_000;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const PRIVATE_IPV4_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

const healthInputSchema = z.object({
  deep: z.boolean().optional().default(false),
});

const fetchInputSchema = z.object({
  url: z.string().url("Informe uma URL válida."),
  maxChars: z.number().int().min(200).max(8000).optional().default(2400),
});

const linksInputSchema = z.object({
  text: z.string().min(1, "Informe um texto para analisar.").max(25_000),
});

const jsonFormatInputSchema = z.object({
  value: z.string().min(1, "Informe o JSON.").max(80_000),
});

const localBridgeInputSchema = z.object({});

const terminalRunInputSchema = z.object({
  command: z.enum(["npm.typecheck", "npm.lint", "npm.build", "node.check.telegram", "node.check.whatsapp"]),
  timeoutMs: z.number().int().min(1000).max(180_000).optional(),
});

const workspaceReadInputSchema = z.object({
  path: z.string().min(1).max(500),
  maxChars: z.number().int().min(200).max(60_000).optional(),
});

function withTimeout(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...init,
    signal: controller.signal,
    cache: "no-store",
  }).finally(() => clearTimeout(timeout));
}

function assertPublicHttpUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AgentToolError("A ferramenta aceita apenas URLs HTTP ou HTTPS.");
  }

  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".local") || PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new AgentToolError("URL bloqueada por segurança. Use apenas endereços públicos.");
  }

  return url;
}

async function readLimitedText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let size = 0;

  while (size < MAX_FETCH_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
  }

  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

function extractTitle(text: string) {
  const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function sanitizePreview(text: string, maxChars: number) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function extractLinks(text: string) {
  const matches = text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)/g);
  const seen = new Set<string>();
  return Array.from(matches)
    .map((match) => ({
      label: match[1] || match[3],
      url: match[2] || match[3],
    }))
    .filter((link) => {
      if (!link.url || seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    })
    .slice(0, 30);
}

function localBridgeConfigured() {
  return Boolean(process.env.LOCAL_AGENT_BRIDGE_URL && process.env.LOCAL_AGENT_BRIDGE_TOKEN);
}

function bridgeAvailability(): ToolAvailability {
  return localBridgeConfigured() ? "available" : "requires_local_bridge";
}

async function callLocalBridge(toolId: string, input: unknown, timeoutMs = 130_000) {
  if (!process.env.LOCAL_AGENT_BRIDGE_URL || !process.env.LOCAL_AGENT_BRIDGE_TOKEN) {
    throw new AgentToolError("Configure LOCAL_AGENT_BRIDGE_URL e LOCAL_AGENT_BRIDGE_TOKEN para usar esta ferramenta.", 409);
  }

  const baseUrl = process.env.LOCAL_AGENT_BRIDGE_URL.replace(/\/$/, "");
  const response = await withTimeout(
    `${baseUrl}/tools/${encodeURIComponent(toolId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LOCAL_AGENT_BRIDGE_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ input }),
    },
    timeoutMs,
  );
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; output?: unknown; error?: string } | null;

  if (!response.ok) {
    throw new AgentToolError(payload?.error || payload?.message || `Ponte local respondeu HTTP ${response.status}.`, response.status);
  }

  return {
    ok: Boolean(payload?.ok),
    message: payload?.message || "Ferramenta executada pela ponte local.",
    output: payload?.output,
  };
}

const tools: Record<string, AgentTool<unknown>> = {
  "system.health": {
    definition: {
      id: "system.health",
      name: "Diagnóstico do sistema",
      description: "Mostra se Supabase, IA, áudio, WhatsApp, Telegram e cron estão configurados.",
      category: "diagnostics",
      risk: "low",
      availability: "available",
      enabled: true,
      inputHint: "Opcional: { \"deep\": true } para incluir detalhes de configuração.",
      exampleInput: { deep: false },
    },
    schema: healthInputSchema,
    async execute(input) {
      const setup = getSetupStatus();
      const deep = (input as z.infer<typeof healthInputSchema>).deep;

      return {
        ok: setup.supabase.configured && setup.ai.configured,
        message: setup.supabase.configured && setup.ai.configured
          ? "Configuração principal encontrada."
          : "Existem configurações pendentes.",
        output: {
          supabaseConfigured: setup.supabase.configured,
          aiConfigured: setup.ai.configured,
          provider: setup.ai.provider,
          model: setup.ai.model,
          webSearch: setup.ai.webSearch,
          audioTranscription: setup.ai.audioTranscription,
          telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
          telegramOwnerConfigured: Boolean(process.env.TELEGRAM_OWNER_CHAT_ID),
          whatsappConfigured: Boolean(process.env.EVOLUTION_API_KEY),
          whatsappInstance: process.env.WHATSAPP_INSTANCE_NAME || "minha-ia",
          cronProtected: Boolean(process.env.CRON_SECRET),
          localBridgeConfigured: localBridgeConfigured(),
          deep,
        },
      };
    },
  },
  "web.fetch": {
    definition: {
      id: "web.fetch",
      name: "Ler página pública",
      description: "Busca uma URL pública e retorna status, título e prévia limpa do conteúdo.",
      category: "web",
      risk: "medium",
      availability: "available",
      enabled: true,
      inputHint: "{ \"url\": \"https://exemplo.com\", \"maxChars\": 2400 }",
      exampleInput: { url: "https://example.com", maxChars: 1200 },
      notes: "Endereços locais e redes privadas são bloqueados por segurança.",
    },
    schema: fetchInputSchema,
    async execute(input) {
      const { url, maxChars } = input as z.infer<typeof fetchInputSchema>;
      const target = assertPublicHttpUrl(url);
      const response = await withTimeout(target.toString(), {
        headers: {
          Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.5",
          "User-Agent": `${env.appName}/agent-tools`,
        },
      });
      const contentType = response.headers.get("content-type") || "não informado";
      const text = await readLimitedText(response);

      return {
        ok: response.ok,
        message: response.ok ? "Página lida com sucesso." : `A página respondeu HTTP ${response.status}.`,
        output: {
          url: target.toString(),
          status: response.status,
          contentType,
          title: extractTitle(text),
          preview: sanitizePreview(text, maxChars),
        },
      };
    },
  },
  "text.extractLinks": {
    definition: {
      id: "text.extractLinks",
      name: "Extrair links",
      description: "Encontra links em texto comum ou Markdown para gerar referências clicáveis.",
      category: "text",
      risk: "low",
      availability: "available",
      enabled: true,
      inputHint: "{ \"text\": \"Cole o texto com links aqui\" }",
      exampleInput: { text: "Veja https://example.com e [OpenAI](https://openai.com)." },
    },
    schema: linksInputSchema,
    async execute(input) {
      const links = extractLinks((input as z.infer<typeof linksInputSchema>).text);
      return {
        ok: true,
        message: links.length ? `${links.length} link(s) encontrado(s).` : "Nenhum link encontrado.",
        output: { links },
      };
    },
  },
  "json.format": {
    definition: {
      id: "json.format",
      name: "Validar e formatar JSON",
      description: "Valida JSON e devolve uma versão formatada para copiar ou analisar.",
      category: "data",
      risk: "low",
      availability: "available",
      enabled: true,
      inputHint: "{ \"value\": \"{\\\"nome\\\":\\\"Minha IA\\\"}\" }",
      exampleInput: { value: "{\"nome\":\"Minha IA\",\"ativo\":true}" },
    },
    schema: jsonFormatInputSchema,
    async execute(input) {
      try {
        const parsed = JSON.parse((input as z.infer<typeof jsonFormatInputSchema>).value);
        return {
          ok: true,
          message: "JSON válido.",
          output: { formatted: JSON.stringify(parsed, null, 2), type: Array.isArray(parsed) ? "array" : typeof parsed },
        };
      } catch (error) {
        throw new AgentToolError(error instanceof Error ? `JSON inválido: ${error.message}` : "JSON inválido.");
      }
    },
  },
  "local.bridge.status": {
    definition: {
      id: "local.bridge.status",
      name: "Ponte local do agente",
      description: "Verifica se existe configuração para uma ponte local capaz de acessar arquivos, terminal e navegador do computador.",
      category: "workspace",
      risk: "medium",
      availability: localBridgeConfigured() ? "available" : "requires_configuration",
      enabled: true,
      inputHint: "{}",
      exampleInput: {},
      notes: "A ponte local é o caminho seguro para recursos estilo Codex fora do ambiente Vercel.",
    },
    schema: localBridgeInputSchema,
    async execute() {
      return {
        ok: localBridgeConfigured(),
        message: localBridgeConfigured()
          ? "Ponte local configurada. A execução de ferramentas locais ainda deve exigir aprovação explícita."
          : "Ponte local não configurada.",
        output: {
          configured: localBridgeConfigured(),
          bridgeUrlConfigured: Boolean(process.env.LOCAL_AGENT_BRIDGE_URL),
          tokenConfigured: Boolean(process.env.LOCAL_AGENT_BRIDGE_TOKEN),
          supportedTools: ["workspace.files.read", "terminal.run", "git.status"],
          plannedTools: ["workspace.files.write", "browser.verify"],
        },
      };
    },
  },
  "git.status": {
    definition: {
      id: "git.status",
      name: "Status do projeto",
      description: "Consulta o status Git do workspace pela ponte local.",
      category: "workspace",
      risk: "low",
      availability: bridgeAvailability(),
      enabled: localBridgeConfigured(),
      inputHint: "{}",
      exampleInput: {},
      notes: "Leitura segura. Não altera arquivos.",
    },
    schema: localBridgeInputSchema,
    async execute(input) {
      return callLocalBridge("git.status", input, 30_000);
    },
  },
  "workspace.files.read": {
    definition: {
      id: "workspace.files.read",
      name: "Ler arquivo do projeto",
      description: "Lê um arquivo dentro do workspace autorizado pela ponte local.",
      category: "workspace",
      risk: "medium",
      availability: bridgeAvailability(),
      enabled: localBridgeConfigured(),
      inputHint: "{ \"path\": \"src/app/(platform)/tools/page.tsx\", \"maxChars\": 12000 }",
      exampleInput: { path: "src/app/(platform)/tools/page.tsx", maxChars: 12000 },
      notes: "A ponte bloqueia caminhos fora do workspace e limita o tamanho da resposta.",
    },
    schema: workspaceReadInputSchema,
    async execute(input) {
      return callLocalBridge("workspace.files.read", input, 30_000);
    },
  },
  "terminal.run": {
    definition: {
      id: "terminal.run",
      name: "Executar validação",
      description: "Executa apenas comandos permitidos de validação do projeto pela ponte local.",
      category: "workspace",
      risk: "high",
      availability: bridgeAvailability(),
      enabled: localBridgeConfigured(),
      inputHint: "{ \"command\": \"npm.typecheck\", \"timeoutMs\": 120000 }",
      exampleInput: { command: "npm.typecheck", timeoutMs: 120000 },
      notes: "Não executa comandos livres. Permitidos: npm.typecheck, npm.lint, npm.build, node.check.telegram, node.check.whatsapp.",
    },
    schema: terminalRunInputSchema,
    async execute(input) {
      const timeoutMs = (input as z.infer<typeof terminalRunInputSchema>).timeoutMs || 130_000;
      return callLocalBridge("terminal.run", input, timeoutMs + 5000);
    },
  },
};

const futureTools: PublicAgentTool[] = [
  {
    id: "workspace.files.write",
    name: "Editar arquivos do projeto",
    description: "Aplicaria alterações em arquivos com diff revisável.",
    category: "workspace",
    risk: "high",
    availability: "requires_local_bridge",
    enabled: false,
    inputHint: "{ \"path\": \"...\", \"patch\": \"...\" }",
    exampleInput: { path: "src/app/page.tsx", patch: "diff aprovado" },
  },
  {
    id: "browser.verify",
    name: "Testar navegador",
    description: "Abriria fluxos no navegador local para validar telas e botões.",
    category: "automation",
    risk: "medium",
    availability: "requires_local_bridge",
    enabled: false,
    inputHint: "{ \"url\": \"http://localhost:3000\" }",
    exampleInput: { url: "http://localhost:3000" },
  },
];

export function listAgentTools() {
  return [...Object.values(tools).map((tool) => tool.definition), ...futureTools];
}

export function getToolSummary() {
  const allTools = listAgentTools();
  return {
    total: allTools.length,
    available: allTools.filter((tool) => tool.availability === "available" && tool.enabled).length,
    requiresConfiguration: allTools.filter((tool) => tool.availability === "requires_configuration").length,
    requiresLocalBridge: allTools.filter((tool) => tool.availability === "requires_local_bridge").length,
  };
}

export async function runAgentTool(toolId: string, input: unknown): Promise<AgentToolRunResult> {
  const tool = tools[toolId];
  if (!tool) {
    const knownFutureTool = futureTools.find((candidate) => candidate.id === toolId);
    if (knownFutureTool) {
      throw new AgentToolError("Esta ferramenta precisa da ponte local antes de poder executar.", 409);
    }
    throw new AgentToolError("Ferramenta não encontrada.", 404);
  }

  if (!tool.definition.enabled) {
    throw new AgentToolError("Ferramenta desativada.", 409);
  }

  const startedAt = performance.now();
  const parsedInput = tool.schema.parse(input ?? {});
  const result = await tool.execute(parsedInput);

  return {
    toolId,
    durationMs: Math.round(performance.now() - startedAt),
    ...result,
  };
}
