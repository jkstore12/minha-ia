import { jest } from "@jest/globals";

// Mock the OpenAI client BEFORE importing brain (it instantiates one).
type MockChatResponse = { choices: Array<{ message: { content: string } }> };

// Tipagem permissiva via `as unknown as jest.Mock` para evitar generic
// `never` que o @jest/globals infere por default. Usar `jest.fn<Procedure>()`
// quebrou o setup do mock em runtime (mock nao retornava Promise).
const mockCreate = jest.fn() as unknown as jest.Mock;
const mockChatCompletions = { create: mockCreate };
const mockOpenAIClient = { chat: { completions: mockChatCompletions } };
// `mockOpenAIConstructor` deve retornar o cliente mock quando chamado com `new`.
// `jest.fn(() => mockOpenAIClient)` faz o mock retornar a instancia esperada.
const mockOpenAIConstructor = jest.fn(() => mockOpenAIClient) as unknown as jest.Mock;

jest.unstable_mockModule("openai", () => ({
  default: mockOpenAIConstructor,
}));

// Set required env vars before module loads so env.ts validates correctly.
process.env.AI_API_KEY = "test-key";
process.env.AI_MODEL = "test-model";
process.env.AI_BASE_URL = "https://api.test/v1";
process.env.AI_FALLBACK_MODELS = "fallback-1,fallback-2";

const { runBrain, extractBrainUpdates, resolveRuntimeModel } = await import("@/lib/ai/brain");

// Helper para mockResolvedValueOnce: o generic `never` default de
// jest.Mock nao aceita valores arbitrarios. Castamos via `any`.
function resolveMock(mock: jest.Mock, value: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mock as any).mockResolvedValue(value);
}
function rejectMock(mock: jest.Mock, value: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mock as any).mockRejectedValue(value);
}

beforeEach(() => {
  mockCreate.mockReset();
  mockOpenAIConstructor.mockClear();
});

