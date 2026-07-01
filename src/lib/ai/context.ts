/**
 * Construcao de contexto (system prompt) para o brain.
 *
 * Funcoes puras que montam o bloco de texto que o modelo recebe.
 * Extraidas de brain.ts para serem testaveis em isolamento.
 */

import { isImageMime, isPdfMime, isAudioMime, type PreparedAttachment } from "@/lib/chat/attachments";
import type { UserPreferences } from "@/lib/user-preferences";

export type ContextMemory = {
  kind: string;
  content: string;
  confidence: number | null;
};

export type ContextMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ContextAgent = {
  id?: string | null;
  name: string;
  domain: string;
  description: string | null;
  system_prompt: string | null;
  tools: string[] | null;
  model: string | null;
  is_orchestrator: boolean | null;
  is_fallback: boolean | null;
};

export type ContextKnowledge = {
  title: string;
  kind: string;
  content: string;
  tags?: string[] | null;
  priority?: number | null;
  source_url?: string | null;
};

export type ContextInput = {
  userMessage: string;
  recentMessages: ContextMessage[];
  memories: ContextMemory[];
  knowledge?: ContextKnowledge[];
  agents?: ContextAgent[];
  conversationSummary?: string | null;
  attachments?: PreparedAttachment[];
  actionResults?: string[];
  userPreferences?: UserPreferences;
  activeAgentId?: string;
};

// Limites sao configurados aqui. Podem virar env vars no futuro se
// algum usuario quiser tunar.
export const CONTEXT_LIMITS = {
  historyMessages: 24,
  memories: 30,
  agents: 12,
  knowledgeEntries: 30,
  attachmentTextChars: 60_000,
} as const;

// =============================================================================
// Blocos individuais
// =============================================================================

export function renderMemoriesBlock(memories: ContextMemory[], limit = CONTEXT_LIMITS.memories): string {
  if (!memories.length) return "- Nenhuma memória persistente ainda.";
  return memories
    .slice(0, limit)
    .map((memory) => `- [${memory.kind}] ${memory.content}`)
    .join("\n");
}

export function renderHistoryBlock(
  recentMessages: ContextMessage[],
  limit = CONTEXT_LIMITS.historyMessages,
): string {
  if (!recentMessages.length) return "Sem histórico recente.";
  return recentMessages
    .slice(-limit)
    .map((message) => `${message.role === "user" ? "Usuário" : "Minha IA"}: ${message.content}`)
    .join("\n");
}

export function renderAgentsBlock(
  agents: ContextAgent[] | undefined,
  activeAgentId: string | undefined,
  limit = CONTEXT_LIMITS.agents,
): string {
  if (!agents?.length) return "- Nenhum agente especializado cadastrado. Atue como agente principal.";
  return agents
    .slice(0, limit)
    .map((agent) => {
      const isActive = Boolean(activeAgentId && agent.id === activeAgentId);
      const flags = [
        isActive ? "AGENTE ATIVO PRINCIPAL" : null,
        agent.is_orchestrator ? "orquestrador" : null,
        agent.is_fallback ? "fallback" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return [
        `- ${agent.name} (${agent.domain}${flags ? `, ${flags}` : ""})`,
        agent.description ? `  Descrição: ${agent.description}` : null,
        agent.system_prompt ? `  Instrucao: ${agent.system_prompt}` : null,
        agent.tools?.length ? `  Ferramentas declaradas: ${agent.tools.join(", ")}` : null,
        agent.model ? `  Modelo preferido: ${agent.model}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

export function renderAttachmentsBlock(
  attachments: PreparedAttachment[] | undefined,
  limit = CONTEXT_LIMITS.attachmentTextChars,
): string {
  if (!attachments?.length) return "Nenhum arquivo anexado.";
  return attachments
    .map((attachment, index) => {
      const lines = [
        `Arquivo ${index + 1}: ${attachment.file_name}`,
        `Tipo: ${attachment.mime_type}`,
        `Tamanho: ${attachment.size_bytes} bytes`,
      ];
      if (attachment.text) lines.push(`Conteúdo extraído:\n${attachment.text.slice(0, limit)}`);
      if (attachment.transcription) {
        lines.push(
          `Transcrição de áudio (${attachment.transcriptionModel || "modelo de transcrição"}):\n${attachment.transcription.slice(0, limit)}`,
        );
      }
      if (attachment.transcriptionError) {
        lines.push(`Transcrição de áudio indisponível: ${attachment.transcriptionError}`);
      }
      if (
        !attachment.text &&
        !attachment.transcription &&
        !isImageMime(attachment.mime_type) &&
        !isPdfMime(attachment.mime_type) &&
        !isAudioMime(attachment.mime_type, attachment.file_name)
      ) {
        lines.push("Conteúdo binário não extraído automaticamente.");
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

export function renderKnowledgeBlock(
  knowledge: ContextKnowledge[] | undefined,
  limit = CONTEXT_LIMITS.knowledgeEntries,
): string {
  if (!knowledge?.length) return "- Nenhum conhecimento especifico cadastrado para o agente ativo.";
  return knowledge
    .slice(0, limit)
    .map((item) => {
      const tags = item.tags?.length ? ` Tags: ${item.tags.join(", ")}.` : "";
      const source = item.source_url ? ` Fonte: ${item.source_url}.` : "";
      return [`- [${item.kind}] ${item.title}${tags}${source}`, item.content].join("\n  ");
    })
    .join("\n");
}

export function renderPreferencesBlock(preferences: UserPreferences | undefined): string {
  if (!preferences) return "Preferencias ainda não configuradas.";
  return [
    preferences.aboutUser ? `Sobre o usuário: ${preferences.aboutUser}` : null,
    preferences.goals ? `Objetivos: ${preferences.goals}` : null,
    `Estilo: ${preferences.responseStyle}`,
    `Tom: ${preferences.responseTone}`,
    `Busca web: ${preferences.webSearchMode}`,
    `Memória: ${preferences.memoryMode}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// =============================================================================
// Composicao final
// =============================================================================

/**
 * Renderiza o bloco de user prompt (nao o system prompt) que vai para o
 * modelo. Inclui historico, contexto do agente, conhecimento, preferencias,
 * resumo, acoes executadas, anexos e a mensagem do usuario.
 */
export function renderContext(input: ContextInput): string {
  return [
    "Agentes especializados disponíveis:",
    renderAgentsBlock(input.agents, input.activeAgentId),
    "",
    "Contexto persistente do usuário:",
    renderMemoriesBlock(input.memories),
    "",
    "Base de conhecimento do agente ativo:",
    renderKnowledgeBlock(input.knowledge),
    "Use esta base como fonte preferencial quando o assunto pertencer ao agente ativo. Não invente preço, estoque, regra, disponibilidade ou política que não esteja aqui.",
    "",
    "Configurações pessoais do usuário:",
    renderPreferencesBlock(input.userPreferences),
    "",
    "Resumo da conversa:",
    input.conversationSummary || "Ainda não ha resumo consolidado.",
    "",
    "Histórico recente:",
    renderHistoryBlock(input.recentMessages),
    "",
    "Arquivos anexados nesta mensagem:",
    renderAttachmentsBlock(input.attachments),
    "",
    "Ações reais já executadas pelo sistema nesta mensagem:",
    input.actionResults?.length ? input.actionResults.map((r) => `- ${r}`).join("\n") : "- Nenhuma ação executada antes da resposta.",
    "",
    "Nova mensagem do usuário:",
    input.userMessage,
  ].join("\n");
}
