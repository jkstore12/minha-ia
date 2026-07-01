export const DOMAIN_OPTIONS = [
  { value: "orchestrator", label: "Orquestrador" },
  { value: "research", label: "Pesquisa" },
  { value: "analysis", label: "Análise" },
  { value: "content", label: "Conteúdo" },
  { value: "automation", label: "Automação" },
  { value: "support", label: "Suporte" },
  { value: "fallback", label: "Fallback" },
  { value: "custom", label: "Customizado" },
] as const;

export const TOOL_OPTIONS = [
  "web_search",
  "data_analysis",
  "content_generation",
  "planning",
  "summarization",
  "code_help",
  "automation_design",
  "memory_lookup",
] as const;

export const CONNECTOR_PRESETS = [
  {
    name: "OpenRouter",
    provider: "openrouter",
    base_url: "https://openrouter.ai/api/v1",
    auth_type: "bearer_token",
    credential_hint: "OPENROUTER_API_KEY",
  },
  {
    name: "OpenAI",
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    auth_type: "bearer_token",
    credential_hint: "OPENAI_API_KEY",
  },
  {
    name: "OpenAI Compatible",
    provider: "openai_compatible",
    base_url: "https://seu-provedor.example/v1",
    auth_type: "bearer_token",
    credential_hint: "AI_API_KEY",
  },
] as const;