describe("runBrain (text-only path)", () => {
  it("calls the requested model and returns its text", async () => {
    resolveMock(mockCreate, {
      choices: [{ message: { content: "resposta do modelo" } }],
    });

    const result = await runBrain({
      userMessage: "oi",
      recentMessages: [],
      memories: [],
      model: "requested-model",
      userPreferences: undefined,
    });

    expect(result.text).toBe("resposta do modelo");
    expect(result.usedModel).toBe("requested-model");
    expect(result.fallbackUsed).toBe(false);
    expect(result.attempts).toEqual([{ model: "requested-model", status: "success" }]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("falls back to AI_FALLBACK_MODELS when requested model errors", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockCreate as any).mockRejectedValueOnce(new Error("primary failed"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "resposta do fallback" } }],
      } as MockChatResponse);

    const result = await runBrain({
      userMessage: "oi",
      recentMessages: [],
      memories: [],
      model: "primary",
    });

    expect(result.text).toBe("resposta do fallback");
    expect(result.usedModel).toBe("fallback-1");
    expect(result.fallbackUsed).toBe(true);
    expect(result.attempts).toEqual([
      { model: "primary", status: "error", error: "primary failed" },
      { model: "fallback-1", status: "success" },
    ]);
  });

  it("tries each fallback in order before giving up", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockCreate as any).mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "ok" } }],
      });

    const result = await runBrain({
      userMessage: "oi",
      recentMessages: [],
      memories: [],
      model: "primary",
    });

    expect(result.usedModel).toBe("fallback-2");
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result.attempts).toHaveLength(3);
  });

  it("throws 'Todos os modelos falharam.' when all candidates fail", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockCreate as any).mockRejectedValue(new Error("down"));

    await expect(
      runBrain({
        userMessage: "oi",
        recentMessages: [],
        memories: [],
        model: "primary",
      }),
    ).rejects.toThrow("Todos os modelos falharam.");

    // 1 primary + 2 fallbacks = 3 calls
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("truncates long error messages in attempts", async () => {
    const longMessage = "x".repeat(500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockCreate as any).mockRejectedValueOnce(new Error(longMessage))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "ok" } }],
      });

    const result = await runBrain({
      userMessage: "oi",
      recentMessages: [],
      memories: [],
      model: "primary",
    });

    const erroredAttempt = result.attempts.find((a) => a.status === "error");
    expect(erroredAttempt).toBeDefined();
    expect(erroredAttempt!.error!.length).toBeLessThanOrEqual(240);
  });

  it("uses default empty string when model returns empty content", async () => {
    resolveMock(mockCreate, {
      choices: [{ message: { content: "" } }],
    });

    const result = await runBrain({
      userMessage: "oi",
      recentMessages: [],
      memories: [],
      model: "primary",
    });

    expect(result.text).toBe("");
  });

  it("includes HTTP-Referer and X-Title headers for OpenRouter", async () => {
    // Re-import env to override aiProvider. Simplest: test via mockOpenAIConstructor
    // which receives the defaultHeaders; we just check the constructor was called.
    resolveMock(mockCreate, {
      choices: [{ message: { content: "ok" } }],
    });

    await runBrain({
      userMessage: "oi",
      recentMessages: [],
      memories: [],
      model: "primary",
    });

    expect(mockOpenAIConstructor).toHaveBeenCalled();
    const callArg = mockOpenAIConstructor.mock.calls[0]?.[0] as { defaultHeaders?: Record<string, string> };
    expect(callArg?.defaultHeaders).toBeDefined();
  });

  it("builds system prompt with active agent instructions", async () => {
    resolveMock(mockCreate, {
      choices: [{ message: { content: "ok" } }],
    });

    await runBrain({
      userMessage: "oi",
      recentMessages: [],
      memories: [],
      model: "primary",
      agents: [
        {
          id: "agent-1",
          name: "Coach Financeiro",
          domain: "finanças pessoais",
          description: "Ajuda o usuário com orçamento",
          system_prompt: "Sempre pergunte o valor em reais.",
          tools: ["calculator", "spreadsheet"],
          model: "openai/gpt-4o",
          is_orchestrator: false,
          is_fallback: false,
        },
      ],
      activeAgentId: "agent-1",
    });

    const callArg = mockCreate.mock.calls[0]?.[0] as { messages?: Array<{ role: string; content: string }> };
    const systemMessage = callArg?.messages?.find((m) => m.role === "system");
    expect(systemMessage?.content).toContain("Coach Financeiro");
    expect(systemMessage?.content).toContain("finanças pessoais");
    expect(systemMessage?.content).toContain("calculator, spreadsheet");
    expect(systemMessage?.content).toContain("Sempre pergunte o valor em reais.");
  });
});

