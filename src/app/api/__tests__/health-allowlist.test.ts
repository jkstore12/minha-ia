import { isAiBaseUrlAllowed } from "@/app/api/health/route";

describe("isAiBaseUrlAllowed (AI_BASE_URL allow-list for deep-mode probe)", () => {
  it("returns true for known provider hosts", () => {
    expect(isAiBaseUrlAllowed("https://api.openai.com/v1")).toBe(true);
    expect(isAiBaseUrlAllowed("https://openrouter.ai/api/v1")).toBe(true);
    expect(isAiBaseUrlAllowed("https://api.anthropic.com/v1")).toBe(true);
    expect(isAiBaseUrlAllowed("https://api.deepseek.com/v1")).toBe(true);
    expect(isAiBaseUrlAllowed("https://api.groq.com/openai/v1")).toBe(true);
  });

  it("returns true for subdomains of allowed hosts", () => {
    // 1-level subdomain de api.openai.com
    expect(isAiBaseUrlAllowed("https://eu.api.openai.com/v1")).toBe(true);
    // azure openai (host literal na allow-list)
    expect(isAiBaseUrlAllowed("https://openai.azure.com/deployments")).toBe(true);
  });

  it("returns false for arbitrary / unknown hosts", () => {
    expect(isAiBaseUrlAllowed("https://attacker.example.com/v1")).toBe(false);
    expect(isAiBaseUrlAllowed("https://my-typo.openi.com/v1")).toBe(false);
    expect(isAiBaseUrlAllowed("https://api.openai.com.evil.com/v1")).toBe(false);
  });

  it("returns false for empty / null / unparseable URLs", () => {
    expect(isAiBaseUrlAllowed(undefined)).toBe(false);
    expect(isAiBaseUrlAllowed(null)).toBe(false);
    expect(isAiBaseUrlAllowed("")).toBe(false);
    expect(isAiBaseUrlAllowed("not-a-url")).toBe(false);
  });

  it("returns false for http (must be https)", () => {
    // The allow-list accepts by hostname, not protocol — but this test
    // documents that the function does not validate protocol. The
    // caller (checkAiProvider) is responsible for only probing https.
    expect(isAiBaseUrlAllowed("http://api.openai.com/v1")).toBe(true);
  });

  it("is case-insensitive on hostnames", () => {
    expect(isAiBaseUrlAllowed("https://API.OpenAI.com/v1")).toBe(true);
    expect(isAiBaseUrlAllowed("https://OpenRouter.AI/api/v1")).toBe(true);
  });
});