import type { AiProvider } from "@/lib/env";

export type ModelPreset = {
  id: string;
  label: string;
  provider: AiProvider;
  description: string;
};

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "gpt-5.4-mini",
    label: "OpenAI GPT-5.4 Mini",
    provider: "openai",
    description: "Padrao rapido e economico para uso geral.",
  },
  {
    id: "gpt-5.4",
    label: "OpenAI GPT-5.4",
    provider: "openai",
    description: "Mais forte para raciocinio e trabalho complexo.",
  },
  {
    id: "gpt-5.5",
    label: "OpenAI GPT-5.5",
    provider: "openai",
    description: "Modelo OpenAI mais forte para raciocinio, análise e trabalho profissional.",
  },
  {
    id: "openai/gpt-chat-latest",
    label: "OpenRouter: GPT Chat Latest",
    provider: "openrouter",
    description: "Alias OpenAI via OpenRouter para chat geral.",
  },
  {
    id: "openai/gpt-4o",
    label: "OpenRouter: GPT-4o",
    provider: "openrouter",
    description: "Modelo múltimodal com visao para analisar imagens, fotos, textos visuais e tarefas gerais.",
  },
  {
    id: "openai/gpt-5.5",
    label: "OpenRouter: GPT-5.5",
    provider: "openrouter",
    description: "GPT-5.5 via OpenRouter para raciocinio forte, escrita e análise complexa.",
  },
  {
    id: "deepseek/deepseek-v4-flash:free",
    label: "OpenRouter: DeepSeek V4 Flash Gratis",
    provider: "openrouter",
    description: "DeepSeek V4 Flash sem custo via OpenRouter, ideal para testes e uso economico.",
  },
  {
    id: "deepseek/deepseek-v4-flash",
    label: "OpenRouter: DeepSeek V4 Flash Pago",
    provider: "openrouter",
    description: "DeepSeek V4 Flash pago, rapido e barato para chat, pesquisa e produtividade.",
  },
  {
    id: "deepseek/deepseek-v4-pro",
    label: "OpenRouter: DeepSeek V4 Pro",
    provider: "openrouter",
    description: "DeepSeek premium com contexto grande para análise, planejamento e trabalho pesado.",
  },
  {
    id: "deepseek/deepseek-v3.2",
    label: "OpenRouter: DeepSeek V3.2",
    provider: "openrouter",
    description: "Modelo DeepSeek forte e economico para tarefas gerais e raciocinio.",
  },
  {
    id: "deepseek/deepseek-r1",
    label: "OpenRouter: DeepSeek R1",
    provider: "openrouter",
    description: "Modelo DeepSeek focado em raciocinio, matematica, codigo e decisões complexas.",
  },
  {
    id: "anthropic/claude-opus-4.7-fast",
    label: "OpenRouter: Claude Opus 4.7 Fast",
    provider: "openrouter",
    description: "Claude Opus 4.7 em rota fast, premium para respostas de alta qualidade com menor latencia.",
  },
  {
    id: "anthropic/claude-opus-4.7",
    label: "OpenRouter: Claude Opus 4.7",
    provider: "openrouter",
    description: "Claude Opus 4.7 completo para análise profunda, planejamento e escrita exigente.",
  },
  {
    id: "~anthropic/claude-sonnet-latest",
    label: "OpenRouter: Claude Sonnet Latest",
    provider: "openrouter",
    description: "Alias Sonnet mais recente via OpenRouter, bom equilibrio entre qualidade e custo.",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "OpenRouter: Claude Sonnet 4.6",
    provider: "openrouter",
    description: "Claude Sonnet 4.6 para produtividade, codigo, escrita e análise profissional.",
  },
  {
    id: "~anthropic/claude-haiku-latest",
    label: "OpenRouter: Claude Haiku Latest",
    provider: "openrouter",
    description: "Claude Haiku mais recente para respostas rapidas e economicas.",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "OpenRouter: Claude Haiku 4.5",
    provider: "openrouter",
    description: "Claude Haiku 4.5 para tarefas leves, triagem e uso com menor custo.",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    label: "OpenRouter: Gemini 3.1 Flash Lite",
    provider: "openrouter",
    description: "Modelo rapido com contexto grande.",
  },
  {
    id: "google/gemini-3.1-flash-lite-preview",
    label: "OpenRouter: Gemini 3.1 Flash Lite Preview",
    provider: "openrouter",
    description: "Opção Gemini rapida para respostas baratas com contexto muito grande.",
  },
  {
    id: "qwen/qwen3.6-flash",
    label: "OpenRouter: Qwen3.6 Flash",
    provider: "openrouter",
    description: "Qwen rapido, barato e com contexto amplo para produtividade diaria.",
  },
  {
    id: "qwen/qwen3.6-27b",
    label: "OpenRouter: Qwen3.6 27B",
    provider: "openrouter",
    description: "Qwen3.6 27B para raciocinio geral, escrita e tarefas com bom equilibrio de custo.",
  },
  {
    id: "inclusionai/ling-2.6-1t",
    label: "OpenRouter: Ling 2.6 1T",
    provider: "openrouter",
    description: "Ling 2.6 1T da inclusionAI para raciocinio e tarefas gerais com modelo grande.",
  },
  {
    id: "inclusionai/ring-2.6-1t",
    label: "OpenRouter: Ring 2.6 1T",
    provider: "openrouter",
    description: "Ring 2.6 1T da inclusionAI, alternativa eficiente para chat, análise e produtividade.",
  },
  {
    id: "inclusionai/ling-2.6-flash",
    label: "OpenRouter: Ling 2.6 Flash",
    provider: "openrouter",
    description: "Ling 2.6 Flash, modelo muito economico para respostas rapidas.",
  },
  {
    id: "qwen/qwen3.5-flash-02-23",
    label: "OpenRouter: Qwen3.5 Flash",
    provider: "openrouter",
    description: "Alternativa muito economica para chat rapido, resumos e tarefas simples.",
  },
  {
    id: "qwen/qwen3-coder-flash",
    label: "OpenRouter: Qwen3 Coder Flash",
    provider: "openrouter",
    description: "Modelo rapido para codigo, debugging e tarefas tecnicas.",
  },
  {
    id: "moonshotai/kimi-k2.6",
    label: "OpenRouter: Kimi K2.6",
    provider: "openrouter",
    description: "Modelo forte para escrita longa, análise e contexto extenso.",
  },
  {
    id: "z-ai/glm-4.5-air:free",
    label: "OpenRouter: GLM 4.5 Air Gratis",
    provider: "openrouter",
    description: "Modelo gratuito útil para testes e conversas gerais.",
  },
  {
    id: "z-ai/glm-5.1",
    label: "OpenRouter: GLM 5.1",
    provider: "openrouter",
    description: "Modelo Z.ai recente para raciocinio, escrita e tarefas gerais.",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    label: "OpenRouter: Llama 3.3 70B Gratis",
    provider: "openrouter",
    description: "Opção gratuita da Meta para chat e tarefas gerais.",
  },
  {
    id: "x-ai/grok-4.3",
    label: "OpenRouter: Grok 4.3",
    provider: "openrouter",
    description: "Modelo de raciocinio para tarefas gerais.",
  },
  {
    id: "mistralai/mistral-medium-3-5",
    label: "OpenRouter: Mistral Medium 3.5",
    provider: "openrouter",
    description: "Bom equilibrio para produtividade e codigo.",
  },
  {
    id: "openrouter/owl-alpha",
    label: "OpenRouter: Owl Alpha",
    provider: "openrouter",
    description: "Opção experimental para fluxos agenticos.",
  },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    label: "OpenRouter: Nemotron 3 Nano Free",
    provider: "openrouter",
    description: "Opção gratuita para testes iniciais.",
  },
];

export function getModelOptions(provider: AiProvider, configuredModel: string) {
  const presets = MODEL_PRESETS.filter((preset) => preset.provider === provider);

  if (!presets.some((preset) => preset.id === configuredModel)) {
    return [
      {
        id: configuredModel,
        label: `Configurado: ${configuredModel}`,
        provider,
        description: "Modelo definido em AI_MODEL.",
      },
      ...presets,
    ];
  }

  return presets;
}
