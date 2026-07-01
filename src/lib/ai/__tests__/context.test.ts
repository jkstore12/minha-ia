import {
  CONTEXT_LIMITS,
  renderAgentsBlock,
  renderAttachmentsBlock,
  renderContext,
  renderHistoryBlock,
  renderKnowledgeBlock,
  renderMemoriesBlock,
  renderPreferencesBlock,
  type ContextAgent,
  type ContextInput,
  type ContextKnowledge,
  type ContextMemory,
  type ContextMessage,
} from "@/lib/ai/context";

const baseInput = (): ContextInput => ({
  userMessage: "Oi",
  recentMessages: [],
  memories: [],
  agents: [],
});

describe("context", () => {
  describe("renderMemoriesBlock", () => {
    it("retorna placeholder para memories vazias", () => {
      expect(renderMemoriesBlock([])).toBe("- Nenhuma memória persistente ainda.");
    });

    it("formata memories com prefixo de kind", () => {
      const memories: ContextMemory[] = [
        { kind: "preference", content: "prefiro Python", confidence: 0.9 },
        { kind: "fact", content: "trabalho na Acme", confidence: 0.95 },
      ];
      const result = renderMemoriesBlock(memories);
      expect(result).toContain("- [preference] prefiro Python");
      expect(result).toContain("- [fact] trabalho na Acme");
    });

    it("respeita o limite de memories", () => {
      const memories = Array.from({ length: 100 }, (_, i) => ({
        kind: "fact",
        content: `fato ${i}`,
        confidence: 0.5,
      }));
      const result = renderMemoriesBlock(memories);
      const lines = result.split("\n");
      expect(lines.length).toBe(CONTEXT_LIMITS.memories);
    });
  });

  describe("renderHistoryBlock", () => {
    it("retorna placeholder para historico vazio", () => {
      expect(renderHistoryBlock([])).toBe("Sem histórico recente.");
    });

    it("marca mensagens do usuario vs IA", () => {
      const messages: ContextMessage[] = [
        { role: "user", content: "pergunta" },
        { role: "assistant", content: "resposta" },
      ];
      const result = renderHistoryBlock(messages);
      expect(result).toContain("Usuário: pergunta");
      expect(result).toContain("Minha IA: resposta");
    });

    it("respeita limite do historico (pega os ultimos)", () => {
      const messages: ContextMessage[] = Array.from({ length: 50 }, (_, i) => ({
        role: "user" as const,
        content: `msg ${i}`,
      }));
      const result = renderHistoryBlock(messages);
      expect(result).toContain("msg 49");
      expect(result).not.toContain("msg 0");
    });
  });

  describe("renderAgentsBlock", () => {
    it("retorna placeholder para lista vazia", () => {
      expect(renderAgentsBlock(undefined, undefined)).toBe(
        "- Nenhum agente especializado cadastrado. Atue como agente principal.",
      );
    });

    it("marca o agente ativo principal", () => {
      const agents: ContextAgent[] = [
        { id: "a1", name: "Pessoal", domain: "personal", description: null, system_prompt: null, tools: null, model: null, is_orchestrator: false, is_fallback: false },
        { id: "a2", name: "Vendas", domain: "sales", description: null, system_prompt: null, tools: null, model: null, is_orchestrator: false, is_fallback: false },
      ];
      const result = renderAgentsBlock(agents, "a2");
      expect(result).toContain("Vendas (sales, AGENTE ATIVO PRINCIPAL)");
      expect(result).toContain("Pessoal (personal)");
    });

    it("marca flags orchestrator e fallback", () => {
      const agents: ContextAgent[] = [
        { id: "a1", name: "Main", domain: "orchestrator", description: null, system_prompt: null, tools: null, model: null, is_orchestrator: true, is_fallback: false },
        { id: "a2", name: "Backup", domain: "fallback", description: null, system_prompt: null, tools: null, model: null, is_orchestrator: false, is_fallback: true },
      ];
      const result = renderAgentsBlock(agents, undefined);
      expect(result).toContain("orquestrador");
      expect(result).toContain("fallback");
    });
  });

  describe("renderKnowledgeBlock", () => {
    it("retorna placeholder para knowledge vazio", () => {
      expect(renderKnowledgeBlock(undefined)).toContain("Nenhum conhecimento especifico");
    });

    it("inclui tags e source_url quando presentes", () => {
      const knowledge: ContextKnowledge[] = [
        {
          title: "Preço X",
          kind: "price",
          content: "R$ 99",
          tags: ["premium", "novo"],
          source_url: "https://x.com/y",
        },
      ];
      const result = renderKnowledgeBlock(knowledge);
      expect(result).toContain("Tags: premium, novo");
      expect(result).toContain("Fonte: https://x.com/y");
      expect(result).toContain("R$ 99");
    });
  });

  describe("renderAttachmentsBlock", () => {
    it("retorna placeholder para attachments vazios", () => {
      expect(renderAttachmentsBlock(undefined)).toBe("Nenhum arquivo anexado.");
    });
  });

  describe("renderPreferencesBlock", () => {
    it("retorna placeholder sem preferences", () => {
      expect(renderPreferencesBlock(undefined)).toBe("Preferencias ainda não configuradas.");
    });
  });

  describe("renderContext (composicao)", () => {
    it("inclui todos os blocos principais", () => {
      const result = renderContext(baseInput());
      expect(result).toContain("Agentes especializados disponíveis:");
      expect(result).toContain("Contexto persistente do usuário:");
      expect(result).toContain("Base de conhecimento do agente ativo:");
      expect(result).toContain("Configurações pessoais do usuário:");
      expect(result).toContain("Histórico recente:");
      expect(result).toContain("Nova mensagem do usuário:");
      expect(result).toContain("Oi");
    });

    it("aceita input minimo sem opcionais", () => {
      const result = renderContext({
        userMessage: "teste",
        recentMessages: [],
        memories: [],
      });
      expect(result).toBeTruthy();
    });
  });
});
