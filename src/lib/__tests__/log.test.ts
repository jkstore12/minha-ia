import { jest } from "@jest/globals";
import { createLogger, redactPII, extractOrCreateRequestId } from "@/lib/log";

// Node 22+ expõe NODE_ENV como readonly em process.env. Para testes
// precisamos trocar em runtime; cast via `any` evita o erro de tipo
// sem precisar de Object.defineProperty.
const setNodeEnv = (value: string) => {
  (process.env as Record<string, string>).NODE_ENV = value;
};
const originalNodeEnv = process.env.NODE_ENV;

describe("redactPII", () => {
  it("redacts top-level PII keys", () => {
    const result = redactPII({ chat_id: 123, message: "hello" });
    expect(result).toEqual({ chat_id: "[REDACTED]", message: "[REDACTED]" });
  });

  it("redacts nested PII keys", () => {
    const result = redactPII({
      user: { phone: "11999", name: "Alice" },
      body: { text: "secret", tokens: 5 },
    });
    // `body` em si e uma chave PII, entao o valor inteiro e redacted;
    // defense-in-depth: nao dependemos do caller descrever a estrutura
    // para que PII seja removida.
    expect(result).toEqual({
      user: { phone: "[REDACTED]", name: "Alice" },
      body: "[REDACTED]",
    });
  });

  it("redacts inside arrays", () => {
    const result = redactPII({
      messages: [{ text: "a" }, { text: "b" }, { ok: true }],
    });
    expect(result).toEqual({
      messages: [{ text: "[REDACTED]" }, { text: "[REDACTED]" }, { ok: true }],
    });
  });

  it("redacts API token-looking strings", () => {
    const result = redactPII({
      headers: { "x-api-key": "sk-or-v1-abc123", agent: "normal" },
    });
    expect(result).toEqual({
      headers: { "x-api-key": "[REDACTED]", agent: "normal" },
    });
  });

  it("is case-insensitive on key names", () => {
    const result = redactPII({ CHAT_ID: 1, Phone: "x", from: "y" });
    expect(result).toEqual({ CHAT_ID: "[REDACTED]", Phone: "[REDACTED]", from: "[REDACTED]" });
  });

  it("passes through primitives and null/undefined", () => {
    expect(redactPII(null)).toBeNull();
    expect(redactPII(undefined)).toBeUndefined();
    expect(redactPII(42)).toBe(42);
    expect(redactPII("hello")).toBe("hello");
  });

  it("does not redact similar-but-non-pii keys", () => {
    const result = redactPII({ chatIdString: "safe", userId: 1, foo: "bar" });
    expect(result).toEqual({ chatIdString: "safe", userId: 1, foo: "bar" });
  });
});

describe("createLogger", () => {
  let stdoutWrite: typeof process.stdout.write;

  beforeEach(() => {
    stdoutWrite = process.stdout.write;
    // silence logger output during tests
    process.stdout.write = jest.fn(() => true) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = stdoutWrite;
  });

  it("emits JSON in production mode", () => {
    setNodeEnv("production");
    try {
      const logger = createLogger("test-scope", "req-123");
      logger.info("hello", { foo: "bar" });
      const write = process.stdout.write as jest.Mock;
      expect(write).toHaveBeenCalled();
      const line = write.mock.calls[0]?.[0];
      expect(typeof line).toBe("string");
      const parsed = JSON.parse(line as string);
      expect(parsed).toMatchObject({
        level: "info",
        scope: "test-scope",
        request_id: "req-123",
        msg: "hello",
        meta: { foo: "bar" },
      });
    } finally {
      setNodeEnv(originalNodeEnv ?? "");
    }
  });

  it("redacts PII in metadata before emitting", () => {
    setNodeEnv("production");
    try {
      const logger = createLogger("test");
      logger.error("oops", { chat_id: 999, text: "secret", extra: "kept" });
      const write = process.stdout.write as jest.Mock;
      const parsed = JSON.parse(write.mock.calls[0]?.[0] as string);
      expect(parsed.meta).toEqual({ chat_id: "[REDACTED]", text: "[REDACTED]", extra: "kept" });
    } finally {
      setNodeEnv(originalNodeEnv ?? "");
    }
  });

  it("respects LOG_LEVEL threshold", () => {
    const originalLevel = process.env.LOG_LEVEL;
    setNodeEnv("production");
    process.env.LOG_LEVEL = "error";
    try {
      const logger = createLogger("test");
      logger.info("should be suppressed", { foo: 1 });
      const write = process.stdout.write as jest.Mock;
      expect(write).not.toHaveBeenCalled();
      logger.error("should pass", { foo: 1 });
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      setNodeEnv(originalNodeEnv ?? "");
      process.env.LOG_LEVEL = originalLevel ?? "";
    }
  });
});

describe("extractOrCreateRequestId", () => {
  it("returns the header value if present and well-formed", () => {
    const req = new Request("http://x/", { headers: { "x-request-id": "abc-123" } });
    expect(extractOrCreateRequestId(req)).toBe("abc-123");
  });

  it("generates a UUID-like id when header is missing", () => {
    const req = new Request("http://x/");
    const id = extractOrCreateRequestId(req);
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it("rejects malformed header values and generates fresh id", () => {
    const req = new Request("http://x/", { headers: { "x-request-id": "value with spaces and !@#" } });
    const id = extractOrCreateRequestId(req);
    expect(id).not.toContain(" ");
  });
});