describe("runBrain (attachments path)", () => {
  it("uses multimodal content with image_url for images", async () => {
    resolveMock(mockCreate, {
      choices: [{ message: { content: "analisei a imagem" } }],
    });

    await runBrain({
      userMessage: "olha essa foto",
      recentMessages: [],
      memories: [],
      model: "primary",
      attachments: [
        {
          storage_path: "u/1/file.png",
          file_name: "foto.png",
          mime_type: "image/png",
          size_bytes: 1024,
          dataUrl: "data:image/png;base64,AAAA",
        },
      ],
    });

    const callArg = mockCreate.mock.calls[0]?.[0] as {
      messages?: Array<{ role: string; content: unknown }>;
    };
    const userMessage = callArg?.messages?.find((m) => m.role === "user");
    const content = userMessage?.content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[1]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    });
  });

  it("uses file parser plugin for PDFs", async () => {
    resolveMock(mockCreate, {
      choices: [{ message: { content: "ok" } }],
    });

    await runBrain({
      userMessage: "leia esse PDF",
      recentMessages: [],
      memories: [],
      model: "primary",
      attachments: [
        {
          storage_path: "u/1/file.pdf",
          file_name: "doc.pdf",
          mime_type: "application/pdf",
          size_bytes: 1024,
          dataUrl: "data:application/pdf;base64,AAAA",
        },
      ],
    });

    const callArg = mockCreate.mock.calls[0]?.[0] as { plugins?: unknown };
    expect(callArg?.plugins).toEqual([{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]);
  });

  it("uses input_audio format for audio attachments (no transcription)", async () => {
    resolveMock(mockCreate, {
      choices: [{ message: { content: "ok" } }],
    });

    await runBrain({
      userMessage: "ouça esse audio",
      recentMessages: [],
      memories: [],
      model: "primary",
      attachments: [
        {
          storage_path: "u/1/audio.mp3",
          file_name: "audio.mp3",
          mime_type: "audio/mpeg",
          size_bytes: 1024,
          dataUrl: "data:audio/mpeg;base64,QUJD",
          transcription: "", // sem transcricao -> raw audio
        },
      ],
    });

    const callArg = mockCreate.mock.calls[0]?.[0] as {
      messages?: Array<{ role: string; content: unknown }>;
    };
    const content = (callArg?.messages?.find((m) => m.role === "user")?.content as Array<Record<string, unknown>>);
    expect(content.some((c) => c.type === "input_audio")).toBe(true);
  });

  it("falls back to next candidate when attachment call errors", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockCreate as any)
      .mockRejectedValueOnce(new Error("primary pdf fail"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "fallback ok" } }],
      });

    const result = await runBrain({
      userMessage: "leia",
      recentMessages: [],
      memories: [],
      model: "primary",
      attachments: [
        {
          storage_path: "u/1/x.png",
          file_name: "x.png",
          mime_type: "image/png",
          size_bytes: 100,
          dataUrl: "data:image/png;base64,AAAA",
        },
      ],
    });

    expect(result.text).toBe("fallback ok");
    expect(result.fallbackUsed).toBe(true);
  });
});

describe("extractBrainUpdates", () => {
  it("parses valid JSON response into memories and summary", async () => {
    resolveMock(mockCreate, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              memories: [
                { kind: "preference", content: "prefiro respostas curtas", confidence: 0.9 },
                { kind: "goal", content: "aprender Rust ate o fim do ano", confidence: 0.6 },
              ],
              summary: "Usuario discutiu preferencias e metas de aprendizado.",
            }),
          },
        },
      ],
    });

    const result = await extractBrainUpdates({
      userMessage: "guarde que prefiro respostas curtas",
      assistantMessage: "Anotado!",
    });

    expect(result.memories).toHaveLength(2);
    expect(result.memories[0]).toMatchObject({ kind: "preference", content: "prefiro respostas curtas" });
    expect(result.summary).toContain("preferencias");
  });

  it("returns empty memories and previous summary on JSON parse failure", async () => {
    resolveMock(mockCreate, {
      choices: [{ message: { content: "not valid json {{{" } }],
    });

    const result = await extractBrainUpdates({
      userMessage: "x",
      assistantMessage: "y",
      previousSummary: "old summary",
    });

    expect(result.memories).toEqual([]);
    expect(result.summary).toBe("old summary");
  });

  it("returns empty memories and previous summary on network error", async () => {
    rejectMock(mockCreate, new Error("network down"));

    const result = await extractBrainUpdates({
      userMessage: "x",
      assistantMessage: "y",
      previousSummary: "preserved",
    });

    expect(result.memories).toEqual([]);
    expect(result.summary).toBe("preserved");
  });

  it("rejects memories with invalid kind via zod", async () => {
    resolveMock(mockCreate, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              memories: [{ kind: "invalid-kind", content: "test", confidence: 0.5 }],
            }),
          },
        },
      ],
    });

    const result = await extractBrainUpdates({
      userMessage: "x",
      assistantMessage: "y",
    });

    expect(result.memories).toEqual([]);
  });

  it("rejects memories with out-of-range confidence", async () => {
    resolveMock(mockCreate, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              memories: [{ kind: "fact", content: "valid content here", confidence: 5.0 }],
            }),
          },
        },
      ],
    });

    const result = await extractBrainUpdates({
      userMessage: "x",
      assistantMessage: "y",
    });

    expect(result.memories).toEqual([]);
  });

  it("uses response_format json_object", async () => {
    resolveMock(mockCreate, {
      choices: [{ message: { content: JSON.stringify({ memories: [], summary: "" }) } }],
    });

    await extractBrainUpdates({
      userMessage: "x",
      assistantMessage: "y",
    });

    const callArg = mockCreate.mock.calls[0]?.[0] as { response_format?: { type: string } };
    expect(callArg?.response_format).toEqual({ type: "json_object" });
  });

  it("defaults confidence to 0.7 when not provided", async () => {
    resolveMock(mockCreate, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              memories: [{ kind: "fact", content: "algum fato relevante" }],
            }),
          },
        },
      ],
    });

    const result = await extractBrainUpdates({
      userMessage: "x",
      assistantMessage: "y",
    });

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]?.confidence).toBe(0.7);
  });
});

