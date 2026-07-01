/**
 * @jest-environment node
 */
import { jest } from "@jest/globals";

// Mock do env antes de importar o modulo
jest.unstable_mockModule("@/lib/env", () => ({
  env: {
    webSearchEnabled: true,
    aiProvider: "openrouter",
    aiModel: "openai/gpt-5.4-mini",
    appUrl: "http://localhost:3000",
    appName: "Minha IA",
  },
  requireAiEnv: () => ({
    provider: "openrouter",
    apiKey: "test-key",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-5.4-mini",
    fallbackModels: ["openai/gpt-chat-latest", "deepseek/deepseek-v4-flash"],
    temperature: 0.4,
    maxTokens: 4096,
  }),
}));

const { withOpenRouterWebSearch, resolveRuntimeModel, resolveModelCandidates } = await import("@/lib/ai/models");

describe("models", () => {
  describe("withOpenRouterWebSearch", () => {
    it("adiciona :online quando nao tem", () => {
      expect(withOpenRouterWebSearch("gpt-4o")).toBe("gpt-4o:online");
    });

    it("e idempotente", () => {
      expect(withOpenRouterWebSearch("gpt-4o:online")).toBe("gpt-4o:online");
    });
  });

  describe("resolveRuntimeModel", () => {
    it("usa o modelo passado quando fornecido", () => {
      expect(resolveRuntimeModel("claude-opus-4.7", false)).toBe("claude-opus-4.7");
    });

    it("adiciona :online quando webSearch=true e provider=openrouter", () => {
      expect(resolveRuntimeModel("gpt-4o", true)).toBe("gpt-4o:online");
    });

    it("nao adiciona :online se webSearch ja esta no nome", () => {
      expect(resolveRuntimeModel("gpt-4o:online", true)).toBe("gpt-4o:online");
    });
  });

  describe("resolveModelCandidates", () => {
    it("retorna modelo + fallbacks sem duplicatas", () => {
      const candidates = resolveModelCandidates("gpt-4o", false);
      // default + fallbacks definidos no mock
      expect(candidates).toContain("gpt-4o");
      expect(candidates).toContain("openai/gpt-chat-latest");
      expect(candidates).toContain("deepseek/deepseek-v4-flash");
    });

    it("aplica :online em todos quando webSearch=true", () => {
      const candidates = resolveModelCandidates("gpt-4o", true);
      // Cada candidato deve terminar com :online
      for (const c of candidates) {
        expect(c).toMatch(/:online$/);
      }
    });

    it("modelo pedido vem primeiro na lista", () => {
      const candidates = resolveModelCandidates("meu-modelo-custom", false);
      expect(candidates[0]).toBe("meu-modelo-custom");
    });
  });
});
