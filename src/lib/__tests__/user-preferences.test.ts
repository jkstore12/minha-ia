import {
  DEFAULT_USER_PREFERENCES,
  parseUserPreferences,
  UserPreferencesSchema,
} from "@/lib/user-preferences";

describe("DEFAULT_USER_PREFERENCES", () => {
  it("is a complete UserPreferences object", () => {
    expect(DEFAULT_USER_PREFERENCES).toMatchObject({
      customInstructions: "",
      aboutUser: "",
      goals: "",
      responseStyle: "direto",
      responseTone: "profissional",
      preferredModel: "",
      activeAgentId: "",
      whatsappAgentId: "",
      knowledgeAgentId: "",
      telegramKnowledgeAgentId: "",
      whatsappKnowledgeAgentId: "",
      knowledgeCapture: {},
      reminderCapture: {},
      whatsappBotEnabled: true,
      personalAgentEnabled: true,
      personalVipContacts: "",
      personalUrgentTopics: "",
      webSearchMode: "auto",
      memoryMode: "auto",
      showModelDetails: true,
    });
  });

  it("has full personalProfile defaults", () => {
    expect(DEFAULT_USER_PREFERENCES.personalProfile).toEqual({
      name: "",
      profession: "",
      availableHours: "8h as 18h",
      availableDays: ["mon", "tue", "wed", "thu", "fri"],
      startTime: "08:00",
      endTime: "18:00",
      timezone: "America/Fortaleza",
      outOfHoursMessage: "Oi! Estou ocupado agora, mas retorno assim que puder.",
    });
  });

  it("has telegramIntegration defaults", () => {
    expect(DEFAULT_USER_PREFERENCES.telegramIntegration).toEqual({
      chatId: "",
      userName: "",
      linkedAt: "",
      linkCode: "",
      linkCodeExpiresAt: "",
    });
  });
});

