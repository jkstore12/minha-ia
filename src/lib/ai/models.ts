/**
 * Resolucao de modelos e cadeias de fallback.
 *
 * Funcoes puras (com dependencia de env) que decidem qual modelo usar
 * em cada chamada. Extraidas de brain.ts para serem testaveis.
 */

import { env, requireAiEnv } from "@/lib/env";

/**
 * Aplica o sufixo `:online` para ativar web search via OpenRouter.
 * Idempotente: nao duplica o sufixo se ja estiver presente.
 */
export function withOpenRouterWebSearch(model: string): string {
  if (model.endsWith(":online")) return model;
  return `${model}:online`;
}

/**
 * Resolve qual modelo sera usado na request, considerando o modelo
 * pedido pelo usuario (ou o default), a flag de web search, e se o
 * provider suporta web search via suffix.
 */
export function resolveRuntimeModel(model: string | undefined, webSearch?: boolean): string {
  const ai = requireAiEnv();
  const selectedModel = model || ai.model;

  if (webSearch && env.webSearchEnabled && ai.provider === "openrouter") {
    return withOpenRouterWebSearch(selectedModel);
  }

  return selectedModel;
}

const DEFAULT_OPENROUTER_FALLBACKS = [
  "openai/gpt-chat-latest",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-flash:free",
];

/**
 * Retorna a lista ordenada de modelos a tentar (request + fallbacks),
 * com sufixo `:online` aplicado se webSearch estiver ativo. Remove
 * duplicatas.
 */
export function resolveModelCandidates(model: string | undefined, webSearch?: boolean): string[] {
  const ai = requireAiEnv();
  const requestedModel = model || ai.model;
  const fallbackModels = ai.fallbackModels.length
    ? ai.fallbackModels
    : ai.provider === "openrouter"
      ? DEFAULT_OPENROUTER_FALLBACKS
      : [ai.model];

  return [...new Set([requestedModel, ...fallbackModels])].map((candidate) =>
    resolveRuntimeModel(candidate, webSearch),
  );
}
