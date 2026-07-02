import { adaptVercelHandler, type VercelHandler } from "@/lib/api/webhook-adapter";

describe("adaptVercelHandler", () => {
  it("translates a (req, res) handler to a Next.js Response", async () => {
    const handler: VercelHandler = (req, res) => {
      res.status(201).setHeader("x-custom", "value").json({ ok: true, method: req.method });
    };
    const adapted = adaptVercelHandler(handler);
    const response = await adapted(new Request("http://x/", { method: "POST" }));
    expect(response.status).toBe(201);
    expect(response.headers.get("x-custom")).toBe("value");
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    expect(body).toEqual({ ok: true, method: "POST" });
  });

  it("parses JSON body and exposes it on req.body", async () => {
    let captured: { body: unknown; method: string } | null = null;
    const handler: VercelHandler = (req, res) => {
      captured = { body: req.body, method: req.method };
      res.json({ received: true });
    };
    const adapted = adaptVercelHandler(handler);
    await adapted(
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    expect(captured).toEqual({ body: { message: "hello" }, method: "POST" });
  });

  it("parses query string and exposes it on req.query", async () => {
    let capturedQuery: Record<string, string> | null = null;
    const handler: VercelHandler = (req, res) => {
      capturedQuery = req.query as Record<string, string>;
      res.json({ ok: true });
    };
    const adapted = adaptVercelHandler(handler);
    await adapted(new Request("http://x/?secret=abc&other=def", { method: "GET" }));
    expect(capturedQuery).toEqual({ secret: "abc", other: "def" });
  });

  it("lowercases header names on req.headers", async () => {
    let captured: VercelHandler extends (req: infer R) => unknown ? (R extends { headers: infer H } ? H : never) : never = null as never;
    const handler: VercelHandler = (req, res) => {
      captured = req.headers as never;
      res.json({ ok: true });
    };
    const adapted = adaptVercelHandler(handler);
    await adapted(
      new Request("http://x/", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "t0p" } }),
    );
    expect((captured as Record<string, string>)["x-telegram-bot-api-secret-token"]).toBe("t0p");
  });

  it("returns 200 with empty body when handler calls end() without json/text", async () => {
    const handler: VercelHandler = (_req, res) => {
      res.status(202).end();
    };
    const adapted = adaptVercelHandler(handler);
    const response = await adapted(new Request("http://x/", { method: "POST" }));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("catches handler errors and returns 500 with error envelope", async () => {
    const handler: VercelHandler = () => {
      throw new Error("kaboom");
    };
    const adapted = adaptVercelHandler(handler);
    const response = await adapted(new Request("http://x/", { method: "POST" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, error: "webhook_error" });
  });

  it("does not call handler body parsing for GET requests (body is undefined)", async () => {
    let captured: unknown = "not-set";
    const handler: VercelHandler = (req, res) => {
      captured = req.body;
      res.json({ ok: true });
    };
    const adapted = adaptVercelHandler(handler);
    await adapted(new Request("http://x/", { method: "GET" }));
    expect(captured).toBeUndefined();
  });

  it("passes through multiple setHeader calls (last wins)", async () => {
    const handler: VercelHandler = (_req, res) => {
      res.setHeader("x-test", "first");
      res.setHeader("x-test", "second");
      res.json({ ok: true });
    };
    const adapted = adaptVercelHandler(handler);
    const response = await adapted(new Request("http://x/", { method: "POST" }));
    expect(response.headers.get("x-test")).toBe("second");
  });

  it("uses setHeaders to set multiple headers at once", async () => {
    const handler: VercelHandler = (_req, res) => {
      res.setHeaders({ "x-a": "1", "x-b": "2" });
      res.json({ ok: true });
    };
    const adapted = adaptVercelHandler(handler);
    const response = await adapted(new Request("http://x/", { method: "POST" }));
    expect(response.headers.get("x-a")).toBe("1");
    expect(response.headers.get("x-b")).toBe("2");
  });
});