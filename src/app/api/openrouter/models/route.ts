import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getApiContext, jsonError, withRequestIdHeader } from "@/lib/api/server";

export const runtime = "nodejs";
export const revalidate = 3600;

type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
    tokenizer?: string;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
  };
  supported_parameters?: string[];
};

function normalizeModelId(id: string) {
  return id.replace(/:online$/, "");
}

export async function GET(request: Request) {
  const { requestId } = getApiContext(request, "openrouter-models");

  if (env.aiProvider !== "openrouter") {
    return withRequestIdHeader(
      NextResponse.json({ data: [], provider: env.aiProvider }),
      requestId,
    );
  }

  const url = new URL(request.url);
  const ids = new Set(
    (url.searchParams.get("ids") || "")
      .split(",")
      .map((id) => normalizeModelId(id.trim()))
      .filter(Boolean),
  );

  const headers: Record<string, string> = {
    "HTTP-Referer": env.appUrl,
    "X-Title": env.appName,
  };

  if (env.aiApiKey) {
    headers.Authorization = `Bearer ${env.aiApiKey}`;
  }

  const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=text", {
    headers,
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    return jsonError("Não foi possível carregar modelos do OpenRouter.", {
      status: 502,
      requestId,
      code: "upstream_error",
      details: { upstreamStatus: response.status },
    });
  }

  const payload = (await response.json()) as { data?: OpenRouterModel[] };
  const models = (payload.data || [])
    .filter((model) => ids.size === 0 || ids.has(model.id))
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description || "",
      created: model.created || null,
      contextLength: model.context_length || null,
      inputModalities: model.architecture?.input_modalities || [],
      outputModalities: model.architecture?.output_modalities || [],
      modality: model.architecture?.modality || null,
      tokenizer: model.architecture?.tokenizer || null,
      pricing: {
        prompt: model.pricing?.prompt || null,
        completion: model.pricing?.completion || null,
        request: model.pricing?.request || null,
      },
      supportedParameters: model.supported_parameters || [],
    }));

  return withRequestIdHeader(
    NextResponse.json({
      provider: "openrouter",
      count: payload.data?.length || 0,
      data: models,
    }),
    requestId,
  );
}
