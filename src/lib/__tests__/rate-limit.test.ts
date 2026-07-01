import { jest } from "@jest/globals";
import { consume, consumeSync, __resetForTests, __peek, __resetUpstashForTests } from "@/lib/rate-limit";

describe("rate limit (in-memory fallback)", () => {
  beforeEach(() => {
    __resetForTests();
    __resetUpstashForTests();
  });

  describe("basics", () => {
    it("first request passes via async API", async () => {
      const result = await consume("user:1", 3, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
      expect(result.limit).toBe(3);
      expect(result.backend).toBe("memory");
    });

    it("blocks when limit is reached", async () => {
      await consume("user:1", 3, 60_000);
      await consume("user:1", 3, 60_000);
      await consume("user:1", 3, 60_000);
      const blocked = await consume("user:1", 3, 60_000);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });

    it("reports remaining count", async () => {
      expect((await consume("user:1", 5, 60_000)).remaining).toBe(4);
      expect((await consume("user:1", 5, 60_000)).remaining).toBe(3);
      expect((await consume("user:1", 5, 60_000)).remaining).toBe(2);
      expect((await consume("user:1", 5, 60_000)).remaining).toBe(1);
      expect((await consume("user:1", 5, 60_000)).remaining).toBe(0);
    });
  });

  describe("isolation", () => {
    it("isolates buckets by key", async () => {
      await consume("user:1", 1, 60_000);
      await consume("user:1", 1, 60_000);

      // user:1 bloqueado, mas user:2 livre
      expect((await consume("user:1", 1, 60_000)).allowed).toBe(false);
      expect((await consume("user:2", 1, 60_000)).allowed).toBe(true);
    });

    it("handles different windows independently", async () => {
      const minResult = await consume("user:1", 1, 60_000);
      const dayResult = await consume("user:1", 100, 86_400_000);
      expect(minResult.allowed).toBe(true);
      expect(dayResult.allowed).toBe(true);
    });
  });

  describe("sliding window", () => {
    it("resets after the window passes", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-07-01T12:00:00Z"));

      await consume("user:1", 2, 60_000);
      await consume("user:1", 2, 60_000);
      expect((await consume("user:1", 2, 60_000)).allowed).toBe(false);

      // Avanca 61 segundos
      jest.setSystemTime(new Date("2026-07-01T12:01:01Z"));
      expect((await consume("user:1", 2, 60_000)).allowed).toBe(true);

      jest.useRealTimers();
    });

    it("resetMs reflects time until oldest entry expires", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-07-01T12:00:00Z"));
      await consume("user:1", 1, 60_000);
      const blocked = await consume("user:1", 1, 60_000);
      expect(blocked.allowed).toBe(false);
      // Entrada mais antiga foi adicionada agora; expira em 60s
      expect(blocked.resetMs).toBe(60_000);

      jest.setSystemTime(new Date("2026-07-01T12:00:30Z"));
      const blocked2 = await consume("user:1", 1, 60_000);
      expect(blocked2.resetMs).toBe(30_000);

      jest.useRealTimers();
    });
  });

  describe("edge cases", () => {
    it("limit 0 allows everything (rate limit disabled)", async () => {
      expect((await consume("user:1", 0, 60_000)).allowed).toBe(true);
      expect((await consume("user:1", 0, 60_000)).allowed).toBe(true);
    });

    it("handles concurrent keys without leaking between them", async () => {
      for (let i = 0; i < 100; i++) {
        await consume(`user:${i}`, 10, 60_000);
      }
      // Cada user deve ter seu proprio bucket
      expect(__peek("user:0")).toBe(1);
      expect(__peek("user:50")).toBe(1);
      expect(__peek("user:99")).toBe(1);
    });
  });

  describe("consumeSync (legacy sync path)", () => {
    it("uses in-memory backend synchronously", () => {
      const result = consumeSync("user:sync", 2, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.backend).toBe("memory");
    });
  });
});
