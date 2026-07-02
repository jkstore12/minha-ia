import { jest } from "@jest/globals";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

async function loadModule() {
  jest.resetModules();
  return import("@/lib/cron-auth");
}

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost/api/cron/reminders", { method: "GET", headers });
}

describe("isCronAuthorized", () => {
  it("returns false when CRON_SECRET is not set (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const { isCronAuthorized } = await loadModule();
    expect(isCronAuthorized(makeRequest("Bearer anything"))).toBe(false);
  });

  it("returns false when no Authorization header", async () => {
    process.env.CRON_SECRET = "supersecret";
    const { isCronAuthorized } = await loadModule();
    expect(isCronAuthorized(makeRequest())).toBe(false);
  });

  it("returns true with correct Bearer token", async () => {
    process.env.CRON_SECRET = "supersecret";
    const { isCronAuthorized } = await loadModule();
    expect(isCronAuthorized(makeRequest("Bearer supersecret"))).toBe(true);
  });

  it("returns false with wrong Bearer token", async () => {
    process.env.CRON_SECRET = "supersecret";
    const { isCronAuthorized } = await loadModule();
    expect(isCronAuthorized(makeRequest("Bearer wrongtoken"))).toBe(false);
  });

  it("returns false with empty Authorization header", async () => {
    process.env.CRON_SECRET = "supersecret";
    const { isCronAuthorized } = await loadModule();
    expect(isCronAuthorized(makeRequest(""))).toBe(false);
  });

  it("returns false when token length differs (timingSafeEqual guard)", async () => {
    process.env.CRON_SECRET = "supersecret";
    const { isCronAuthorized } = await loadModule();
    expect(isCronAuthorized(makeRequest("Bearer super"))).toBe(false);
    expect(isCronAuthorized(makeRequest("Bearer supersecretlong"))).toBe(false);
  });

  it("returns false with malformed Authorization (no Bearer prefix)", async () => {
    process.env.CRON_SECRET = "supersecret";
    const { isCronAuthorized } = await loadModule();
    expect(isCronAuthorized(makeRequest("supersecret"))).toBe(false);
    expect(isCronAuthorized(makeRequest("Basic supersecret"))).toBe(false);
  });

  it("returns false when token differs by case (Bearer SUPERSECRET)", async () => {
    process.env.CRON_SECRET = "supersecret";
    const { isCronAuthorized } = await loadModule();
    // timingSafeEqual considera bytes; case-sensitivity importa.
    expect(isCronAuthorized(makeRequest("Bearer SUPERSECRET"))).toBe(false);
  });
});