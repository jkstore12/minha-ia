"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BellRing, Bot, BrainCircuit, CheckCircle2, ClipboardCheck, Copy, Edit3, ExternalLink, Loader2, MessageCircle, Play, Plus, Power, Radio, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { DOMAIN_OPTIONS, TOOL_OPTIONS, CONNECTOR_PRESETS } from "@/lib/orchestrator/defaults";
import { AGENT_TEMPLATES, type AgentTemplate } from "@/lib/orchestrator/agent-templates";
import { MODEL_PRESETS } from "@/lib/ai/model-presets";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@/lib/user-preferences";
import { apiRequest } from "@/lib/api/client";
import { GhostButton, PageTitle, PrimaryButton, Select, TextArea, TextInput } from "@/components/platform/form-controls";

type ApiState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
};

type Row = Record<string, unknown>;

type TelegramLinkStatus = {
  linked: boolean;
  chatId: string;
  userName: string;
  linkedAt: string;
  linkCode: string;
  linkCodeExpiresAt: string;
};

function useInitialLoad(load: () => Promise<void>) {
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRef.current();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
}

const AVAILABLE_DAY_OPTIONS = [
  { id: "mon", label: "Seg" },
  { id: "tue", label: "Ter" },
  { id: "wed", label: "Qua" },
  { id: "thu", label: "Qui" },
  { id: "fri", label: "Sex" },
  { id: "sat", label: "Sáb" },
  { id: "sun", label: "Dom" },
] as const;

const DEFAULT_OUT_OF_HOURS_MESSAGE = "Oi! Estou ocupado agora, mas retorno assim que puder.";