describe("parseUserPreferences", () => {
  it("returns full defaults when value is null", () => {
    const result = parseUserPreferences(null);
    expect(result).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it("returns full defaults when value is undefined", () => {
    const result = parseUserPreferences(undefined);
    expect(result).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it("returns full defaults when value is not an object", () => {
    expect(parseUserPreferences("string")).toEqual(DEFAULT_USER_PREFERENCES);
    expect(parseUserPreferences(42)).toEqual(DEFAULT_USER_PREFERENCES);
    expect(parseUserPreferences([])).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it("merges partial overrides with defaults", () => {
    const result = parseUserPreferences({ responseStyle: "criativo", aboutUser: "sou dev" });
    expect(result.responseStyle).toBe("criativo");
    expect(result.aboutUser).toBe("sou dev");
    // Other fields keep defaults
    expect(result.responseTone).toBe("profissional");
    expect(result.goals).toBe("");
    expect(result.personalProfile.timezone).toBe("America/Fortaleza");
  });

  it("clamps out-of-range enum values to defaults (z.catch fallback)", () => {
    const result = parseUserPreferences({ responseStyle: "invalid-style" });
    expect(result.responseStyle).toBe("direto");
  });

  it("clamps out-of-range webSearchMode to default", () => {
    expect(parseUserPreferences({ webSearchMode: "always" }).webSearchMode).toBe("always");
    expect(parseUserPreferences({ webSearchMode: "off" }).webSearchMode).toBe("off");
    expect(parseUserPreferences({ webSearchMode: "invalid" }).webSearchMode).toBe("auto");
  });

  it("clamps memoryMode to default for invalid values", () => {
    expect(parseUserPreferences({ memoryMode: "manual" }).memoryMode).toBe("manual");
    expect(parseUserPreferences({ memoryMode: "auto" }).memoryMode).toBe("auto");
    expect(parseUserPreferences({ memoryMode: "wrong" }).memoryMode).toBe("auto");
  });

  it("coerces booleans from non-boolean types via z.catch fallback", () => {
    // O schema usa .default(true) que nao falha; testamos que strings nao-bool
    // caem no catch que devolve defaults completos.
    const result = parseUserPreferences({ whatsappBotEnabled: "yes" as never });
    expect(result.whatsappBotEnabled).toBe(true);
  });

  it("accepts nested personalProfile with partial values", () => {
    const result = parseUserPreferences({
      personalProfile: { name: "Alice", timezone: "America/Sao_Paulo" },
    });
    expect(result.personalProfile.name).toBe("Alice");
    expect(result.personalProfile.timezone).toBe("America/Sao_Paulo");
    // Defaults preservados
    expect(result.personalProfile.availableDays).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(result.personalProfile.startTime).toBe("08:00");
  });

  it("accepts nested telegramIntegration with partial values", () => {
    const result = parseUserPreferences({
      telegramIntegration: { chatId: "12345", userName: "joao" },
    });
    expect(result.telegramIntegration.chatId).toBe("12345");
    expect(result.telegramIntegration.userName).toBe("joao");
    expect(result.telegramIntegration.linkCode).toBe("");
    expect(result.telegramIntegration.linkedAt).toBe("");
  });

  it("accepts knowledgeCapture entries with arbitrary fields (passthrough)", () => {
    const result = parseUserPreferences({
      knowledgeCapture: {
        capture1: { agentId: "a1", chatId: "c1", expiresAt: "2030-01-01T00:00:00Z", extraField: "kept" },
      },
    });
    expect(result.knowledgeCapture.capture1).toMatchObject({
      agentId: "a1",
      chatId: "c1",
      expiresAt: "2030-01-01T00:00:00Z",
    });
    expect((result.knowledgeCapture.capture1 as Record<string, unknown>).extraField).toBe("kept");
  });

  it("accepts reminderCapture entries with arbitrary fields (passthrough)", () => {
    const result = parseUserPreferences({
      reminderCapture: {
        pending1: { chatId: "c1", expiresAt: "2030-01-01T00:00:00Z", reminderId: 42 },
      },
    });
    expect(result.reminderCapture.pending1.chatId).toBe("c1");
    expect((result.reminderCapture.pending1 as Record<string, unknown>).reminderId).toBe(42);
  });

  it("preserves personalProfile.availableDays as array", () => {
    const result = parseUserPreferences({
      personalProfile: { availableDays: ["sat", "sun"] },
    });
    expect(result.personalProfile.availableDays).toEqual(["sat", "sun"]);
  });

  it("rejects invalid availableDays values (falls back to default via z.catch)", () => {
    const result = parseUserPreferences({
      personalProfile: { availableDays: ["invalid-day"] as never },
    });
    // O top-level .catch faz com que valores invalidos em campos nested
    // caiam para o DEFAULT_USER_PREFERENCES inteiro.
    expect(result.personalProfile.availableDays).toEqual(["mon", "tue", "wed", "thu", "fri"]);
  });

  it("preserves personalAgentEnabled toggle", () => {
    expect(parseUserPreferences({ personalAgentEnabled: false }).personalAgentEnabled).toBe(false);
    expect(parseUserPreferences({ personalAgentEnabled: true }).personalAgentEnabled).toBe(true);
  });
});

describe("UserPreferencesSchema (strict parse, no catch)", () => {
  it("rejects invalid responseStyle", () => {
    const result = UserPreferencesSchema.safeParse({ responseStyle: "garbage" });
    expect(result.success).toBe(false);
  });

  it("accepts extra top-level keys (z.object default is passthrough, not strict)", () => {
    // z.object() sem .strict() aceita chaves extras silenciosamente. Documenta
    // o comportamento: callers que precisarem de estrito devem usar
    // UserPreferencesSchema.strict().parse() ou parseUserPreferences (que
    // filtra para o schema conhecido via z.catch fallback em erros).
    const result = UserPreferencesSchema.safeParse({ unknownKey: "x" });
    expect(result.success).toBe(true);
  });

  it("applies defaults on parse", () => {
    const parsed = UserPreferencesSchema.parse({});
    expect(parsed.responseStyle).toBe("direto");
    expect(parsed.personalProfile.timezone).toBe("America/Fortaleza");
  });
});