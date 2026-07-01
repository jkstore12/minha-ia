import { env } from "@/lib/env";

type TranscribeAudioInput = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

export type AudioTranscriptionResult = {
  text?: string;
  model?: string;
  error?: string;
};

export function hasAudioTranscription() {
  return Boolean(env.audioTranscriptionEnabled && env.audioTranscriptionApiKey);
}

export function audioFormatFromMime(mimeType: string, fileName: string) {
  const normalizedMime = mimeType.toLowerCase();
  const normalizedName = fileName.toLowerCase();

  if (normalizedMime.includes("webm") || normalizedName.endsWith(".webm")) return "webm";
  if (normalizedMime.includes("wav") || normalizedName.endsWith(".wav")) return "wav";
  if (normalizedMime.includes("ogg") || normalizedMime.includes("opus") || /\.(ogg|oga|opus)$/i.test(normalizedName)) return "ogg";
  if (normalizedMime.includes("m4a") || normalizedName.endsWith(".m4a")) return "m4a";
  if (normalizedMime.includes("mp4") || normalizedName.endsWith(".mp4")) return "mp4";
  if (normalizedMime.includes("mpeg") || normalizedMime.includes("mp3") || /\.(mp3|mpeg|mpga)$/i.test(normalizedName)) return "mp3";
  return "webm";
}

export function usesOpenRouterTranscriptionEndpoint() {
  return env.audioTranscriptionBaseUrl?.includes("openrouter.ai");
}

export async function transcribeAudio(input: TranscribeAudioInput): Promise<AudioTranscriptionResult> {
  if (!env.audioTranscriptionEnabled) {
    return { error: "Transcrição de áudio desativada." };
  }

  if (!env.audioTranscriptionApiKey) {
    return { error: "Transcrição de áudio não configurada. Defina AUDIO_TRANSCRIPTION_API_KEY ou OPENROUTER_API_KEY." };
  }

  try {
    if (usesOpenRouterTranscriptionEndpoint()) {
      const response = await fetch(`${env.audioTranscriptionBaseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.audioTranscriptionApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.appUrl,
          "X-Title": env.appName,
        },
        body: JSON.stringify({
          input_audio: {
            data: input.buffer.toString("base64"),
            format: audioFormatFromMime(input.mimeType, input.fileName),
          },
          model: env.audioTranscriptionModel,
          language: "pt",
        }),
      });

      const payload = (await response.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;

      if (!response.ok) {
        return {
          model: env.audioTranscriptionModel,
          error: payload?.error?.message || "Falha ao transcrever o áudio.",
        };
      }

      const text = String(payload?.text || "").trim();
      return {
        text: text || undefined,
        model: env.audioTranscriptionModel,
        error: text ? undefined : "A transcrição voltou vazia.",
      };
    }

    const formData = new FormData();
    const bytes = new Uint8Array(input.buffer.length);
    bytes.set(input.buffer);
    const blob = new Blob([bytes], { type: input.mimeType || "application/octet-stream" });
    formData.append("file", blob, input.fileName);
    formData.append("model", env.audioTranscriptionModel);
    formData.append("language", "pt");
    formData.append("response_format", "json");
    formData.append("prompt", "Transcreva em português do Brasil quando o áudio estiver em português. Preserve nomes, números, datas e pedidos de lembrete.");

    const headers: Record<string, string> = {
      Authorization: `Bearer ${env.audioTranscriptionApiKey}`,
      "HTTP-Referer": env.appUrl,
      "X-Title": env.appName,
    };

    const response = await fetch(`${env.audioTranscriptionBaseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers,
      body: formData,
    });

    const payload = (await response.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;

    if (!response.ok) {
      return {
        model: env.audioTranscriptionModel,
        error: payload?.error?.message || "Falha ao transcrever o áudio.",
      };
    }

    const text = String(payload?.text || "").trim();
    return {
      text: text || undefined,
      model: env.audioTranscriptionModel,
      error: text ? undefined : "A transcrição voltou vazia.",
    };
  } catch (error) {
    return {
      model: env.audioTranscriptionModel,
      error: error instanceof Error ? error.message : "Falha desconhecida ao transcrever áudio.",
    };
  }
}
