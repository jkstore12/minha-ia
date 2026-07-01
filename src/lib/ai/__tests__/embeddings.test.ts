import { jest } from "@jest/globals";

// Mock do env e do SDK OpenAI antes dos imports.
jest.unstable_mockModule("@/lib/env", () => ({
  env: {
    webSearchEnabled: true,
    aiProvider: "openai",
    aiModel: "gpt-5.4-mini",
    appUrl: "http://localhost:3000",
    appName: "Minha IA",
    aiApiKey: "test-key",
    aiBaseUrl: "https://api.openai.com/v1",
    aiFallbackModels: [],
    aiTemperature: 0.4,
    aiMaxTokens: 4096,
    aiFastMode: true,
  },
  requireAiEnv: () => ({
    provider: "openai",
    apiKey: "test-key",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4-mini",
    fallbackModels: [],
    temperature: 0.4,
    maxTokens: 4096,
  }),
}));

// Mock do OpenAI SDK para que embedText nao faca HTTP real
const mockCreate = jest.fn<(...args: unknown[]) => Promise<{ data: Array<{ embedding: number[] }> }>>();
jest.unstable_mockModule("openai", () => ({
  default: jest.fn().mockImplementation(() => ({
    embeddings: { create: mockCreate },
  })),
}));

const { formatEmbeddingForRpc, embedText, searchAgentKnowledge, __resetClientForTests } = await import("@/lib/ai/embeddings");

describe("embeddings", () => {
  beforeEach(() => {
    __resetClientForTests();
    mockCreate.mockReset();
  });

  describe("formatEmbeddingForRpc", () => {
    it("formata vetor como string pgvector", () => {
      expect(formatEmbeddingForRpc([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
    });

    it("lida com vetor vazio", () => {
      expect(formatEmbeddingForRpc([])).toBe("[]");
    });

    it("preserva precisao dos numeros", () => {
      const result = formatEmbeddingForRpc([0.123456789, -0.987654321]);
      expect(result).toBe("[0.123456789,-0.987654321]");
    });
  });

  describe("embedText", () => {
    it("chama a API e retorna o embedding", async () => {
      mockCreate.mockResolvedValueOnce({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
      const result = await embedText("hello world");
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it("rejeita texto vazio", async () => {
      await expect(embedText("")).rejects.toThrow("vazio");
      await expect(embedText("   ")).rejects.toThrow("vazio");
    });

    it("lanca erro se resposta nao tem embedding", async () => {
      mockCreate.mockResolvedValueOnce({ data: [] });
      await expect(embedText("hello")).rejects.toThrow("nao contem embedding");
    });

    it("trunca texto muito longo antes de enviar", async () => {
      let capturedInput: string | undefined;
      mockCreate.mockImplementationOnce(async (args: unknown) => {
        const params = args as { input: string };
        capturedInput = params.input;
        return { data: [{ embedding: [0.5] }] };
      });

      const longText = "a".repeat(100_000);
      await embedText(longText);

      expect(capturedInput?.length).toBeLessThanOrEqual(32_000);
    });
  });

  describe("searchAgentKnowledge", () => {
    it("chama a RPC com parametros corretos", async () => {
      const mockResults = [
        {
          id: "k1",
          agent_id: "a1",
          user_id: "u1",
          title: "Preco X",
          kind: "price",
          content: "R$ 99",
          tags: null,
          priority: 1,
          source_url: null,
          is_active: true,
          similarity: 0.95,
        },
      ];

      const mockSupabase = {
        rpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
          expect(name).toBe("search_agent_knowledge");
          expect(args.query_embedding).toBe("[0.1,0.2]");
          expect(args.match_count).toBe(5);
          expect(args.filter_agent_id).toBe("a1");
          expect(args.filter_user_id).toBe("u1");
          return { data: mockResults, error: null };
        }),
      };

      const results = await searchAgentKnowledge(mockSupabase as never, {
        queryEmbedding: [0.1, 0.2],
        matchCount: 5,
        agentId: "a1",
        userId: "u1",
      });

      expect(results).toEqual(mockResults);
    });

    it("retorna [] quando data e null", async () => {
      const mockSupabase = {
        rpc: jest.fn(async () => ({ data: null, error: null })),
      };
      const results = await searchAgentKnowledge(mockSupabase as never, {
        queryEmbedding: [0.1],
        userId: "u1",
      });
      expect(results).toEqual([]);
    });

    it("lanca erro quando Supabase retorna error", async () => {
      const mockSupabase = {
        rpc: jest.fn(async () => ({
          data: null,
          error: { message: "permission denied" },
        })),
      };
      await expect(
        searchAgentKnowledge(mockSupabase as never, {
          queryEmbedding: [0.1],
          userId: "u1",
        }),
      ).rejects.toThrow("permission denied");
    });

    it("passa min_similarity quando fornecido", async () => {
      const mockSupabase = {
        rpc: jest.fn(async (_name: string, args: Record<string, unknown>) => {
          expect(args.min_similarity).toBe(0.7);
          return { data: [], error: null };
        }),
      };
      await searchAgentKnowledge(mockSupabase as never, {
        queryEmbedding: [0.1],
        userId: "u1",
        minSimilarity: 0.7,
      });
    });
  });
});