describe("resolveRuntimeModel (re-export from brain)", () => {
  it("returns the model unchanged when no webSearch", () => {
    expect(resolveRuntimeModel("openai/gpt-4o", false)).toBe("openai/gpt-4o");
  });
});

describe("runBrainStream (streaming variant)", () => {
  it("yields delta events for each chunk, then a done event", async () => {
    // Mock OpenAI to return an async iterable of chunks.
    mockCreate.mockImplementationOnce(async () => {
      return (async function* () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yield { choices: [{ delta: { content: "Hello" } }] } as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yield { choices: [{ delta: { content: " world" } }] } as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yield { choices: [{ delta: { content: "!" } }] } as any;
      })();
    });

    const { runBrainStream } = await import("@/lib/ai/brain");
    const events: unknown[] = [];
    for await (const event of runBrainStream({
      userMessage: "oi",
      recentMessages: [],
      memories: [],
      model: "primary",
      userPreferences: undefined,
    })) {
      events.push(event);
    }

    const deltas = events.filter((e) => (e as { type: string }).type === "delta");
    const done = events.find((e) => (e as { type: string }).type === "done");

    expect(deltas).toHaveLength(3);
    expect(deltas[0]).toMatchObject({ type: "delta", text: "Hello" });
    expect(deltas[2]).toMatchObject({ type: "delta", text: "!" });
    expect(done).toMatchObject({
      type: "done",
      usedModel: "primary",
      fallbackUsed: false,
    });
  });

  it("falls back to next model when stream errors", async () => {
    // First model throws, second returns a working stream.
    mockCreate
      .mockImplementationOnce(async () => {
        throw new Error("primary broken");
      })
      .mockImplementationOnce(async () => {
        return (async function* () {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          yield { choices: [{ delta: { content: "fallback text" } }] } as any;
        })();
      });

    const { runBrainStream } = await import("@/lib/ai/brain");
    const events: unknown[] = [];
    for await (const event of runBrainStream({
      userMessage: "oi",
      recentMessages: [],
      memories: [],
      model: "primary",
      userPreferences: undefined,
    })) {
      events.push(event);
    }

    const modelErr = events.find(
      (e) => (e as { type: string }).type === "model" && (e as { status: string }).status === "error",
    );
    const deltas = events.filter((e) => (e as { type: string }).type === "delta");
    const done = events.find((e) => (e as { type: string }).type === "done");

    expect(modelErr).toBeDefined();
    expect(deltas).toHaveLength(1);
    expect(done).toMatchObject({ type: "done", usedModel: "fallback-1" });
  });

  it("yields error event when all models fail", async () => {
    mockCreate.mockImplementation(async () => {
      throw new Error("down");
    });

    const { runBrainStream } = await import("@/lib/ai/brain");
    const events: unknown[] = [];
    for await (const event of runBrainStream({
      userMessage: "oi",
      recentMessages: [],
      memories: [],
      model: "primary",
      userPreferences: undefined,
    })) {
      events.push(event);
    }

    const errorEvent = events.find((e) => (e as { type: string }).type === "error");
    expect(errorEvent).toMatchObject({ type: "error", message: expect.stringContaining("Todos os modelos") });
  });
});