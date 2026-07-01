import { z } from "zod";

export const WebSearchMode = z.enum(["auto", "always", "off"]);
export const MemoryMode = z.enum(["auto", "manual", "off"]);
export const ResponseStyle = z.enum(["direto", "detalhado", "criativo", "tecnico", "executivo"]);
export const ResponseTone = z.enum(["profissional", "amigavel", "objetivo", "didatico"]);

export const UserPreferencesSchema = z.object({
  customInstructions: z.string().max(4000).default(""),
  aboutUser: z.string().max(2000).default(""),
  goals: z.string().max(2000).default(""),
  responseStyle: ResponseStyle.default("direto"),
  responseTone: ResponseTone.default("profissional"),
  preferredModel: z.string().max(160).default(""),
  activeAgentId: z.string().max(80).default(""),
  whatsappAgentId: z.string().max(80).default(""),
  knowledgeAgentId: z.string().max(80).default(""),
  telegramKnowledgeAgentId: z.string().max(80).default(""),
  whatsappKnowledgeAgentId: z.string().max(80).default(""),
  knowledgeCapture: z
    .record(
      z.string(),
      z
        .object({
          agentId: z.string().max(80).optional(),
          chatId: z.string().max(160).optional(),
          expiresAt: z.string().max(80).optional(),
        })
        .passthrough(),
    )
    .default({}),
  reminderCapture: z
    .record(
      z.string(),
      z
        .object({
          chatId: z.string().max(160).optional(),
          expiresAt: z.string().max(80).optional(),
        })
        .passthrough(),
    )
    .default({}),
  telegramIntegration: z
    .object({
      chatId: z.string().max(160).default(""),
      userName: z.string().max(160).default(""),
      linkedAt: z.string().max(80).default(""),
      linkCode: z.string().max(32).default(""),
      linkCodeExpiresAt: z.string().max(80).default(""),
    })
    .default({
      chatId: "",
      userName: "",
      linkedAt: "",
      linkCode: "",
      linkCodeExpiresAt: "",
    }),
  whatsappBotEnabled: z.boolean().default(true),
  personalAgentEnabled: z.boolean().default(true),
  personalProfile: z
    .object({
      name: z.string().max(120).default(""),
      profession: z.string().max(160).default(""),
      availableHours: z.string().max(120).default("8h as 18h"),
      availableDays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).default(["mon", "tue", "wed", "thu", "fri"]),
      startTime: z.string().max(5).default("08:00"),
      endTime: z.string().max(5).default("18:00"),
      timezone: z.string().max(80).default("America/Fortaleza"),
      outOfHoursMessage: z.string().max(500).default("Oi! Estou ocupado agora, mas retorno assim que puder."),
    })
    .default({
      name: "",
      profession: "",
      availableHours: "8h as 18h",
      availableDays: ["mon", "tue", "wed", "thu", "fri"],
      startTime: "08:00",
      endTime: "18:00",
      timezone: "America/Fortaleza",
      outOfHoursMessage: "Oi! Estou ocupado agora, mas retorno assim que puder.",
    }),
  personalVipContacts: z.string().max(2000).default(""),
  personalUrgentTopics: z.string().max(2000).default(""),
  webSearchMode: WebSearchMode.default("auto"),
  memoryMode: MemoryMode.default("auto"),
  showModelDetails: z.boolean().default(true),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const DEFAULT_USER_PREFERENCES: UserPreferences = UserPreferencesSchema.parse({});

export function parseUserPreferences(value: unknown): UserPreferences {
  return UserPreferencesSchema.catch(DEFAULT_USER_PREFERENCES).parse(value);
}
