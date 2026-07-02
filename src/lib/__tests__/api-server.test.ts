import {
  jsonError,
  jsonResult,
  getApiContext,
  withRequestIdHeader,
  withRequestIdOnResponse,
} from "@/lib/api/server";

describe("jsonError", () => {
  it("returns { error: message } with default status 400", async () => {
    const res = jsonError("bad input");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "bad input" });
  });

  it("accepts custom status", async () => {
    const res = jsonError("not found", { status: 404 });
    expect(res.status).toBe(404);
  });

  it("includes code when provided", async () => {
    const res = jsonError("auth expired", { status: 401, code: "auth_expired" });
    const body = await res.json();
    expect(body).toMatchObject({ error: "auth expired", code: "auth_expired" });
  });

  it("includes requestId in body and header when provided", async () => {
    const res = jsonError("oops", { status: 500, requestId: "req-123" });
    const body = await res.json();
    expect(body).toMatchObject({ error: "oops", requestId: "req-123" });
    expect(res.headers.get("x-request-id")).toBe("req-123");
  });

  it("includes details when provided", async () => {
    const res = jsonError("validation failed", {
      status: 422,
      code: "validation_failed",
      details: { field: "email", issue: "invalid" },
    });
    const body = await res.json();
    expect(body).toMatchObject({
      error: "validation failed",
      code: "validation_failed",
      details: { field: "email", issue: "invalid" },
    });
  });

  it("does NOT set x-request-id header when requestId is omitted", async () => {
    const res = jsonError("plain");
    expect(res.headers.get("x-request-id")).toBeNull();
  });

  it("does NOT include requestId in body when omitted", async () => {
    const res = jsonError("plain");
    const body = await res.json();
    expect(body).not.toHaveProperty("requestId");
  });
});

describe("jsonResult", () => {
  it("returns { ok: true, ...body } by default", async () => {
    const res = jsonResult(true, { count: 3, processed: [] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, count: 3, processed: [] });
  });

  it("returns { ok: false, ...body } with custom status", async () => {
    const res = jsonResult(false, { error: "denied" }, { status: 403 });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "denied" });
  });

  it("sets x-request-id header when provided", () => {
    const res = jsonResult(true, {}, { requestId: "req-456" });
    expect(res.headers.get("x-request-id")).toBe("req-456");
  });
});

describe("getApiContext", () => {
  it("extracts requestId from x-request-id header", () => {
    const req = new Request("http://x/", { headers: { "x-request-id": "abc-789" } });
    const ctx = getApiContext(req, "test-scope");
    expect(ctx.requestId).toBe("abc-789");
    expect(ctx.logger).toBeDefined();
  });

  it("generates a requestId when header is missing", () => {
    const req = new Request("http://x/");
    const ctx = getApiContext(req, "test-scope");
    expect(ctx.requestId).toBeTruthy();
    expect(ctx.requestId.length).toBeGreaterThanOrEqual(8);
  });

  it("returns a logger bound to the requestId", () => {
    const req = new Request("http://x/", { headers: { "x-request-id": "xyz" } });
    const ctx = getApiContext(req, "my-route");
    expect(ctx.logger).toBeDefined();
    expect(typeof ctx.logger.info).toBe("function");
  });
});

describe("withRequestIdHeader", () => {
  it("sets x-request-id on a NextResponse", async () => {
    const { NextResponse } = await import("next/server");
    const res = withRequestIdHeader(NextResponse.json({ ok: true }), "req-abc");
    expect(res.headers.get("x-request-id")).toBe("req-abc");
  });
});

describe("withRequestIdOnResponse", () => {
  it("sets x-request-id on a generic Response", () => {
    const res = withRequestIdOnResponse(new Response("body"), "req-def");
    expect(res.headers.get("x-request-id")).toBe("req-def");
  });
});

describe("backward compat with positional arg", () => {
  it("jsonError(message, status) legacy call still works", async () => {
    // A segunda assinatura antiga era jsonError(message, status).
    // Vamos garantir que callsites que ainda usam o segundo arg nao quebram.
    const res = jsonError("legacy", 404);
    expect(res.status).toBe(404);
  });
});