import { jest } from "@jest/globals";
// usesOpenRouterTranscriptionEndpoint e usado via dynamic import dentro
// de isolateModulesAsync; o ESLint nao rastreia isso, entao silenciamos
// o warning de "unused import".
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { audioFormatFromMime, usesOpenRouterTranscriptionEndpoint, hasAudioTranscription } from "@/lib/ai/audio";

describe("audioFormatFromMime", () => {
  it.each([
    ["audio/webm", "recording.webm", "webm"],
    ["audio/webm;codecs=opus", "x", "webm"],
    ["audio/wav", "audio.wav", "wav"],
    ["audio/x-wav", "x", "wav"],
    ["audio/ogg", "x.ogg", "ogg"],
    ["audio/ogg;codecs=opus", "x", "ogg"],
    ["audio/opus", "x.opus", "ogg"],
    ["audio/mp4", "x.m4a", "m4a"],
    ["audio/m4a", "x", "m4a"],
    ["audio/mp4", "audio.mp4", "mp4"],
    ["audio/mpeg", "audio.mp3", "mp3"],
    ["audio/mp3", "x.mp3", "mp3"],
    ["audio/mpeg", "x.mpeg", "mp3"],
  ])("maps %s + %s to %s", (mime, fileName, expected) => {
    expect(audioFormatFromMime(mime, fileName)).toBe(expected);
  });

  it("falls back to webm for unknown mime and filename", () => {
    expect(audioFormatFromMime("application/octet-stream", "random.bin")).toBe("webm");
  });

  it("is case-insensitive on filename", () => {
    expect(audioFormatFromMime("audio/x-wav", "AUDIO.WAV")).toBe("wav");
  });
});

describe("usesOpenRouterTranscriptionEndpoint", () => {
  const originalUrl = process.env.AUDIO_TRANSCRIPTION_BASE_URL;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.AUDIO_TRANSCRIPTION_BASE_URL;
    } else {
      process.env.AUDIO_TRANSCRIPTION_BASE_URL = originalUrl;
    }
  });

  async function loadFresh(): Promise<() => boolean> {
    let result: () => boolean = () => false;
    await jest.isolateModulesAsync(async () => {
      // Import dinamico dentro do isolateModules garante que o `env`
      // seja lido novamente das process.env
      const mod = await import("@/lib/ai/audio");
      result = mod.usesOpenRouterTranscriptionEndpoint;
    });
    return result;
  }

  it("returns true when base url points to openrouter.ai", async () => {
    process.env.AUDIO_TRANSCRIPTION_BASE_URL = "https://openrouter.ai/api/v1";
    const fn = await loadFresh();
    expect(fn()).toBe(true);
  });

  it("returns false for other providers", async () => {
    process.env.AUDIO_TRANSCRIPTION_BASE_URL = "https://api.openai.com/v1";
    const fn = await loadFresh();
    expect(fn()).toBe(false);
  });
});

describe("hasAudioTranscription", () => {
  // Estes testes verificam apenas a logica booleana basica; a funcao
  // le env vars via env helper. Cobertura completa exigiria mockar
  // @/lib/env. Considerar mock no futuro.
  it("existe como funcao e retorna boolean", () => {
    expect(typeof hasAudioTranscription).toBe("function");
    const result = hasAudioTranscription();
    expect(typeof result).toBe("boolean");
  });
});