export function AgentsPageClient() {
  type AvailableDay = UserPreferences["personalProfile"]["availableDays"][number];
  type AgentSchedule = {
    enabled: boolean;
    availableDays: AvailableDay[];
    startTime: string;
    endTime: string;
    timezone: string;
    outOfHoursMessage: string;
  };
  type AgentForm = {
    id?: string;
    name: string;
    domain: string;
    model: string;
    description: string;
    system_prompt: string;
    tools: string[];
    temperature: number;
    max_tokens: number;
    is_active: boolean;
    is_orchestrator: boolean;
    is_fallback: boolean;
    metadata: Record<string, unknown>;
    schedule: AgentSchedule;
  };
  type WhatsAppStatus = {
    whatsappBotEnabled: boolean;
    mode: "agent" | "manual";
    instance: string;
    qrcodeUrl: string;
    connection?: {
      configured?: boolean;
      state?: string;
      ok?: boolean;
      error?: string;
    };
  };
  type OperationMessage = {
    id: string;
    contact_name?: string | null;
    contact_number?: string | null;
    content?: string | null;
    classification?: string | null;
    response_text?: string | null;
    owner_notified?: boolean | null;
    notification_reason?: string | null;
    created_at: string;
  };
  type ActiveOperationAgent = {
    id: string;
    name: string;
    domain: string;
    model: string;
    source: string;
  };
  type OperationsState = {
    preferences?: UserPreferences;
    activeWhatsappAgent: ActiveOperationAgent;
    status: WhatsAppStatus;
    env: {
      evolutionConfigured: boolean;
      aiConfigured: boolean;
      serviceRoleConfigured: boolean;
      telegramOwnerConfigured: boolean;
      personalOwnerNumberConfigured: boolean;
      whatsappOwnerUserIdConfigured?: boolean;
      usingWhatsAppOwnerProfile?: boolean;
    };
    checklist: Array<{ id: string; label: string; ok: boolean }>;
    recentMessages: OperationMessage[];
    urgentMessages: OperationMessage[];
  };
  type SimulationScenario = "normal" | "vip" | "urgent" | "outside_hours";
  type SimulationResult = {
    agent: ActiveOperationAgent;
    scenario: SimulationScenario;
    classification: {
      classification: string;
      withinHours: boolean;
      isVip: boolean;
      isSpam: boolean;
      restricted: boolean;
      notifyOwner: boolean;
      urgencyScore: number;
      reason: string;
    };
    responsePreview: string;
    generatedByModel: boolean;
    willNotifyOwner: boolean;
    willSendMessage: boolean;
  };
  type KnowledgeItem = {
    id: string;
    agent_id: string;
    title: string;
    kind: string;
    content: string;
    tags?: string[] | null;
    source_url?: string | null;
    priority: number;
    is_active: boolean;
    metadata?: Record<string, unknown> | null;
    updated_at?: string;
  };
  type KnowledgeForm = {
    title: string;
    kind: string;
    content: string;
    tags: string;
    source_url: string;
    priority: number;
    is_active: boolean;
  };

  const emptyForm: AgentForm = {
    name: "",
    domain: "custom",
    model: "",
    description: "",
    system_prompt: "",
    tools: [],
    temperature: 0.4,
    max_tokens: 4096,
    is_active: true,
    is_orchestrator: false,
    is_fallback: false,
    metadata: {},
    schedule: {
      enabled: false,
      availableDays: ["mon", "tue", "wed", "thu", "fri"],
      startTime: "08:00",
      endTime: "18:00",
      timezone: "America/Fortaleza",
      outOfHoursMessage: DEFAULT_OUT_OF_HOURS_MESSAGE,
    },
  };
  const emptyKnowledgeForm: KnowledgeForm = {
    title: "",
    kind: "product",
    content: "",
    tags: "",
    source_url: "",
    priority: 3,
    is_active: true,
  };

  const [state, setState] = useState<ApiState<Row[]>>({ data: [], loading: true, error: null });
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppStatus | null>(null);
  const [operations, setOperations] = useState<OperationsState | null>(null);
  const [tab, setTab] = useState<"active" | "agents" | "create" | "knowledge" | "settings">("active");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<AgentForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [simulation, setSimulation] = useState<{ message: string; scenario: SimulationScenario }>({ message: "Oi, você pode falar agora?", scenario: "normal" });
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [testingAgent, setTestingAgent] = useState(false);
  const [knowledgeAgentId, setKnowledgeAgentId] = useState("");
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [knowledgeForm, setKnowledgeForm] = useState<KnowledgeForm>(emptyKnowledgeForm);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const editorRef = useRef<HTMLFormElement | null>(null);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);

  const load = async () => {
    setState((current) => ({ ...current, loading: true }));
    try {
      const [agentsPayload, settingsPayload, operationsPayload] = await Promise.all([
        apiRequest<{ agents: Row[] }>("/api/agents"),
        apiRequest<{ preferences: UserPreferences }>("/api/settings"),
        apiRequest<OperationsState>("/api/whatsapp/operations").catch(() => null),
      ]);
      setPreferences(operationsPayload?.preferences || settingsPayload.preferences || DEFAULT_USER_PREFERENCES);
      setState({ data: agentsPayload.agents, loading: false, error: null });
      const nextKnowledgeAgentId =
        knowledgeAgentId ||
        settingsPayload.preferences?.telegramKnowledgeAgentId ||
        settingsPayload.preferences?.whatsappKnowledgeAgentId ||
        settingsPayload.preferences?.knowledgeAgentId ||
        settingsPayload.preferences?.whatsappAgentId ||
        settingsPayload.preferences?.activeAgentId ||
        String(agentsPayload.agents[0]?.id || "");
      if (!knowledgeAgentId && nextKnowledgeAgentId) {
        setKnowledgeAgentId(nextKnowledgeAgentId);
        void loadKnowledge(nextKnowledgeAgentId);
      }
      if (operationsPayload) {
        setOperations(operationsPayload);
        setWhatsappStatus(operationsPayload.status);
      } else {
        apiRequest<WhatsAppStatus>("/api/whatsapp/status")
          .then(setWhatsappStatus)
          .catch(() => setWhatsappStatus(null));
      }
    } catch (error) {
      setState({ data: [], loading: false, error: error instanceof Error ? error.message : "Erro." });
    }
  };

  useInitialLoad(load);

  useEffect(() => {
    if (tab !== "create" || !editorFocusRequest) return;
    const scrollToEditor = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const top = editor.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    };
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToEditor));
    const timerA = window.setTimeout(scrollToEditor, 250);
    const timerB = window.setTimeout(scrollToEditor, 700);
    const timerC = window.setTimeout(scrollToEditor, 1100);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timerA);
      window.clearTimeout(timerB);
      window.clearTimeout(timerC);
    };
  }, [editorFocusRequest, form.id, tab]);

  function normalizeAgentSchedule(value: unknown): AgentSchedule {
    const schedule = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const dayIds = AVAILABLE_DAY_OPTIONS.map((day) => day.id);
    const rawDays = Array.isArray(schedule.availableDays) ? schedule.availableDays.map(String) : [];
    const availableDays = rawDays.filter((day): day is AvailableDay => dayIds.includes(day as AvailableDay));
    return {
      enabled: Boolean(schedule.enabled),
      availableDays: availableDays.length ? availableDays : ["mon", "tue", "wed", "thu", "fri"],
      startTime: String(schedule.startTime || "08:00"),
      endTime: String(schedule.endTime || "18:00"),
      timezone: String(schedule.timezone || "America/Fortaleza"),
      outOfHoursMessage: String(schedule.outOfHoursMessage || DEFAULT_OUT_OF_HOURS_MESSAGE),
    };
  }

  function metadataFromRow(agent: Row) {
    return agent.metadata && typeof agent.metadata === "object" && !Array.isArray(agent.metadata)
      ? agent.metadata as Record<string, unknown>
      : {};
  }

  function toForm(agent: Row): AgentForm {
    const metadata = metadataFromRow(agent);
    return {
      id: String(agent.id || ""),
      name: String(agent.name || ""),
      domain: String(agent.domain || "custom"),
      model: String(agent.model || ""),
      description: String(agent.description || ""),
      system_prompt: String(agent.system_prompt || ""),
      tools: Array.isArray(agent.tools) ? agent.tools.map(String) : [],
      temperature: Number(agent.temperature ?? 0.4),
      max_tokens: Number(agent.max_tokens ?? 4096),
      is_active: Boolean(agent.is_active),
      is_orchestrator: Boolean(agent.is_orchestrator),
      is_fallback: Boolean(agent.is_fallback),
      metadata,
      schedule: normalizeAgentSchedule(metadata.schedule),
    };
  }

  function payloadFromForm(value: AgentForm) {
    const metadata = {
      ...value.metadata,
      schedule: {
        enabled: value.schedule.enabled,
        availableDays: value.schedule.availableDays,
        startTime: value.schedule.startTime || "08:00",
        endTime: value.schedule.endTime || "18:00",
        timezone: value.schedule.timezone || "America/Fortaleza",
        outOfHoursMessage: value.schedule.outOfHoursMessage || DEFAULT_OUT_OF_HOURS_MESSAGE,
      },
    };
    return {
      name: value.name,
      domain: value.domain,
      model: value.model || null,
      description: value.description || null,
      system_prompt: value.system_prompt || null,
      tools: value.tools,
      temperature: value.temperature,
      max_tokens: value.max_tokens,
      is_active: value.is_active,
      is_orchestrator: value.is_orchestrator,
      is_fallback: value.is_fallback,
      metadata,
    };
  }

  function normalizeAgentName(value: unknown) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  async function saveSettings(next: Partial<UserPreferences>, success: string) {
    setSaving(true);
    try {
      const payload = await apiRequest<{ preferences: UserPreferences }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ preferences: next }),
      });
      setPreferences(payload.preferences);
      setNotice(success);
      await refreshOperations().catch(() => null);
    } finally {
      setSaving(false);
    }
  }

  async function saveWhatsAppSettings(next: Partial<UserPreferences>, success: string) {
    setSaving(true);
    try {
      const payload = await apiRequest<{ preferences: UserPreferences }>("/api/whatsapp/preferences", {
        method: "PATCH",
        body: JSON.stringify({ preferences: next }),
      });
      setPreferences(payload.preferences);
      setNotice(success);
      await refreshOperations().catch(() => null);
    } finally {
      setSaving(false);
    }
  }

  async function refreshOperations() {
    const payload = await apiRequest<OperationsState>("/api/whatsapp/operations");
    setOperations(payload);
    setWhatsappStatus(payload.status);
    return payload;
  }

  async function loadKnowledge(agentId: string) {
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    try {
      const payload = await apiRequest<{ knowledge: KnowledgeItem[] }>(`/api/agents/${agentId}/knowledge`);
      setKnowledgeItems(payload.knowledge || []);
    } catch (error) {
      setKnowledgeItems([]);
      setKnowledgeError(error instanceof Error ? error.message : "Não foi possível carregar a base de conhecimento.");
    } finally {
      setKnowledgeLoading(false);
    }
  }

  function parseKnowledgeTags(value: string) {
    return value
      .split(/[\n,;]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  async function saveKnowledge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!knowledgeAgentId) {
      setKnowledgeError("Escolha um agente para salvar conhecimento.");
      return;
    }
    setSavingKnowledge(true);
    setKnowledgeError(null);
    try {
      await apiRequest(`/api/agents/${knowledgeAgentId}/knowledge`, {
        method: "POST",
        body: JSON.stringify({
          ...knowledgeForm,
          tags: parseKnowledgeTags(knowledgeForm.tags),
          source_url: knowledgeForm.source_url || null,
        }),
      });
      setKnowledgeForm(emptyKnowledgeForm);
      setNotice("Conhecimento salvo para este agente.");
      await loadKnowledge(knowledgeAgentId);
    } catch (error) {
      setKnowledgeError(error instanceof Error ? error.message : "Não foi possível salvar o conhecimento.");
    } finally {
      setSavingKnowledge(false);
    }
  }

  async function toggleKnowledge(item: KnowledgeItem) {
    await apiRequest(`/api/agents/${knowledgeAgentId}/knowledge/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        is_active: !item.is_active,
        metadata: { ...(item.metadata || {}), status: !item.is_active ? "approved" : "paused" },
      }),
    });
    await loadKnowledge(knowledgeAgentId);
  }

  async function approveKnowledge(item: KnowledgeItem) {
    await apiRequest(`/api/agents/${knowledgeAgentId}/knowledge/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: true, metadata: { ...(item.metadata || {}), status: "approved", reviewed_at: new Date().toISOString() } }),
    });
    setNotice("Rascunho aprovado e liberado para a IA usar.");
    await loadKnowledge(knowledgeAgentId);
  }

  async function discardKnowledge(item: KnowledgeItem) {
    await apiRequest(`/api/agents/${knowledgeAgentId}/knowledge/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: false, metadata: { ...(item.metadata || {}), status: "discarded", reviewed_at: new Date().toISOString() } }),
    });
    setNotice("Rascunho descartado.");
    await loadKnowledge(knowledgeAgentId);
  }

  async function removeKnowledge(item: KnowledgeItem) {
    await apiRequest(`/api/agents/${knowledgeAgentId}/knowledge/${item.id}`, { method: "DELETE" });
    await loadKnowledge(knowledgeAgentId);
  }

  async function setWhatsAppBotEnabled(enabled: boolean) {
    setSaving(true);
    try {
      const payload = await apiRequest<WhatsAppStatus & { preferences?: UserPreferences }>("/api/whatsapp/status", {
        method: "PATCH",
        body: JSON.stringify({ whatsappBotEnabled: enabled }),
      });
      setWhatsappStatus(payload);
      if (payload.preferences) setPreferences(payload.preferences);
      setNotice(enabled ? "Agente do WhatsApp ativado." : "Agente do WhatsApp pausado. Agora você pode usar o WhatsApp manualmente.");
      void refreshOperations();
    } finally {
      setSaving(false);
    }
  }

  async function savePersonalAgentSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveWhatsAppSettings(
      {
        personalAgentEnabled: preferences.personalAgentEnabled,
        personalProfile: preferences.personalProfile,
        personalVipContacts: preferences.personalVipContacts,
        personalUrgentTopics: preferences.personalUrgentTopics,
      },
      "Configuração do agente pessoal salva.",
    );
  }

  async function saveAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      if (form.id) {
        await apiRequest(`/api/agents/${form.id}`, { method: "PATCH", body: JSON.stringify(payloadFromForm(form)) });
        setNotice("Agente atualizado.");
      } else {
        const payload = await apiRequest<{ agent: Row }>("/api/agents", { method: "POST", body: JSON.stringify(payloadFromForm(form)) });
        setForm(toForm(payload.agent));
        setNotice("Agente criado.");
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  function findTemplateAgent(template: AgentTemplate) {
    return state.data.find((agent) => {
      const sameName = normalizeAgentName(agent.name) === normalizeAgentName(template.name);
      const sameDomain = String(agent.domain || "") === template.domain;
      return sameName && sameDomain;
    });
  }

  async function createFromTemplate(template: AgentTemplate) {
    const existing = findTemplateAgent(template);
    if (existing) {
      openAgentEditor(existing);
      setNotice("Esse modelo pronto já existe. Abri o agente existente para você editar sem duplicar.");
      return existing;
    }

    setSaving(true);
    try {
      const payload = await apiRequest<{ agent: Row }>("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          name: template.name,
          description: template.description,
          domain: template.domain,
          model: template.model || null,
          temperature: template.temperature,
          max_tokens: template.max_tokens,
          system_prompt: template.system_prompt,
          tools: template.tools,
          is_active: true,
          is_orchestrator: template.domain === "orchestrator",
          is_fallback: false,
          metadata: { schedule: emptyForm.schedule, templateId: template.id },
        }),
      });
      openAgentEditor(payload.agent);
      setNotice("Template criado como agente editável.");
      await load();
      return payload.agent;
    } finally {
      setSaving(false);
    }
  }

  async function assignTemplateToWhatsApp(template: AgentTemplate) {
    const existing = findTemplateAgent(template);
    const agent = existing || await createFromTemplate(template);
    if (!agent) return;

    await saveWhatsAppSettings(
      {
        whatsappAgentId: String(agent.id),
        personalAgentEnabled: template.id === "pessoal",
      },
      template.id === "pessoal"
        ? "Agente pessoal ligado para responder no WhatsApp."
        : "Agente definido para responder no WhatsApp.",
    );
    setTab("active");
  }

  async function setKnowledgeDestination(channel: "telegram" | "whatsapp" | "legacy", id: string, message = "Destino de cadastro atualizado.") {
    const next: Partial<UserPreferences> =
      channel === "telegram"
        ? { telegramKnowledgeAgentId: id, knowledgeAgentId: id }
        : channel === "whatsapp"
          ? { whatsappKnowledgeAgentId: id }
          : { knowledgeAgentId: id };
    if (channel === "whatsapp" || channel === "telegram") {
      await saveWhatsAppSettings(next, message);
    } else {
      await saveSettings(next, message);
    }
    setKnowledgeAgentId(id);
    if (id) void loadKnowledge(id);
  }

  function prepareTemplateTest(template: AgentTemplate) {
    setSimulation({
      scenario: template.id.includes("farmácia") ? "urgent" : "normal",
      message: template.id.includes("farmácia")
        ? "Tenho dor no peito e quero saber qual remédio tomar agora."
        : "Oi, você pode me responder quando tiver um minuto?",
    });
    setSimulationResult(null);
    setTab("active");
    setNotice("Teste preparado. Clique em Simular sem enviar para ver o comportamento antes de ativar.");
  }

  async function toggle(id: string, is_active: boolean) {
    await apiRequest(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify({ is_active: !is_active, status: !is_active ? "idle" : "disabled" }) });
    await load();
  }

  async function remove(id: string) {
    await apiRequest(`/api/agents/${id}`, { method: "DELETE" });
    const nextPreferences: Partial<UserPreferences> = {};
    if (preferences.activeAgentId === id) nextPreferences.activeAgentId = "";
    if (preferences.whatsappAgentId === id) nextPreferences.whatsappAgentId = "";
    if (preferences.knowledgeAgentId === id) nextPreferences.knowledgeAgentId = "";
    if (preferences.telegramKnowledgeAgentId === id) nextPreferences.telegramKnowledgeAgentId = "";
    if (preferences.whatsappKnowledgeAgentId === id) nextPreferences.whatsappKnowledgeAgentId = "";
    if (Object.keys(nextPreferences).length) {
      await apiRequest("/api/settings", { method: "PATCH", body: JSON.stringify({ preferences: nextPreferences }) });
    }
    await load();
  }

  async function duplicate(agent: Row) {
    const source = toForm(agent);
    setSaving(true);
    try {
      await apiRequest("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          ...payloadFromForm(source),
          name: `${source.name} cópia`.slice(0, 80),
          is_active: true,
        }),
      });
      setNotice("Agente duplicado.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function runSimulation(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setTestingAgent(true);
    setSimulationResult(null);
    try {
      const payload = await apiRequest<SimulationResult>("/api/whatsapp/operations", {
        method: "POST",
        body: JSON.stringify(simulation),
      });
      setSimulationResult(payload);
      setNotice("Simulação concluída. Nenhuma mensagem real foi enviada.");
    } finally {
      setTestingAgent(false);
    }
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    setNotice("Texto copiado.");
  }

  function formatMessageDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function classificationLabel(value?: string | null) {
    const labels: Record<string, string> = {
      normal: "Normal",
      urgent: "Urgente",
      vip: "VIP",
      restricted: "Restrito",
      spam: "Spam",
      ignored: "Ignorado",
    };
    return labels[String(value || "normal")] || String(value || "Normal");
  }

  function classificationClass(value?: string | null) {
    const key = String(value || "normal");
    if (key === "urgent" || key === "restricted") return "bg-rose-50 text-rose-700";
    if (key === "vip") return "bg-amber-50 text-amber-700";
    if (key === "spam" || key === "ignored") return "bg-zinc-100 text-zinc-600";
    return "bg-emerald-50 text-emerald-700";
  }

  const filteredAgents = state.data.filter((agent) => {
    const text = `${String(agent.name || "")} ${String(agent.description || "")} ${String(agent.domain || "")}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  const activeChatAgent = state.data.find((agent) => String(agent.id) === preferences.activeAgentId);
  const activeWhatsappAgent = state.data.find((agent) => String(agent.id) === preferences.whatsappAgentId);
  const activeLegacyKnowledgeAgent = state.data.find((agent) => String(agent.id) === preferences.knowledgeAgentId);
  const activeTelegramKnowledgeAgent = state.data.find((agent) => String(agent.id) === (preferences.telegramKnowledgeAgentId || preferences.knowledgeAgentId));
  const activeWhatsappKnowledgeAgent = state.data.find((agent) => String(agent.id) === (preferences.whatsappKnowledgeAgentId || preferences.whatsappAgentId || preferences.knowledgeAgentId));
  const knowledgeDestinationAgent = activeTelegramKnowledgeAgent || activeWhatsappKnowledgeAgent || activeLegacyKnowledgeAgent || activeWhatsappAgent || activeChatAgent;
  const telegramKnowledgeSource = activeTelegramKnowledgeAgent
    ? "Destino do Telegram"
    : activeWhatsappAgent
      ? "Fallback: WhatsApp"
      : activeChatAgent
        ? "Fallback: chat"
        : "Não configurado";
  const whatsappKnowledgeSource = activeWhatsappKnowledgeAgent
    ? "Destino do WhatsApp"
    : activeWhatsappAgent
      ? "Fallback: WhatsApp"
      : "Não configurado";
  const channelAgents = state.data.filter((agent, index, agents) => {
    const id = String(agent.id);
    if (
      id === preferences.activeAgentId ||
      id === preferences.whatsappAgentId ||
      id === preferences.knowledgeAgentId ||
      id === preferences.telegramKnowledgeAgentId ||
      id === preferences.whatsappKnowledgeAgentId
    ) return true;
    const key = `${String(agent.name || "").trim().toLowerCase()}|${String(agent.domain || "")}|${String(agent.model || "")}`;
    return agents.findIndex((item) => `${String(item.name || "").trim().toLowerCase()}|${String(item.domain || "")}|${String(item.model || "")}` === key) === index;
  });
  const operationAgent = operations?.activeWhatsappAgent || {
    id: "",
    name: preferences.personalAgentEnabled ? "Agente pessoal do WhatsApp" : activeWhatsappAgent ? String(activeWhatsappAgent.name) : "Sem agente ativo",
    domain: preferences.personalAgentEnabled ? "personal" : activeWhatsappAgent ? String(activeWhatsappAgent.domain || "custom") : "fallback",
    model: preferences.personalAgentEnabled ? "~anthropic/claude-sonnet-latest" : activeWhatsappAgent ? String(activeWhatsappAgent.model || "modelo padrão") : "modelo padrão",
    source: preferences.personalAgentEnabled ? "personal" : activeWhatsappAgent ? "agent" : "fallback",
  };
  const whatsappBotEnabled = whatsappStatus?.whatsappBotEnabled ?? preferences.whatsappBotEnabled;
  const whatsappResponderName = whatsappBotEnabled ? operationAgent.name : "Nenhum agente respondendo";
  const whatsappResponderStatus = !whatsappBotEnabled
    ? "Modo manual: o webhook recebe mensagens, mas não responde."
    : operationAgent.source === "personal"
      ? "Agente pessoal ativo: ele responde seu WhatsApp agora."
      : operationAgent.source === "agent"
        ? "Agente selecionado ativo: este é o perfil usado nas respostas do WhatsApp."
        : "Sem agente ativo: o WhatsApp responde apenas com o comportamento padrão do sistema.";
  const whatsappResponderBadge = !whatsappBotEnabled
    ? "BOT PAUSADO"
    : operationAgent.source === "personal"
      ? "RESPONDENDO AGORA"
      : operationAgent.source === "agent"
        ? "AGENTE ATIVO"
        : "SEM AGENTE FIXO";
  const whatsappResponderClass = !whatsappBotEnabled
    ? "border-amber-300 bg-amber-50 text-amber-900"
    : operationAgent.source === "fallback"
      ? "border-sky-200 bg-sky-50 text-sky-950"
      : "border-emerald-300 bg-emerald-50 text-emerald-950";
  const whatsappResponderBadgeClass = !whatsappBotEnabled
    ? "bg-amber-600 text-white"
    : operationAgent.source === "fallback"
      ? "bg-sky-600 text-white"
      : "bg-emerald-600 text-white";
  const recentMessages = operations?.recentMessages || [];
  const filteredMessages = recentMessages.filter((message) => historyFilter === "all" || String(message.classification || "normal") === historyFilter);
  const tabs = [
    ["active", "Agente ativo", "Quem responde agora em cada canal", Radio],
    ["agents", "Meus agentes", "Lista, busca e ações rápidas", Bot],
    ["create", "Criar agente", "Modelos prontos e editor", Plus],
    ["knowledge", "Conhecimento", "Produtos, preços, regras e FAQs", BrainCircuit],
    ["settings", "Configurações", "WhatsApp, chat, horários e destinos", MessageCircle],
  ] as const;

  function focusAgentEditor() {
    setEditorFocusRequest((current) => current + 1);
  }

  function openNewAgent() {
    setForm(emptyForm);
    setTab("create");
    focusAgentEditor();
  }

  function openAgentEditor(agent: Row) {
    setForm(toForm(agent));
    setTab("create");
    focusAgentEditor();
  }

  function updateAgentSchedule(next: Partial<AgentSchedule>) {
    setForm((current) => ({
      ...current,
      schedule: {
        ...current.schedule,
        ...next,
      },
    }));
  }

  function toggleAgentAvailableDay(day: string) {
    const currentDays = form.schedule.availableDays?.length
      ? form.schedule.availableDays.map(String)
      : ["mon", "tue", "wed", "thu", "fri"];
    const nextDays = currentDays.includes(day)
      ? currentDays.filter((item) => item !== day)
      : [...currentDays, day];
    const safeDays = nextDays.length ? nextDays : currentDays;
    updateAgentSchedule({ availableDays: safeDays as AvailableDay[] });
  }

  function agentScheduleSummary(schedule = form.schedule) {
    if (!schedule.enabled) return "Sem restrição de horário";
    const days = schedule.availableDays?.length ? schedule.availableDays.map(String) : ["mon", "tue", "wed", "thu", "fri"];
    const labels = AVAILABLE_DAY_OPTIONS.filter((day) => days.includes(day.id)).map((day) => day.label).join(", ");
    return `${labels || "Dias não definidos"} das ${schedule.startTime || "08:00"} às ${schedule.endTime || "18:00"} (${schedule.timezone || "America/Fortaleza"})`;
  }

  function updatePersonalProfile(next: Partial<UserPreferences["personalProfile"]>) {
    setPreferences((current) => {
      const profile = {
        ...current.personalProfile,
        ...next,
      };
      const startTime = profile.startTime || "08:00";
      const endTime = profile.endTime || "18:00";
      return {
        ...current,
        personalProfile: {
          ...profile,
          availableHours: `${startTime} às ${endTime}`,
          outOfHoursMessage: profile.outOfHoursMessage || DEFAULT_OUT_OF_HOURS_MESSAGE,
        },
      };
    });
  }

  function toggleAvailableDay(day: string) {
    const currentDays = preferences.personalProfile.availableDays?.length
      ? preferences.personalProfile.availableDays.map(String)
      : ["mon", "tue", "wed", "thu", "fri"];
    const nextDays = currentDays.includes(day)
      ? currentDays.filter((item) => item !== day)
      : [...currentDays, day];
    updatePersonalProfile({ availableDays: (nextDays.length ? nextDays : currentDays) as AvailableDay[] });
  }

  function scheduleSummary() {
    const days = preferences.personalProfile.availableDays?.length
      ? preferences.personalProfile.availableDays.map(String)
      : ["mon", "tue", "wed", "thu", "fri"];
    const labels = AVAILABLE_DAY_OPTIONS.filter((day) => days.includes(day.id)).map((day) => day.label).join(", ");
    return `${labels || "Dias não definidos"} das ${preferences.personalProfile.startTime || "08:00"} às ${preferences.personalProfile.endTime || "18:00"} (${preferences.personalProfile.timezone || "America/Fortaleza"})`;
  }

  async function resetChatAgent() {
    await saveSettings({ activeAgentId: "" }, "Chat sem agente fixo. Ele usará o modelo/preferência padrão.");
  }

  async function resetWhatsAppAgent() {
    await saveWhatsAppSettings(
      { whatsappAgentId: "", personalAgentEnabled: false },
      "WhatsApp sem agente ativo selecionado. O webhook usará o fallback padrão.",
    );
  }

  async function resetAllActiveAgents() {
    setSaving(true);
    try {
      const [settingsPayload, whatsappPayload] = await Promise.all([
        apiRequest<{ preferences: UserPreferences }>("/api/settings", {
          method: "PATCH",
          body: JSON.stringify({ preferences: { activeAgentId: "" } }),
        }),
        apiRequest<{ preferences: UserPreferences }>("/api/whatsapp/preferences", {
          method: "PATCH",
          body: JSON.stringify({ preferences: { whatsappAgentId: "", personalAgentEnabled: false } }),
        }),
      ]);
      setPreferences({ ...settingsPayload.preferences, ...whatsappPayload.preferences });
      setNotice("Agentes ativos resetados. Chat e WhatsApp ficaram sem agente fixo.");
      await refreshOperations();
      await load();
    } finally {
      setSaving(false);
    }
  }

  function AgentBadge({ agent }: { agent: Row }) {
    const id = String(agent.id);
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {id === preferences.activeAgentId ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Ativo no chat</span> : null}
        {id === preferences.whatsappAgentId ? (
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${preferences.personalAgentEnabled ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700"}`}>
            {!whatsappBotEnabled ? "WhatsApp pausado" : preferences.personalAgentEnabled ? "Fallback do WhatsApp" : "Ativo no WhatsApp"}
          </span>
        ) : null}
        {id === (preferences.telegramKnowledgeAgentId || preferences.knowledgeAgentId) ? <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">Cadastro Telegram</span> : null}
        {id === (preferences.whatsappKnowledgeAgentId || preferences.whatsappAgentId || preferences.knowledgeAgentId) ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Cadastro WhatsApp</span> : null}
        {agent.is_active ? <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">Ligado</span> : <span className="rounded-full bg-rose-50 px-2 py-1 text-xs text-rose-700">Desativado</span>}
      </div>
    );
  }

  function AgentActions({ agent }: { agent: Row }) {
    const id = String(agent.id);
    return (
      <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
        <GhostButton className="w-full sm:w-auto" onClick={() => saveSettings({ activeAgentId: id }, "Agente definido para o chat.")} disabled={saving || preferences.activeAgentId === id}>
          <CheckCircle2 className="h-4 w-4" /> Usar no chat
        </GhostButton>
        <GhostButton className="w-full sm:w-auto" onClick={() => saveWhatsAppSettings({ whatsappAgentId: id, personalAgentEnabled: false }, "Agente definido para o WhatsApp.")} disabled={saving || (!preferences.personalAgentEnabled && preferences.whatsappAgentId === id)}>
          <MessageCircle className="h-4 w-4" /> Usar no WhatsApp
        </GhostButton>
        <GhostButton className="w-full sm:w-auto" onClick={() => setKnowledgeDestination("telegram", id, "Agente definido como destino de cadastro do Telegram.")} disabled={saving || (preferences.telegramKnowledgeAgentId || preferences.knowledgeAgentId) === id}>
          <BrainCircuit className="h-4 w-4" /> Cadastros Telegram
        </GhostButton>
        <GhostButton className="w-full sm:w-auto" onClick={() => setKnowledgeDestination("whatsapp", id, "Agente definido como destino de cadastro do WhatsApp.")} disabled={saving || (preferences.whatsappKnowledgeAgentId || preferences.whatsappAgentId || preferences.knowledgeAgentId) === id}>
          <BrainCircuit className="h-4 w-4" /> Cadastros WhatsApp
        </GhostButton>
        <GhostButton className="w-full sm:w-auto" onClick={() => openAgentEditor(agent)}>
          <Edit3 className="h-4 w-4" /> Editar
        </GhostButton>
        <GhostButton className="w-full sm:w-auto" onClick={() => { setKnowledgeAgentId(id); void loadKnowledge(id); setTab("knowledge"); }}>
          <BrainCircuit className="h-4 w-4" /> Base
        </GhostButton>
        <GhostButton className="w-full sm:w-auto" onClick={() => duplicate(agent)} disabled={saving}>
          <Copy className="h-4 w-4" /> Duplicar
        </GhostButton>
        <GhostButton className="w-full sm:w-auto" onClick={() => toggle(id, Boolean(agent.is_active))}>
          <Power className="h-4 w-4" /> {agent.is_active ? "Desativar" : "Ativar"}
        </GhostButton>
        <GhostButton className="w-full sm:w-auto" onClick={() => remove(id)}><Trash2 className="h-4 w-4" /></GhostButton>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <PageTitle eyebrow="Agentes" title="Central profissional de agentes" description="Controle qual agente responde, qual agente recebe cadastros e qual base de conhecimento cada canal usa." />

      <div className="-mx-1 mt-5 flex gap-2 overflow-x-auto px-1 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-5">
        {tabs.map(([id, label, description, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-w-[168px] rounded-xl border p-3 text-left transition duration-200 sm:min-w-0 ${tab === id ? "border-zinc-950 bg-zinc-950 text-white shadow-sm" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"}`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Icon className="h-4 w-4 shrink-0" /> {label}
            </span>
            <span className={`mt-1 block text-xs leading-5 ${tab === id ? "text-zinc-300" : "text-zinc-500"}`}>{description}</span>
          </button>
        ))}
      </div>

      {tab === "create" && form.id ? (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
          Editando agente existente. Salve as alterações ou volte para <button type="button" onClick={() => setTab("agents")} className="font-semibold text-zinc-950 underline-offset-4 hover:underline">Meus agentes</button>.
        </div>
      ) : null}

      {notice ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
      {state.error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{state.error}</div> : null}

      {tab === "active" ? (
        <div className="mt-6 grid gap-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-600">Operação atual</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950">Quem está trabalhando agora</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-500">Selecione, pause ou zere os agentes por canal sem sair desta tela.</p>
              </div>
              <GhostButton type="button" disabled={state.loading} onClick={() => void refreshOperations()}>
                <RefreshCw className="h-4 w-4" /> Atualizar
              </GhostButton>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <section className={`min-w-0 rounded-xl border p-4 ${whatsappResponderClass}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold tracking-[0.12em] ${whatsappResponderBadgeClass}`}>{whatsappResponderBadge}</span>
                  <span className="rounded-full bg-white/75 px-2.5 py-1 text-xs font-semibold">WhatsApp</span>
                  <span className="rounded-full bg-white/75 px-2.5 py-1 text-xs font-semibold">{whatsappStatus?.connection?.state || "consultando"}</span>
                </div>
                <h3 className="mt-4 break-words text-2xl font-semibold tracking-tight">{whatsappResponderName}</h3>
                <p className="mt-2 text-sm leading-6 opacity-80">{whatsappResponderStatus}</p>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <span className="rounded-lg bg-white/75 px-3 py-2 font-semibold">Modelo: {operationAgent.model || "modelo padrão"}</span>
                  <span className="rounded-lg bg-white/75 px-3 py-2 font-semibold">Instância: {whatsappStatus?.instance || "minha-ia"}</span>
                </div>
                <label className="mt-4 grid gap-2 text-sm font-medium">
                  Agente do WhatsApp
                  <Select
                    className="bg-white/90"
                    value={preferences.personalAgentEnabled ? "__personal" : preferences.whatsappAgentId}
                    onChange={(event) => {
                      const value = event.target.value;
                      void saveWhatsAppSettings(
                        value === "__personal" ? { personalAgentEnabled: true } : { whatsappAgentId: value, personalAgentEnabled: false },
                        "Agente do WhatsApp atualizado.",
                      );
                    }}
                  >
                    <option value="__personal">Agente pessoal do WhatsApp</option>
                    <option value="">Sem agente ativo: comportamento padrão</option>
                    {channelAgents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{String(agent.name)}</option>)}
                  </Select>
                </label>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <GhostButton className="w-full bg-white/85" type="button" disabled={saving} onClick={() => setWhatsAppBotEnabled(!whatsappBotEnabled)}>
                    <Power className="h-4 w-4" /> {whatsappBotEnabled ? "Pausar" : "Ativar"}
                  </GhostButton>
                  <GhostButton className="w-full bg-white/85" type="button" onClick={() => window.open(whatsappStatus?.qrcodeUrl || "/api/whatsapp-qrcode", "_blank", "noopener,noreferrer")}>
                    <ExternalLink className="h-4 w-4" /> QR Code
                  </GhostButton>
                  <GhostButton className="w-full bg-white/85" type="button" disabled={saving || (!preferences.personalAgentEnabled && !preferences.whatsappAgentId)} onClick={resetWhatsAppAgent}>
                    <RefreshCw className="h-4 w-4" /> Resetar
                  </GhostButton>
                </div>
              </section>

              <section className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold tracking-[0.12em] ${activeChatAgent ? "bg-emerald-600 text-white" : "bg-zinc-800 text-white"}`}>
                    {activeChatAgent ? "AGENTE FIXO" : "SEM AGENTE FIXO"}
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">Chat do app</span>
                </div>
                <h3 className="mt-4 break-words text-2xl font-semibold tracking-tight text-zinc-950">{activeChatAgent ? String(activeChatAgent.name) : "Sem agente fixo"}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{activeChatAgent ? "O chat usa este agente como instrução principal." : "O chat usa seu modelo preferido e instruções gerais."}</p>
                <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-zinc-700">
                  Modelo: {activeChatAgent ? String(activeChatAgent.model || "modelo padrão/preferido") : preferences.preferredModel || "modelo padrão"}
                </div>
                <label className="mt-4 grid gap-2 text-sm font-medium text-zinc-700">
                  Agente do chat
                  <Select value={preferences.activeAgentId} onChange={(event) => saveSettings({ activeAgentId: event.target.value }, "Agente do chat atualizado.")}>
                    <option value="">Sem agente fixo: usar preferência/modelo padrão</option>
                    {channelAgents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{String(agent.name)}</option>)}
                  </Select>
                </label>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <GhostButton className="w-full" type="button" disabled={saving || !preferences.activeAgentId} onClick={resetChatAgent}>
                    <RefreshCw className="h-4 w-4" /> Resetar chat
                  </GhostButton>
                  <GhostButton className="w-full" type="button" disabled={saving || (!preferences.activeAgentId && !preferences.personalAgentEnabled && !preferences.whatsappAgentId)} onClick={resetAllActiveAgents}>
                    Resetar tudo
                  </GhostButton>
                </div>
              </section>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
              <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Destino de cadastros</p>
                <h3 className="mt-1 font-semibold text-zinc-950">Onde fotos, áudios e produtos serão salvos</h3>
                <p className="mt-1 text-sm leading-6 text-emerald-800">Telegram: {activeTelegramKnowledgeAgent ? String(activeTelegramKnowledgeAgent.name) : "não configurado"}. WhatsApp: {activeWhatsappKnowledgeAgent ? String(activeWhatsappKnowledgeAgent.name) : "não configurado"}.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Select value={preferences.telegramKnowledgeAgentId || preferences.knowledgeAgentId} onChange={(event) => void setKnowledgeDestination("telegram", event.target.value, "Destino de cadastro do Telegram atualizado.")}>
                    <option value="">Telegram: comportamento padrão</option>
                    {channelAgents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{String(agent.name)}</option>)}
                  </Select>
                  <Select value={preferences.whatsappKnowledgeAgentId || ""} onChange={(event) => void setKnowledgeDestination("whatsapp", event.target.value, "Destino de cadastro do WhatsApp atualizado.")}>
                    <option value="">WhatsApp: comportamento padrão</option>
                    {channelAgents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{String(agent.name)}</option>)}
                  </Select>
                </div>
              </section>
              <section className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Atenção</p>
                <h3 className="mt-1 text-2xl font-semibold text-zinc-950">{operations?.urgentMessages?.length || 0}</h3>
                <p className="mt-1 text-sm leading-6 text-zinc-500">Conversas importantes recentes. {operations?.env.telegramOwnerConfigured ? "Alertas Telegram configurados." : "Configure o Telegram para receber alertas."}</p>
              </section>
            </div>
          </section>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <section className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
                  <ClipboardCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-zinc-950">Checklist de produção</h2>
                  <p className="mt-1 text-sm text-zinc-500">Itens essenciais para deixar o agente respondendo com segurança no WhatsApp.</p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {(operations?.checklist || []).map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                    {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                    <span className={`min-w-0 break-words ${item.ok ? "text-zinc-700" : "text-amber-800"}`}>{item.label}</span>
                  </div>
                ))}
                {!operations?.checklist?.length ? <p className="text-sm text-zinc-500">Carregando checklist...</p> : null}
              </div>
            </section>

            <section className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="font-semibold text-zinc-950">Alertas recentes</h2>
              <div className="mt-3 space-y-3">
                {(operations?.urgentMessages || []).slice(0, 4).map((message) => (
                  <div key={message.id} className="rounded-lg border border-zinc-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${classificationClass(message.classification)}`}>{classificationLabel(message.classification)}</span>
                      <span className="text-xs text-zinc-400">{formatMessageDate(message.created_at)}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm text-zinc-700">{message.content || "Sem texto registrado."}</p>
                  </div>
                ))}
                {!operations?.urgentMessages?.length ? <p className="rounded-lg border border-dashed border-zinc-200 p-4 text-sm leading-6 text-zinc-500">Nenhum alerta urgente registrado ainda.</p> : null}
              </div>
            </section>
          </div>

          <section className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-semibold text-zinc-950">Testar agente antes de ativar</h2>
                <p className="mt-1 break-words text-sm leading-6 text-zinc-500">Simule uma mensagem recebida e veja classificação, alerta e resposta prevista.</p>
              </div>
              <span className="w-fit rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">Não envia mensagem real</span>
            </div>
            <form onSubmit={runSimulation} className="mt-4 grid min-w-0 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
              <Select value={simulation.scenario} onChange={(event) => setSimulation((current) => ({ ...current, scenario: event.target.value as SimulationScenario }))}>
                <option value="normal">Contato comum</option>
                <option value="vip">Contato VIP</option>
                <option value="urgent">Mensagem urgente</option>
                <option value="outside_hours">Fora do horário</option>
              </Select>
              <TextInput value={simulation.message} onChange={(event) => setSimulation((current) => ({ ...current, message: event.target.value }))} placeholder="Simular mensagem recebida..." />
              <PrimaryButton type="submit" className="w-full lg:w-auto" disabled={testingAgent || !simulation.message.trim()}>
                {testingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Simular
              </PrimaryButton>
            </form>
            {simulationResult ? (
              <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Resultado</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-950">{simulationResult.agent.name}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className={`rounded-full px-2 py-1 font-semibold ${classificationClass(simulationResult.classification.classification)}`}>{classificationLabel(simulationResult.classification.classification)}</span>
                    <span className="rounded-full bg-zinc-200 px-2 py-1 text-zinc-700">{simulationResult.willSendMessage ? "responderia" : "não responderia"}</span>
                    <span className="rounded-full bg-zinc-200 px-2 py-1 text-zinc-700">{simulationResult.willNotifyOwner ? "avisaria Telegram" : "sem alerta"}</span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-zinc-500">Motivo: {simulationResult.classification.reason}. {simulationResult.generatedByModel ? "Resposta gerada pelo modelo ativo." : "Resposta segura de fallback."}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-zinc-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-950">Resposta prevista</p>
                    <GhostButton type="button" onClick={() => copyText(simulationResult.responsePreview)}>
                      <Copy className="h-4 w-4" /> Copiar
                    </GhostButton>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">{simulationResult.responsePreview}</p>
                </div>
              </div>
            ) : null}
          </section>

          <section className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-semibold text-zinc-950">Histórico operacional</h2>
                <p className="mt-1 break-words text-sm leading-6 text-zinc-500">Últimas mensagens registradas pelo agente pessoal do WhatsApp.</p>
              </div>
              <div className="-mx-1 flex min-w-0 max-w-full gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:px-0">
                {["all", "normal", "urgent", "vip", "restricted", "spam", "ignored"].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setHistoryFilter(filter)}
                    className={`h-9 shrink-0 rounded-lg px-3 text-sm transition ${historyFilter === filter ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
                  >
                    {filter === "all" ? "Todos" : classificationLabel(filter)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              {filteredMessages.map((message) => (
                <article key={message.id} className="min-w-0 rounded-lg border border-zinc-200 p-3 transition duration-200 hover:border-zinc-300">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="break-words font-semibold text-zinc-950">{message.contact_name || message.contact_number || "Contato sem nome"}</p>
                      <p className="break-words text-xs text-zinc-500">{message.contact_number || "Número não registrado"} / {formatMessageDate(message.created_at)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${classificationClass(message.classification)}`}>{classificationLabel(message.classification)}</span>
                      <span className={`rounded-full px-2 py-1 text-xs ${message.owner_notified ? "bg-sky-50 text-sky-700" : "bg-zinc-100 text-zinc-600"}`}>{message.owner_notified ? "Telegram avisado" : "Sem alerta"}</span>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">{message.content || "Sem conteúdo registrado."}</p>
                  {message.response_text ? (
                    <div className="mt-3 rounded-lg bg-zinc-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Resposta enviada</p>
                        <button type="button" className="text-xs font-semibold text-zinc-700 hover:text-zinc-950" onClick={() => copyText(message.response_text || "")}>Copiar</button>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">{message.response_text}</p>
                    </div>
                  ) : null}
                </article>
              ))}
              {!filteredMessages.length ? <p className="rounded-lg border border-dashed border-zinc-200 p-5 text-sm leading-6 text-zinc-500">Nenhuma mensagem encontrada para este filtro.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "agents" ? (
        <div className="mt-6 grid gap-6">
          <section className="order-2 rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-zinc-950">Meus agentes</h2>
                <p className="mt-1 text-sm text-zinc-500">Lista de agentes existentes, seus canais ativos e ações rápidas.</p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 sm:min-w-80">
                <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar agentes..." className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm" />
              </div>
            </div>
            <div className="mt-4 grid gap-3">
            {state.loading ? <p className="text-zinc-500">Carregando...</p> : null}
            {!state.loading && !filteredAgents.length ? <p className="rounded-lg border border-dashed border-zinc-200 p-5 text-sm text-zinc-500">Nenhum agente encontrado. Crie um modelo pronto ou um agente em branco.</p> : null}
            {filteredAgents.map((agent) => (
              <section key={String(agent.id)} className="rounded-lg border border-zinc-200 bg-white p-4 transition duration-200 hover:border-zinc-300 hover:shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-950">{String(agent.name)}</p>
                    <p className="mt-1 text-sm text-zinc-500">{String(agent.domain)} / {agent.model ? String(agent.model) : "modelo padrão"}</p>
                    {agent.description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{String(agent.description)}</p> : null}
                    <AgentBadge agent={agent} />
                  </div>
                  <AgentActions agent={agent} />
                </div>
              </section>
            ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "create" ? (
        <div className="mt-6 grid gap-6">
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold text-zinc-950">Modelos prontos</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-500">Comece por um modelo seguro e edite antes de ativar. O sistema evita duplicar modelos com o mesmo nome.</p>
              </div>
              <GhostButton className="w-full sm:w-auto" type="button" onClick={openNewAgent}>
                <Plus className="h-4 w-4" /> Agente em branco
              </GhostButton>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {AGENT_TEMPLATES.map((template) => {
                const existingAgent = findTemplateAgent(template);
                const isWhatsappActive =
                  (template.id === "pessoal" && preferences.personalAgentEnabled) ||
                  (!preferences.personalAgentEnabled && existingAgent && preferences.whatsappAgentId === String(existingAgent.id));
                const needsConfig = template.id === "pessoal" && (!operations?.env.telegramOwnerConfigured || !operations?.env.personalOwnerNumberConfigured);
                return (
                  <section key={template.id} className="rounded-lg border border-zinc-200 bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
                        {template.id.includes("farmácia") ? <ShieldCheck className="h-5 w-5" /> : template.domain === "automation" ? <BellRing className="h-5 w-5" /> : <BrainCircuit className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-zinc-950">{template.name}</h3>
                        <p className="mt-1 text-sm leading-6 text-zinc-600">{template.description}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {isWhatsappActive ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">ativo no WhatsApp</span> : null}
                      {existingAgent ? <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">já criado</span> : null}
                      {template.id.includes("farmácia") ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">seguro para farmácia</span> : null}
                      {template.tools.includes("web_search") ? <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">pesquisa web</span> : null}
                      {needsConfig ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">precisa configurar</span> : <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">pronto para WhatsApp</span>}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <PrimaryButton className="w-full" disabled={saving} onClick={() => void createFromTemplate(template)}>
                        {existingAgent ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        {existingAgent ? "Editar" : "Criar"}
                      </PrimaryButton>
                      <GhostButton className="w-full" disabled={saving || Boolean(isWhatsappActive)} onClick={() => void assignTemplateToWhatsApp(template)}>
                        <MessageCircle className="h-4 w-4" /> WhatsApp
                      </GhostButton>
                      <GhostButton className="w-full sm:col-span-2" type="button" onClick={() => prepareTemplateTest(template)}>
                        <Play className="h-4 w-4" /> Testar antes de ativar
                      </GhostButton>
                    </div>
                  </section>
                );
              })}
            </div>
          </section>

        <form ref={editorRef} onSubmit={saveAgent} className="order-1 scroll-mt-24 grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5 lg:grid-cols-2">
          <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-2">
            <h2 className="text-lg font-semibold text-zinc-950">{form.id ? "Editar agente" : "Novo agente"}</h2>
            <GhostButton type="button" onClick={openNewAgent}><Plus className="h-4 w-4" /> Novo</GhostButton>
          </div>
          <TextInput required placeholder="Nome do agente" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Select value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })}>
            {DOMAIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Select value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })}>
            <option value="">Modelo padrão/preferido</option>
            {MODEL_PRESETS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </Select>
          <TextInput placeholder="Descrição curta" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <label className="grid gap-2 text-sm text-zinc-600">
            Temperatura
            <TextInput type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(event) => setForm({ ...form, temperature: Number(event.target.value) })} />
          </label>
          <label className="grid gap-2 text-sm text-zinc-600">
            Max tokens
            <TextInput type="number" min={256} max={128000} step={256} value={form.max_tokens} onChange={(event) => setForm({ ...form, max_tokens: Number(event.target.value) })} />
          </label>
          <TextArea placeholder="Prompt/instruções do agente" value={form.system_prompt} onChange={(event) => setForm({ ...form, system_prompt: event.target.value })} />
          <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 lg:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-950">Horário de funcionamento do agente</h3>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Use quando este agente só deve responder em dias e horários específicos, como farmácia, vendas ou suporte.
                </p>
              </div>
              <span className="w-fit rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">{agentScheduleSummary()}</span>
            </div>
            <label className="mt-3 flex items-start gap-2 text-sm text-zinc-700">
              <input
                className="mt-1"
                type="checkbox"
                checked={form.schedule.enabled}
                onChange={(event) => updateAgentSchedule({ enabled: event.target.checked })}
              />
              <span>
                Ativar controle de horário para este agente
                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  Se estiver fora do horário, o WhatsApp responderá com a mensagem definida abaixo.
                </span>
              </span>
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {AVAILABLE_DAY_OPTIONS.map((day) => {
                const active = form.schedule.availableDays.includes(day.id);
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => toggleAgentAvailableDay(day.id)}
                    className={`h-9 rounded-lg border px-3 text-sm font-semibold transition ${active ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100"}`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Início</span>
                <TextInput type="time" value={form.schedule.startTime} onChange={(event) => updateAgentSchedule({ startTime: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Fim</span>
                <TextInput type="time" value={form.schedule.endTime} onChange={(event) => updateAgentSchedule({ endTime: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Fuso horário</span>
                <Select value={form.schedule.timezone} onChange={(event) => updateAgentSchedule({ timezone: event.target.value })}>
                  <option value="America/Fortaleza">America/Fortaleza</option>
                  <option value="America/Sao_Paulo">America/Sao_Paulo</option>
                  <option value="America/Manaus">America/Manaus</option>
                  <option value="America/Rio_Branco">America/Rio_Branco</option>
                </Select>
              </label>
            </div>
            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Mensagem fora do horário</span>
              <TextArea
                className="min-h-20 sm:min-h-20"
                placeholder={DEFAULT_OUT_OF_HOURS_MESSAGE}
                value={form.schedule.outOfHoursMessage}
                onChange={(event) => updateAgentSchedule({ outOfHoursMessage: event.target.value })}
              />
            </label>
          </section>
          <div className="space-y-3">
            <p className="text-sm font-medium text-zinc-700">Ferramentas declaradas</p>
            <div className="flex flex-wrap gap-2">
              {TOOL_OPTIONS.map((tool) => (
                <button
                  key={tool}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, tools: current.tools.includes(tool) ? current.tools.filter((item) => item !== tool) : [...current.tools, tool] }))}
                  className={`rounded-md border px-2 py-1 text-xs transition ${form.tools.includes(tool) ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"}`}
                >
                  {tool}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Agente ativo</label>
            <label className="flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={form.is_orchestrator} onChange={(event) => setForm({ ...form, is_orchestrator: event.target.checked })} /> Orquestrador</label>
            <label className="flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={form.is_fallback} onChange={(event) => setForm({ ...form, is_fallback: event.target.checked })} /> Fallback</label>
          </div>
          <PrimaryButton disabled={saving || !form.name.trim()} type="submit"><CheckCircle2 className="h-4 w-4" /> {form.id ? "Salvar alterações" : "Criar agente"}</PrimaryButton>
        </form>
        </div>
      ) : null}

      {tab === "knowledge" ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
                <BrainCircuit className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-zinc-950">Conhecimento por agente</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Tudo que você cadastrar aqui pertence somente ao agente escolhido. O agente de farmácia pode ter medicamentos, preços e regras; vendas pode ter ofertas; suporte pode ter processos.
                </p>
              </div>
            </div>

            <label className="mt-5 grid gap-2 text-sm text-zinc-600">
              Agente
              <Select
                value={knowledgeAgentId}
                onChange={(event) => {
                  setKnowledgeAgentId(event.target.value);
                  if (event.target.value) void loadKnowledge(event.target.value);
                  else setKnowledgeItems([]);
                }}
              >
                <option value="">Escolha um agente</option>
                {state.data.map((agent) => (
                  <option key={String(agent.id)} value={String(agent.id)}>
                    {String(agent.name)}
                  </option>
                ))}
              </Select>
            </label>
            <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
              <p>
                Destino atual do Telegram: <span className="font-semibold text-zinc-950">{activeTelegramKnowledgeAgent ? String(activeTelegramKnowledgeAgent.name) : "não definido"}</span>.
                {" "}Destino atual do WhatsApp: <span className="font-semibold text-zinc-950">{activeWhatsappKnowledgeAgent ? String(activeWhatsappKnowledgeAgent.name) : "não definido"}</span>.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <GhostButton type="button" disabled={!knowledgeAgentId || (preferences.telegramKnowledgeAgentId || preferences.knowledgeAgentId) === knowledgeAgentId} onClick={() => void setKnowledgeDestination("telegram", knowledgeAgentId, "Este agente agora recebe os cadastros do Telegram.")}>
                  <BrainCircuit className="h-4 w-4" /> Usar nos cadastros do Telegram
                </GhostButton>
                <GhostButton type="button" disabled={!knowledgeAgentId || preferences.whatsappKnowledgeAgentId === knowledgeAgentId} onClick={() => void setKnowledgeDestination("whatsapp", knowledgeAgentId, "Este agente agora recebe os cadastros do WhatsApp.")}>
                  <BrainCircuit className="h-4 w-4" /> Usar nos cadastros do WhatsApp
                </GhostButton>
              </div>
            </div>

            <form onSubmit={saveKnowledge} className="mt-4 grid gap-3">
              <TextInput
                required
                placeholder="Título. Ex: Dipirona gotas 20ml"
                value={knowledgeForm.title}
                onChange={(event) => setKnowledgeForm({ ...knowledgeForm, title: event.target.value })}
              />
              <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <Select value={knowledgeForm.kind} onChange={(event) => setKnowledgeForm({ ...knowledgeForm, kind: event.target.value })}>
                  <option value="product">Produto/medicamento</option>
                  <option value="price">Preço</option>
                  <option value="policy">Regra/política</option>
                  <option value="faq">Pergunta frequente</option>
                  <option value="service">Serviço</option>
                  <option value="instruction">Instrução do agente</option>
                  <option value="document">Documento</option>
                  <option value="other">Outro</option>
                </Select>
                <Select value={knowledgeForm.priority} onChange={(event) => setKnowledgeForm({ ...knowledgeForm, priority: Number(event.target.value) })}>
                  <option value={1}>Prioridade 1</option>
                  <option value={2}>Prioridade 2</option>
                  <option value={3}>Prioridade 3</option>
                  <option value={4}>Prioridade 4</option>
                  <option value={5}>Prioridade 5</option>
                </Select>
              </div>
              <TextArea
                required
                placeholder="Conteúdo. Ex: Dipirona gotas 20ml, preço R$ 8,99, vender apenas conforme disponibilidade. Não orientar dose; encaminhar ao farmacêutico se houver dúvida de uso."
                value={knowledgeForm.content}
                onChange={(event) => setKnowledgeForm({ ...knowledgeForm, content: event.target.value })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput
                  placeholder="Tags: dipirona, analgésico, dor"
                  value={knowledgeForm.tags}
                  onChange={(event) => setKnowledgeForm({ ...knowledgeForm, tags: event.target.value })}
                />
                <TextInput
                  placeholder="Fonte/URL opcional"
                  value={knowledgeForm.source_url}
                  onChange={(event) => setKnowledgeForm({ ...knowledgeForm, source_url: event.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={knowledgeForm.is_active}
                  onChange={(event) => setKnowledgeForm({ ...knowledgeForm, is_active: event.target.checked })}
                />
                Usar este conhecimento nas respostas
              </label>
              {knowledgeError ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{knowledgeError}</p> : null}
              <PrimaryButton type="submit" disabled={savingKnowledge || !knowledgeAgentId || !knowledgeForm.title.trim() || !knowledgeForm.content.trim()}>
                {savingKnowledge ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Salvar conhecimento
              </PrimaryButton>
            </form>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold text-zinc-950">Itens deste agente</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {knowledgeItems.length} item(ns) cadastrados. Prioridade 1 aparece primeiro no contexto da IA.
                </p>
              </div>
              <GhostButton type="button" disabled={!knowledgeAgentId || knowledgeLoading} onClick={() => knowledgeAgentId && loadKnowledge(knowledgeAgentId)}>
                <RefreshCw className="h-4 w-4" /> Atualizar
              </GhostButton>
            </div>

            <div className="mt-4 grid gap-3">
              {knowledgeLoading ? <p className="text-sm text-zinc-500">Carregando conhecimento...</p> : null}
              {!knowledgeLoading && !knowledgeAgentId ? <p className="rounded-lg border border-dashed border-zinc-200 p-5 text-sm text-zinc-500">Escolha um agente para ver a base dele.</p> : null}
              {!knowledgeLoading && knowledgeAgentId && !knowledgeItems.length ? (
                <p className="rounded-lg border border-dashed border-zinc-200 p-5 text-sm text-zinc-500">
                  Este agente ainda não tem conhecimento próprio. Cadastre produtos, preços, regras ou FAQs para ele responder com dados reais.
                </p>
              ) : null}
              {knowledgeItems.map((item) => (
                <article key={item.id} className={`rounded-lg border p-3 ${item.is_active ? "border-zinc-200" : "border-zinc-200 bg-zinc-50 opacity-70"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-zinc-950">{item.title}</h3>
                        <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">{item.kind}</span>
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">P{item.priority}</span>
                        {item.metadata?.status === "pending_review" ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">rascunho</span> : null}
                        {item.metadata?.status === "discarded" ? <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">descartado</span> : null}
                        {!item.is_active ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">pausado</span> : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700">{item.content}</p>
                      {item.tags?.length ? <p className="mt-2 text-xs text-zinc-500">Tags: {item.tags.join(", ")}</p> : null}
                      {item.source_url ? <p className="mt-1 truncate text-xs text-zinc-500">Fonte: {item.source_url}</p> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {item.metadata?.status === "pending_review" ? <GhostButton type="button" onClick={() => approveKnowledge(item)}>Aprovar</GhostButton> : null}
                      {item.metadata?.status === "pending_review" ? <GhostButton type="button" onClick={() => discardKnowledge(item)}>Descartar</GhostButton> : null}
                      <GhostButton type="button" onClick={() => toggleKnowledge(item)}>{item.is_active ? "Pausar" : "Ativar"}</GhostButton>
                      <GhostButton type="button" onClick={() => removeKnowledge(item)}><Trash2 className="h-4 w-4" /></GhostButton>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div id="whatsapp-agent-settings" className="mt-6 scroll-mt-24 grid gap-4 lg:grid-cols-2">
          <form onSubmit={savePersonalAgentSettings} className="rounded-lg border border-zinc-200 bg-white p-4 lg:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold text-zinc-950">Agente pessoal do WhatsApp</h2>
                <p className="mt-1 text-sm text-zinc-500">Configure como o agente deve responder no seu WhatsApp pessoal. Ele usa Claude Sonnet Latest por padrão.</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={preferences.personalAgentEnabled}
                  onChange={(event) => setPreferences((current) => ({ ...current, personalAgentEnabled: event.target.checked }))}
                />
                Usar agente pessoal
              </label>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Meu nome</span>
                <TextInput
                  placeholder="Ex: João Carlos"
                  value={preferences.personalProfile.name}
                  onChange={(event) => updatePersonalProfile({ name: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Minha profissão</span>
                <TextInput
                  placeholder="Ex: dono de farmácia"
                  value={preferences.personalProfile.profession}
                  onChange={(event) => updatePersonalProfile({ profession: event.target.value })}
                />
              </label>
            </div>
            <section className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950">Horário de atendimento</h3>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">Defina quando o agente pode responder normalmente. Fora desse período ele usa a mensagem de ocupado.</p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">{scheduleSummary()}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {AVAILABLE_DAY_OPTIONS.map((day) => {
                  const activeDays = preferences.personalProfile.availableDays?.length
                    ? preferences.personalProfile.availableDays.map(String)
                    : ["mon", "tue", "wed", "thu", "fri"];
                  const active = activeDays.includes(day.id);
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => toggleAvailableDay(day.id)}
                      className={`h-9 rounded-lg border px-3 text-sm font-semibold transition ${active ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-600"}`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Início</span>
                  <TextInput type="time" value={preferences.personalProfile.startTime || "08:00"} onChange={(event) => updatePersonalProfile({ startTime: event.target.value })} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Fim</span>
                  <TextInput type="time" value={preferences.personalProfile.endTime || "18:00"} onChange={(event) => updatePersonalProfile({ endTime: event.target.value })} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Fuso horário</span>
                  <Select value={preferences.personalProfile.timezone || "America/Fortaleza"} onChange={(event) => updatePersonalProfile({ timezone: event.target.value })}>
                    <option value="America/Fortaleza">America/Fortaleza</option>
                    <option value="America/Sao_Paulo">America/Sao_Paulo</option>
                    <option value="America/Manaus">America/Manaus</option>
                    <option value="America/Rio_Branco">America/Rio_Branco</option>
                  </Select>
                </label>
              </div>
              <label className="mt-3 flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Mensagem fora do horário</span>
                <TextArea
                  className="min-h-20 sm:min-h-20"
                  placeholder={DEFAULT_OUT_OF_HOURS_MESSAGE}
                  value={preferences.personalProfile.outOfHoursMessage || DEFAULT_OUT_OF_HOURS_MESSAGE}
                  onChange={(event) => updatePersonalProfile({ outOfHoursMessage: event.target.value })}
                />
              </label>
            </section>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Contatos VIP</span>
                <TextArea
                  placeholder="Um por linha ou separados por vírgula. Ex: esposa, mãe, chefe"
                  value={preferences.personalVipContacts}
                  onChange={(event) => setPreferences((current) => ({ ...current, personalVipContacts: event.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Assuntos urgentes</span>
                <TextArea
                  placeholder="Ex: aluguel, escola das crianças, pagamento importante"
                  value={preferences.personalUrgentTopics}
                  onChange={(event) => setPreferences((current) => ({ ...current, personalUrgentTopics: event.target.value }))}
                />
              </label>
            </div>
            <PrimaryButton type="submit" disabled={saving} className="mt-4">
              <CheckCircle2 className="h-4 w-4" /> Salvar agente pessoal
            </PrimaryButton>
            <p className="mt-3 text-xs text-zinc-500">
              Essas informações ficam salvas no seu perfil e são diferentes dos agentes criados na lista. O seletor abaixo só é usado quando você desligar o agente pessoal.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Telegram", operations?.env.telegramOwnerConfigured],
                ["Número dono", operations?.env.personalOwnerNumberConfigured],
                ["Service role", operations?.env.serviceRoleConfigured],
                ["OpenRouter", operations?.env.aiConfigured],
              ].map(([label, ok]) => (
                <div key={String(label)} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                  {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                  <span className={ok ? "text-zinc-700" : "text-amber-800"}>{String(label)} {ok ? "ok" : "pendente"}</span>
                </div>
              ))}
            </div>
          </form>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 lg:col-span-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold text-zinc-950">Controle do WhatsApp</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {!whatsappBotEnabled
                    ? "Modo manual ligado: o número continua conectado, mas o agente não responde."
                    : `Agente ativo: ${whatsappResponderName} está respondendo agora.`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full px-2 py-1 font-semibold ${!whatsappBotEnabled ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {!whatsappBotEnabled ? "Modo manual" : "Agente ativo"}
                  </span>
                  <span className="rounded-full bg-sky-50 px-2 py-1 font-semibold text-sky-700">Respondendo: {whatsappResponderName}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-600">Instância: {whatsappStatus?.instance || "minha-ia"}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-600">Conexão: {whatsappStatus?.connection?.state || "consultando"}</span>
                </div>
                {whatsappStatus?.connection?.error ? <p className="mt-3 text-xs text-amber-700">{whatsappStatus.connection.error}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <GhostButton type="button" disabled={saving} onClick={() => setWhatsAppBotEnabled(!whatsappBotEnabled)}>
                  <Power className="h-4 w-4" />
                  {whatsappBotEnabled ? "Pausar agente" : "Ativar agente"}
                </GhostButton>
                <GhostButton type="button" onClick={() => window.open(whatsappStatus?.qrcodeUrl || "/api/whatsapp-qrcode", "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-4 w-4" /> Abrir QR Code
                </GhostButton>
              </div>
            </div>
          </section>
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 lg:col-span-2">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Destino de cadastros por canal</p>
                <h2 className="mt-2 font-semibold text-zinc-950">Telegram e WhatsApp podem salvar em agentes diferentes</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-emerald-800">
                  Escolha Farmácia para medicamentos e preços, Vendas para produtos comerciais e Suporte para processos. Isso evita que fotos e áudios entrem na base errada.
                </p>
                {!activeTelegramKnowledgeAgent || !activeWhatsappKnowledgeAgent ? (
                  <p className="mt-2 text-xs font-medium text-amber-800">
                    Há canal sem destino fixo. Telegram: {telegramKnowledgeSource}. WhatsApp: {whatsappKnowledgeSource}.
                  </p>
                ) : null}
              </div>
              <div className="flex w-full flex-col gap-2 lg:w-96">
                <Select value={preferences.telegramKnowledgeAgentId || preferences.knowledgeAgentId} onChange={(event) => void setKnowledgeDestination("telegram", event.target.value, "Destino dos cadastros do Telegram atualizado.")}>
                  <option value="">Telegram: usar fallback</option>
                  {channelAgents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{String(agent.name)}</option>)}
                </Select>
                <Select value={preferences.whatsappKnowledgeAgentId} onChange={(event) => void setKnowledgeDestination("whatsapp", event.target.value, "Destino dos cadastros do WhatsApp atualizado.")}>
                  <option value="">WhatsApp: usar fallback do agente respondente</option>
                  {channelAgents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{String(agent.name)}</option>)}
                </Select>
                <div className="grid gap-2 sm:grid-cols-2">
                  <GhostButton type="button" disabled={!knowledgeDestinationAgent?.id} onClick={() => { if (knowledgeDestinationAgent?.id) { setKnowledgeAgentId(String(knowledgeDestinationAgent.id)); void loadKnowledge(String(knowledgeDestinationAgent.id)); setTab("knowledge"); } }}>
                    <BrainCircuit className="h-4 w-4" /> Ver base
                  </GhostButton>
                  <GhostButton type="button" disabled={!preferences.telegramKnowledgeAgentId && !preferences.whatsappKnowledgeAgentId && !preferences.knowledgeAgentId} onClick={() => { void saveWhatsAppSettings({ telegramKnowledgeAgentId: "", whatsappKnowledgeAgentId: "", knowledgeAgentId: "" }, "Destinos fixos removidos. Os fallbacks voltaram a valer."); setKnowledgeAgentId(""); }}>
                    Limpar destinos
                  </GhostButton>
                </div>
              </div>
            </div>
          </section>
          <section className={`rounded-lg border p-4 lg:col-span-2 ${whatsappResponderClass}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-75">Resumo do WhatsApp</p>
                <h2 className="mt-2 text-xl font-semibold">{whatsappResponderName}</h2>
                <p className="mt-1 text-sm leading-6 opacity-80">{whatsappResponderStatus}</p>
              </div>
              <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold tracking-[0.12em] ${whatsappResponderBadgeClass}`}>{whatsappResponderBadge}</span>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold text-zinc-950">Agente ativo no chat</h2>
            <p className="mt-1 text-sm text-zinc-500">O chat usa este prompt como instrução principal e o modelo do agente quando você não escolher outro na mensagem.</p>
            <Select className="mt-4 w-full" value={preferences.activeAgentId} onChange={(event) => saveSettings({ activeAgentId: event.target.value }, "Agente do chat atualizado.")}>
              <option value="">Sem agente fixo: usar preferência/modelo padrão</option>
              {channelAgents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{String(agent.name)}</option>)}
            </Select>
            <GhostButton className="mt-3 w-full" type="button" disabled={saving || !preferences.activeAgentId} onClick={resetChatAgent}>
              <RefreshCw className="h-4 w-4" /> Resetar agente do chat
            </GhostButton>
          </section>
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold text-zinc-950">Agente selecionado para WhatsApp</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {preferences.personalAgentEnabled
                ? "O agente pessoal está respondendo agora. Este seletor fica guardado como fallback para quando você desligar o agente pessoal."
                : "Com service role configurada, o webhook aplica este agente nas conversas do WhatsApp. Sem isso, continua usando o comportamento padrão."}
            </p>
            {preferences.personalAgentEnabled ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                O agente pessoal está no comando agora. Para usar Farmácia, Vendas ou Suporte no WhatsApp, desligue &quot;Usar agente pessoal&quot; acima ou use o botão &quot;Usar no WhatsApp&quot; no modelo pronto.
              </div>
            ) : null}
            <Select
              className="mt-4 w-full"
              value={preferences.personalAgentEnabled ? "__personal" : preferences.whatsappAgentId}
              onChange={(event) => {
                const value = event.target.value;
                void saveWhatsAppSettings(
                  value === "__personal" ? { personalAgentEnabled: true } : { whatsappAgentId: value, personalAgentEnabled: false },
                  "Agente do WhatsApp atualizado.",
                );
              }}
            >
              <option value="__personal">Agente pessoal do WhatsApp</option>
              <option value="">Sem agente ativo: usar comportamento padrão</option>
              {channelAgents.map((agent) => <option key={String(agent.id)} value={String(agent.id)}>{String(agent.name)}</option>)}
            </Select>
            <GhostButton className="mt-3 w-full" type="button" disabled={saving || (!preferences.personalAgentEnabled && !preferences.whatsappAgentId)} onClick={resetWhatsAppAgent}>
              <RefreshCw className="h-4 w-4" /> Resetar agente do WhatsApp
            </GhostButton>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function ConnectorsPageClient() {
  const [state, setState] = useState<ApiState<Row[]>>({ data: [], loading: true, error: null });
  const [form, setForm] = useState({ name: "OpenRouter", provider: "openrouter", base_url: "https://openrouter.ai/api/v1", auth_type: "bearer_token", credential_hint: "OPENROUTER_API_KEY" });
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const payload = await apiRequest<{ connectors: Row[] }>("/api/connectors");
    setState({ data: payload.connectors, loading: false, error: null });
  };

  useInitialLoad(async () => {
    await load().catch((error) => setState({ data: [], loading: false, error: error instanceof Error ? error.message : "Erro." }));
  });

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    await apiRequest("/api/connectors", { method: "POST", body: JSON.stringify({ ...form, headers: {} }) });
    setNotice("Conector salvo. A chave real deve estar configurada na Vercel com o nome informado abaixo.");
    await load();
  }

  function applyPreset(index: number) {
    const preset = CONNECTOR_PRESETS[index];
    setForm({ name: preset.name, provider: preset.provider, base_url: preset.base_url, auth_type: preset.auth_type, credential_hint: preset.credential_hint });
  }

  return (
    <div>
      <PageTitle eyebrow="Conectores" title="Provedores e APIs" description="Cadastre provedores compatíveis com OpenAI e deixe cada agente preparado para usar sua própria rota/modelo." />
      <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
        Não cole a chave secreta neste formulário. Para ChatGPT/OpenAI, coloque aqui o nome da variável: <span className="font-mono font-semibold">OPENAI_API_KEY</span>. A chave real deve ficar nas variáveis de ambiente da Vercel.
      </div>
      {notice ? <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div> : null}
      <form onSubmit={create} className="mt-6 grid min-w-0 gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5 lg:grid-cols-2">
        <Select onChange={(event) => applyPreset(Number(event.target.value))} defaultValue="0">
          {CONNECTOR_PRESETS.map((preset, index) => <option key={preset.name} value={index}>{preset.name}</option>)}
        </Select>
        <TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nome" />
        <TextInput value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} placeholder="Base URL" />
        <label className="grid gap-2 text-sm text-zinc-600">
          Nome da variável da chave
          <TextInput value={form.credential_hint} onChange={(event) => setForm({ ...form, credential_hint: event.target.value })} placeholder="OPENAI_API_KEY" />
        </label>
        <PrimaryButton type="submit" className="w-full lg:self-end"><Plus className="h-4 w-4" /> Salvar conector</PrimaryButton>
      </form>
      <div className="mt-6 grid gap-3">
        {state.loading ? <p className="text-zinc-500">Carregando...</p> : state.data.map((connector) => (
          <section key={String(connector.id)} className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{String(connector.name)}</p>
                <p className="mt-1 break-all text-sm text-zinc-500">{String(connector.provider)} / {String(connector.base_url)}</p>
                <p className="mt-1 break-all text-xs text-zinc-500">Variável esperada: {connector.credential_hint ? String(connector.credential_hint) : "não informada"}</p>
              </div>
              <GhostButton className="w-full sm:w-auto" onClick={() => apiRequest(`/api/connectors/${String(connector.id)}/ping`, { method: "POST" }).then(load)}><RefreshCw className="h-4 w-4" /> Testar</GhostButton>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function MemoryPageClient() {
  const [state, setState] = useState<ApiState<Row[]>>({ data: [], loading: true, error: null });
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("fact");

  const load = async () => {
    const payload = await apiRequest<{ memories: Row[] }>("/api/memory");
    setState({ data: payload.memories, loading: false, error: null });
  };

  useInitialLoad(async () => {
    await load().catch((error) => setState({ data: [], loading: false, error: error instanceof Error ? error.message : "Erro." }));
  });

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiRequest("/api/memory", { method: "POST", body: JSON.stringify({ kind, content }) });
    setContent("");
    await load();
  }

  return (
    <div>
      <PageTitle eyebrow="Memória" title="Cérebro persistente" description="Edite manualmente fatos, preferências, objetivos e restrições que o agente usa para se adaptar." />
      <form onSubmit={create} className="mt-6 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
        <Select value={kind} onChange={(event) => setKind(event.target.value)}>
          {["fact", "preference", "goal", "style", "constraint"].map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <TextArea required placeholder="Nova memória..." value={content} onChange={(event) => setContent(event.target.value)} />
        <PrimaryButton type="submit"><Plus className="h-4 w-4" /> Adicionar memória</PrimaryButton>
      </form>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {state.loading ? <p className="text-zinc-500">Carregando...</p> : state.data.map((memory) => (
          <section key={String(memory.id)} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-600">{String(memory.kind)}</p>
                <p className="mt-2 text-sm leading-6">{String(memory.content)}</p>
              </div>
              <GhostButton onClick={() => apiRequest(`/api/memory/${String(memory.id)}`, { method: "DELETE" }).then(load)}><Trash2 className="h-4 w-4" /></GhostButton>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function SchedulerPageClient() {
  const [state, setState] = useState<ApiState<Row[]>>({ data: [], loading: true, error: null });
  const [form, setForm] = useState({ title: "", prompt: "", recurrence: "daily" });
  const [running, setRunning] = useState<string | null>(null);

  const load = async () => {
    const payload = await apiRequest<{ tasks: Row[] }>("/api/scheduler");
    setState({ data: payload.tasks, loading: false, error: null });
  };

  useInitialLoad(async () => {
    await load().catch((error) => setState({ data: [], loading: false, error: error instanceof Error ? error.message : "Erro." }));
  });

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiRequest("/api/scheduler", { method: "POST", body: JSON.stringify(form) });
    setForm({ title: "", prompt: "", recurrence: "daily" });
    await load();
  }

  async function runTask(id: string) {
    setRunning(id);
    try {
      await apiRequest(`/api/scheduler/${id}/run`, { method: "POST" });
      await load();
    } finally {
      setRunning(null);
    }
  }

  return (
    <div>
      <PageTitle eyebrow="Agenda" title="Execuções programadas" description="Crie tarefas recorrentes e rode manualmente quando quiser. Em produção, conecte essa API a um cron externo." />
      <form onSubmit={create} className="mt-6 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5 lg:grid-cols-2">
        <TextInput required placeholder="Título" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        <Select value={form.recurrence} onChange={(event) => setForm({ ...form, recurrence: event.target.value })}>
          {["hourly", "daily", "weekly", "monthly", "custom"].map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <TextArea required placeholder="Prompt da tarefa agendada" value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} />
        <PrimaryButton type="submit"><Plus className="h-4 w-4" /> Criar tarefa</PrimaryButton>
      </form>
      <div className="mt-6 grid gap-3">
        {state.loading ? <p className="text-zinc-500">Carregando...</p> : state.data.map((task) => (
          <section key={String(task.id)} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{String(task.title)}</p>
                <p className="mt-1 text-sm text-zinc-500">{String(task.recurrence)} / último status: {task.last_status ? String(task.last_status) : "nunca rodou"}</p>
                <p className="mt-2 text-sm text-zinc-600">{String(task.prompt)}</p>
              </div>
              <GhostButton disabled={running === task.id} onClick={() => runTask(String(task.id))}>
                {running === task.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Rodar
              </GhostButton>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function LogsPageClient() {
  const [state, setState] = useState<ApiState<Row[]>>({ data: [], loading: true, error: null });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      apiRequest<{ logs: Row[] }>("/api/logs")
        .then((payload) => setState({ data: payload.logs, loading: false, error: null }))
        .catch((error) => setState({ data: [], loading: false, error: error instanceof Error ? error.message : "Erro." }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div>
      <PageTitle eyebrow="Logs" title="Auditoria de execução" description="Acompanhe respostas geradas, falhas de modelo e execuções agendadas." />
      <div className="mt-6 space-y-3">
        {state.loading ? <p className="text-zinc-500">Carregando...</p> : state.data.map((log) => (
          <section key={String(log.id)} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{String(log.level)}</p>
                <p className="mt-1 text-sm text-zinc-600">{String(log.message)}</p>
              </div>
              <p className="text-xs text-zinc-500">{new Date(String(log.created_at)).toLocaleString("pt-BR")}</p>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function formatReminderDate(value: unknown) {
  if (!value) return "Sem data definida";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Data inválida";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AbilitiesPageClient() {
  const [tasks, setTasks] = useState<Row[]>([]);
  const [agents, setAgents] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingReminder, setSavingReminder] = useState(false);
  const [savingAbility, setSavingAbility] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [reminderForm, setReminderForm] = useState({
    title: "",
    prompt: "",
    next_run_at: "",
    notification_channels: ["whatsapp", "telegram"],
  });
  const [abilityForm, setAbilityForm] = useState({
    name: "",
    description: "",
    system_prompt: "",
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksPayload, agentsPayload] = await Promise.all([
        apiRequest<{ tasks: Row[] }>("/api/scheduler"),
        apiRequest<{ agents: Row[] }>("/api/agents"),
      ]);
      setTasks(tasksPayload.tasks);
      setAgents(agentsPayload.agents);
      setNowMs(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar habilidades.");
    } finally {
      setLoading(false);
    }
  };

  useInitialLoad(load);

  const reminders = tasks.filter((task) => String(task.cron_expression || "") === "reminder");
  const overdue = reminders.filter((task) => task.next_run_at && new Date(String(task.next_run_at)).getTime() < nowMs && task.is_active);
  const upcoming = reminders
    .filter((task) => task.next_run_at && new Date(String(task.next_run_at)).getTime() >= nowMs && task.is_active)
    .sort((a, b) => new Date(String(a.next_run_at)).getTime() - new Date(String(b.next_run_at)).getTime());
  const customAbilities = agents.filter((agent) => String(agent.domain) === "custom" || String(agent.domain) === "automation");

  async function createReminder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingReminder(true);
    setError(null);

    try {
      const nextRunAt = reminderForm.next_run_at ? new Date(reminderForm.next_run_at).toISOString() : null;
      await apiRequest("/api/scheduler", {
        method: "POST",
        body: JSON.stringify({
          title: reminderForm.title,
          prompt: reminderForm.prompt || `Me lembre: ${reminderForm.title}`,
          recurrence: "custom",
          cron_expression: "reminder",
          next_run_at: nextRunAt,
          notification_channels: reminderForm.notification_channels,
          is_active: true,
        }),
      });
      setReminderForm({ title: "", prompt: "", next_run_at: "", notification_channels: ["whatsapp", "telegram"] });
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Não foi possível criar o lembrete.");
    } finally {
      setSavingReminder(false);
    }
  }

  async function createAbility(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingAbility(true);
    setError(null);

    try {
      await apiRequest("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          name: abilityForm.name,
          description: abilityForm.description,
          domain: "custom",
          system_prompt: abilityForm.system_prompt,
          tools: [],
          is_active: true,
        }),
      });
      setAbilityForm({ name: "", description: "", system_prompt: "" });
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Não foi possível criar a habilidade.");
    } finally {
      setSavingAbility(false);
    }
  }

  async function completeReminder(id: string) {
    await apiRequest(`/api/scheduler/${id}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
    await load();
  }

  async function removeReminder(id: string) {
    await apiRequest(`/api/scheduler/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <PageTitle
        eyebrow="Habilidades"
        title="Central de habilidades"
        description="Ative capacidades do agente para lembrar compromissos, guardar rotinas e expandir o sistema com novos especialistas."
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4">
          <BellRing className="h-6 w-6 text-emerald-600" />
          <p className="mt-3 font-semibold">Lembretes</p>
          <p className="mt-1 text-sm leading-6 text-zinc-600">Crie lembretes com data/hora e veja o que está atrasado ou próximo.</p>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <BrainCircuit className="h-6 w-6 text-emerald-600" />
          <p className="mt-3 font-semibold">Habilidades customizadas</p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">Cada habilidade vira um agente especializado usado como contexto no chat.</p>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          <p className="mt-3 font-semibold">Pronto para expandir</p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">A mesma área pode receber email, WhatsApp, calendário e automações depois.</p>
        </section>
      </div>

      {error ? <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <BellRing className="h-5 w-5 text-emerald-600" />
            <div>
              <h2 className="font-semibold">Habilidade de lembrar</h2>
              <p className="text-sm text-zinc-500">Use como uma memória externa para compromissos e coisas importantes.</p>
            </div>
          </div>

          <form onSubmit={createReminder} className="mt-5 grid gap-3 lg:grid-cols-2">
            <TextInput
              required
              placeholder="Ex: tomar remédio"
              value={reminderForm.title}
              onChange={(event) => setReminderForm({ ...reminderForm, title: event.target.value })}
            />
            <input
              type="datetime-local"
              required
              value={reminderForm.next_run_at}
              onChange={(event) => setReminderForm({ ...reminderForm, next_run_at: event.target.value })}
              className="h-11 rounded-md border border-zinc-200 bg-white px-3 text-base outline-none focus:border-emerald-400 sm:h-10 sm:text-sm"
            />
            <TextArea
              placeholder="Detalhes do lembrete ou o que a IA deve te dizer..."
              value={reminderForm.prompt}
              onChange={(event) => setReminderForm({ ...reminderForm, prompt: event.target.value })}
            />
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-sm font-semibold text-zinc-700">Enviar lembrete por</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  ["whatsapp", "WhatsApp"],
                  ["telegram", "Telegram"],
                ].map(([id, label]) => {
                  const active = reminderForm.notification_channels.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        const current = reminderForm.notification_channels;
                        const next = active ? current.filter((item) => item !== id) : [...current, id];
                        setReminderForm({ ...reminderForm, notification_channels: next.length ? next : current });
                      }}
                      className={`h-9 rounded-lg border px-3 text-sm font-semibold transition ${active ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-600"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">O disparo automático usa o endpoint seguro de cron. No plano Hobby da Vercel, use um agendador externo para chamar esse endpoint a cada poucos minutos.</p>
            </div>
            <PrimaryButton disabled={savingReminder} type="submit">
              {savingReminder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Criar lembrete
            </PrimaryButton>
          </form>

          <div className="mt-6 grid gap-3">
            <h3 className="text-sm font-semibold text-zinc-600">Atrasados</h3>
            {loading ? <p className="text-sm text-zinc-500">Carregando...</p> : overdue.length ? overdue.map((task) => (
              <ReminderRow key={String(task.id)} task={task} urgent onComplete={completeReminder} onRemove={removeReminder} />
            )) : <p className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-500">Nenhum lembrete atrasado.</p>}

            <h3 className="mt-3 text-sm font-semibold text-zinc-600">Próximos</h3>
            {loading ? <p className="text-sm text-zinc-500">Carregando...</p> : upcoming.length ? upcoming.map((task) => (
              <ReminderRow key={String(task.id)} task={task} onComplete={completeReminder} onRemove={removeReminder} />
            )) : <p className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-500">Nenhum lembrete futuro cadastrado.</p>}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          <h2 className="font-semibold">Adicionar nova habilidade</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Crie uma habilidade como um especialista. Exemplo: Financeiro pessoal, Treino, Estudos ou Clientes.
          </p>

          <form onSubmit={createAbility} className="mt-5 grid gap-3">
            <TextInput
              required
              placeholder="Nome da habilidade"
              value={abilityForm.name}
              onChange={(event) => setAbilityForm({ ...abilityForm, name: event.target.value })}
            />
            <TextInput
              placeholder="Descrição curta"
              value={abilityForm.description}
              onChange={(event) => setAbilityForm({ ...abilityForm, description: event.target.value })}
            />
            <TextArea
              required
              placeholder="Instrução da habilidade. Ex: acompanhe meus hábitos e me cobre com gentileza..."
              value={abilityForm.system_prompt}
              onChange={(event) => setAbilityForm({ ...abilityForm, system_prompt: event.target.value })}
            />
            <PrimaryButton disabled={savingAbility} type="submit">
              {savingAbility ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Adicionar habilidade
            </PrimaryButton>
          </form>

          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-semibold text-zinc-600">Suas habilidades</h3>
            {loading ? <p className="text-sm text-zinc-500">Carregando...</p> : customAbilities.length ? customAbilities.slice(0, 8).map((agent) => (
              <div key={String(agent.id)} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <p className="font-medium">{String(agent.name)}</p>
                <p className="mt-1 text-sm text-zinc-500">{agent.description ? String(agent.description) : "Sem descrição."}</p>
              </div>
            )) : <p className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-500">Nenhuma habilidade personalizada ainda.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function ReminderRow({
  task,
  urgent,
  onComplete,
  onRemove,
}: {
  task: Row;
  urgent?: boolean;
  onComplete: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  return (
    <div className={`rounded-md border p-3 ${urgent ? "border-amber-400/30 bg-amber-400/10" : "border-zinc-200 bg-zinc-50"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium">{String(task.title)}</p>
          <p className={`mt-1 text-sm ${urgent ? "text-amber-700" : "text-zinc-500"}`}>{formatReminderDate(task.next_run_at)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Array.isArray(task.notification_channels) ? task.notification_channels : ["whatsapp", "telegram"]).map((channel) => (
              <span key={String(channel)} className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-zinc-600">
                {String(channel) === "whatsapp" ? "WhatsApp" : "Telegram"}
              </span>
            ))}
            {task.notification_status ? (
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${String(task.notification_status) === "sent" ? "bg-emerald-50 text-emerald-700" : String(task.notification_status) === "error" ? "bg-red-50 text-red-700" : "bg-zinc-100 text-zinc-600"}`}>
                {String(task.notification_status) === "sent" ? "Enviado" : String(task.notification_status) === "error" ? "Falha" : "Pendente"}
              </span>
            ) : null}
          </div>
          <p className="mt-2 line-clamp-3 text-sm text-zinc-600">{String(task.prompt)}</p>
          {task.notification_error ? <p className="mt-2 text-xs leading-5 text-red-600">{String(task.notification_error)}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <GhostButton onClick={() => onComplete(String(task.id))}>Concluir</GhostButton>
          <GhostButton onClick={() => onRemove(String(task.id))}><Trash2 className="h-4 w-4" /></GhostButton>
        </div>
      </div>
    </div>
  );
}

export function SettingsPageClient() {
  const [displayName, setDisplayName] = useState("");
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [telegram, setTelegram] = useState<TelegramLinkStatus | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramNotice, setTelegramNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      apiRequest<{ displayName: string; preferences: UserPreferences }>("/api/settings")
        .then((payload) => {
          setDisplayName(payload.displayName);
          setPreferences(payload.preferences);
          setTelegram({
            linked: Boolean(payload.preferences.telegramIntegration.chatId),
            chatId: payload.preferences.telegramIntegration.chatId,
            userName: payload.preferences.telegramIntegration.userName,
            linkedAt: payload.preferences.telegramIntegration.linkedAt,
            linkCode: payload.preferences.telegramIntegration.linkCode,
            linkCodeExpiresAt: payload.preferences.telegramIntegration.linkCodeExpiresAt,
          });
          void refreshTelegramLink();
          setLoading(false);
        })
        .catch((settingsError) => {
          setError(settingsError instanceof Error ? settingsError.message : "Não foi possível carregar.");
          setLoading(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const payload = await apiRequest<{ displayName: string; preferences: UserPreferences }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ displayName, preferences }),
      });
      setDisplayName(payload.displayName);
      setPreferences(payload.preferences);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshTelegramLink() {
    try {
      const payload = await apiRequest<{ telegram: TelegramLinkStatus }>("/api/telegram/link");
      setTelegram(payload.telegram);
    } catch {
      setTelegram(null);
    }
  }

  async function createTelegramCode() {
    setTelegramBusy(true);
    setTelegramNotice(null);
    try {
      const payload = await apiRequest<{ telegram: TelegramLinkStatus }>("/api/telegram/link", { method: "POST" });
      setTelegram(payload.telegram);
      setTelegramNotice("Código gerado. Envie o comando no Telegram para vincular esta conta.");
    } catch (linkError) {
      setTelegramNotice(linkError instanceof Error ? linkError.message : "Não foi possível gerar o código.");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function unlinkTelegram() {
    setTelegramBusy(true);
    setTelegramNotice(null);
    try {
      const payload = await apiRequest<{ telegram: TelegramLinkStatus }>("/api/telegram/link", { method: "DELETE" });
      setTelegram(payload.telegram);
      setPreferences({
        ...preferences,
        telegramIntegration: {
          chatId: "",
          userName: "",
          linkedAt: "",
          linkCode: "",
          linkCodeExpiresAt: "",
        },
      });
      setTelegramNotice("Telegram desvinculado desta conta.");
    } catch (linkError) {
      setTelegramNotice(linkError instanceof Error ? linkError.message : "Não foi possível desvincular.");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function copyTelegramCommand() {
    if (!telegram?.linkCode) return;
    await navigator.clipboard?.writeText(`/vincular ${telegram.linkCode}`);
    setTelegramNotice("Comando copiado.");
  }

  if (loading) {
    return (
      <div>
        <PageTitle eyebrow="Configurações" title="Instruções pessoais" description="Carregando preferências do seu agente." />
        <p className="mt-6 text-zinc-500">Carregando...</p>
      </div>
    );
  }

  return (
    <div>
      <PageTitle
        eyebrow="Configurações"
        title="Instruções pessoais"
        description="Defina como a Minha IA deve falar, pesquisar, lembrar e adaptar as respostas para seu uso real."
      />

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-950">Telegram pessoal</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">
              Vincule seu Telegram a esta conta para criar, listar, cancelar e confirmar lembretes sem misturar com o dono principal ou outros usuários.
            </p>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${telegram?.linked ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
            {telegram?.linked ? "Vinculado" : "Não vinculado"}
          </span>
        </div>

        {telegram?.linked ? (
          <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            <p className="font-semibold">Telegram conectado</p>
            <p className="mt-1 break-words">
              {telegram.userName ? `Nome: ${telegram.userName}. ` : null}
              Chat ID: {telegram.chatId}
            </p>
          </div>
        ) : null}

        {telegram?.linkCode ? (
          <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3">
            <p className="text-sm font-semibold text-zinc-900">Envie este comando no bot Minha IA:</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-white px-3 py-2 text-sm text-zinc-950">/vincular {telegram.linkCode}</code>
              <GhostButton type="button" onClick={copyTelegramCommand}>
                <Copy className="h-4 w-4" />
                Copiar
              </GhostButton>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Este código expira em {new Date(telegram.linkCodeExpiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <PrimaryButton type="button" disabled={telegramBusy} onClick={createTelegramCode}>
            {telegramBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {telegram?.linked ? "Gerar novo vínculo" : "Gerar código"}
          </PrimaryButton>
          <GhostButton type="button" disabled={telegramBusy || !telegram?.linked} onClick={unlinkTelegram}>
            Desvincular
          </GhostButton>
          <GhostButton type="button" disabled={telegramBusy} onClick={() => void refreshTelegramLink()}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </GhostButton>
        </div>
        {telegramNotice ? <p className="mt-3 text-sm text-zinc-600">{telegramNotice}</p> : null}
      </section>

      <form onSubmit={save} className="mt-6 grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5 lg:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-sm text-zinc-600">Nome exibido</span>
          <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Seu nome" />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-zinc-600">Modelo padrão</span>
          <Select value={preferences.preferredModel} onChange={(event) => setPreferences({ ...preferences, preferredModel: event.target.value })}>
            <option value="">Usar modelo do ambiente</option>
            {MODEL_PRESETS.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-2 lg:col-span-2">
          <span className="text-sm text-zinc-600">Instruções personalizadas</span>
          <TextArea
            value={preferences.customInstructions}
            onChange={(event) => setPreferences({ ...preferences, customInstructions: event.target.value })}
            placeholder="Ex: responda em português, seja prático, sempre traga links quando pesquisar, priorize soluções prontas para uso."
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-zinc-600">Sobre você</span>
          <TextArea
            value={preferences.aboutUser}
            onChange={(event) => setPreferences({ ...preferences, aboutUser: event.target.value })}
            placeholder="Seu trabalho, contexto, preferências e rotina."
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-zinc-600">Objetivos atuais</span>
          <TextArea
            value={preferences.goals}
            onChange={(event) => setPreferences({ ...preferences, goals: event.target.value })}
            placeholder="Metas, projetos e prioridades."
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-zinc-600">Estilo</span>
          <Select value={preferences.responseStyle} onChange={(event) => setPreferences({ ...preferences, responseStyle: event.target.value as UserPreferences["responseStyle"] })}>
            <option value="direto">Direto</option>
            <option value="detalhado">Detalhado</option>
            <option value="criativo">Criativo</option>
            <option value="tecnico">Técnico</option>
            <option value="executivo">Executivo</option>
          </Select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-zinc-600">Tom</span>
          <Select value={preferences.responseTone} onChange={(event) => setPreferences({ ...preferences, responseTone: event.target.value as UserPreferences["responseTone"] })}>
            <option value="profissional">Profissional</option>
            <option value="amigavel">Amigável</option>
            <option value="objetivo">Objetivo</option>
            <option value="didatico">Didático</option>
          </Select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-zinc-600">Busca na internet</span>
          <Select value={preferences.webSearchMode} onChange={(event) => setPreferences({ ...preferences, webSearchMode: event.target.value as UserPreferences["webSearchMode"] })}>
            <option value="auto">Automática</option>
            <option value="always">Sempre tentar</option>
            <option value="off">Desligada</option>
          </Select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-zinc-600">Memória</span>
          <Select value={preferences.memoryMode} onChange={(event) => setPreferences({ ...preferences, memoryMode: event.target.value as UserPreferences["memoryMode"] })}>
            <option value="auto">Aprender automaticamente</option>
            <option value="manual">Usar apenas memórias manuais</option>
            <option value="off">Não usar memória</option>
          </Select>
        </label>

        <label className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-600 lg:col-span-2">
          <input
            type="checkbox"
            checked={preferences.showModelDetails}
            onChange={(event) => setPreferences({ ...preferences, showModelDetails: event.target.checked })}
          />
          Mostrar detalhes do modelo no chat
        </label>

        {error ? <p className="text-sm text-red-600 lg:col-span-2">{error}</p> : null}
        {saved ? <p className="text-sm text-emerald-600 lg:col-span-2">Configurações salvas.</p> : null}

        <PrimaryButton disabled={saving} type="submit">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar configurações
        </PrimaryButton>
      </form>
    </div>
  );
}

