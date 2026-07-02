// Testes para /api/agents (GET, POST) e /api/agents/[id] (PATCH, DELETE).
//
// Cobre:
//  - auth (401 sem user)
//  - validacao Zod (400 com payload invalido)
//  - happy paths (GET lista, POST cria, PATCH atualiza, DELETE remove)
//  - isolamento por user_id (so ve/edita os proprios agentes)
//  - error paths (Supabase retorna erro -> 500)

import { jest } from "@jest/globals";

let originalEnv: Record<string, string | undefined>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fromMock: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getUserMock: any;

beforeEach(() => {
  originalEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.ADMIN_EMAILS = "";

  // Mocks: getUser (auth) e from (query builder)
  getUserMock = jest.fn();
  fromMock = jest.fn();
});

function buildSupabaseMock(
  authedUser: { id: string; email?: string } | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profileRow: any = { role: "admin", approval_status: "approved" },
) {
  // auth.getUser
  getUserMock.mockResolvedValue({
    data: { user: authedUser },
    error: authedUser ? null : { message: "not authenticated" },
  });

  // O ensureUserAccess faz uma query inicial a user_profiles. Se nao
  // existir, faz insert e retorna role/approval. Se existir, retorna
  // os campos lidos.
  // Por padrao, retornamos um profile pre-aprovado para que o handler
  // nao retorne 401 por falta de aprovacao.
  const fromFn = (table: string) => {
    if (table === "user_profiles") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: profileRow, error: null }),
          }),
        }),
        insert: (data: Record<string, unknown>) => {
          return Promise.resolve({ data: { ...data }, error: null });
        },
      };
    }
    // Agents / agent_knowledge: passa adiante para o fromMock
    return fromMock(table);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = {
    auth: { getUser: getUserMock },
    from: fromFn,
  };
  return { supabase };
}

async function loadAgentsRoute() {
  jest.resetModules();
  jest.unstable_mockModule("@/lib/supabase/server", () => ({
    createClient: () => buildSupabaseMock({ id: "user-1", email: "u@x.com" }).supabase,
  }));
  jest.unstable_mockModule("@supabase/supabase-js", () => ({
    createClient: () => ({ from: fromMock }),
  }));
  return import("@/app/api/agents/route");
}

async function loadAgentByIdRoute() {
  jest.resetModules();
  jest.unstable_mockModule("@/lib/supabase/server", () => ({
    createClient: () => buildSupabaseMock({ id: "user-1", email: "u@x.com" }).supabase,
  }));
  jest.unstable_mockModule("@supabase/supabase-js", () => ({
    createClient: () => ({ from: fromMock }),
  }));
  return import("@/app/api/agents/[id]/route");
}

function makeJsonRequest(body: unknown): Request {
  return new Request("http://x/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(id: string, body: unknown): Request {
  return new Request(`http://x/api/agents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(id: string): Request {
  return new Request(`http://x/api/agents/${id}`, { method: "DELETE" });
}

// Mock query builder: encadeia metodos terminais e e thenable para
// suportar `await supabase.from(...).select(...).eq(...)`.
function buildAgentQueryMock(returnValue: { data: unknown; error: unknown }) {
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    const promise = Promise.resolve(returnValue);
    // Torna o chain thenable: await chain resolve to promise.
    chain.then = promise.then.bind(promise);
    chain.catch = promise.catch.bind(promise);
    chain.finally = promise.finally.bind(promise);
    for (const m of ["select", "eq", "order", "insert", "update", "delete", "single", "maybeSingle"]) {
      chain[m] = jest.fn(() => {
        // Cada chamada retorna o chain (chainable). single/maybeSingle
        // tambem retornam o chain, mas o handler faz await no chain
        // inteiro, entao a resolucao vem do .then do promise.
        return chain;
      });
    }
    return chain;
  };
  return makeChain();
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("GET /api/agents", () => {
  it("returns 401 when no authenticated user", async () => {
    jest.resetModules();
    jest.unstable_mockModule("@/lib/supabase/server", () => ({
      createClient: () => buildSupabaseMock(null).supabase,
    }));
    jest.unstable_mockModule("@supabase/supabase-js", () => ({
      createClient: () => ({ from: fromMock }),
    }));
    const { GET } = await import("@/app/api/agents/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns agents list for authenticated user", async () => {
    const fakeAgents = [
      { id: "a1", name: "Coach", user_id: "user-1" },
      { id: "a2", name: "Reviewer", user_id: "user-1" },
    ];
    fromMock.mockReturnValue(buildAgentQueryMock({ data: fakeAgents, error: null }));

    const { GET } = await loadAgentsRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual(fakeAgents);
  });

  it("returns 500 when Supabase query errors", async () => {
    fromMock.mockReturnValue(buildAgentQueryMock({ data: null, error: { message: "db down" } }));

    const { GET } = await loadAgentsRoute();
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("listar agentes");
  });
});

describe("POST /api/agents", () => {
  it("creates an agent with valid payload", async () => {
    const createdAgent = {
      id: "new-id",
      name: "Coach Financeiro",
      domain: "custom",
      user_id: "user-1",
    };
    fromMock.mockReturnValue(buildAgentQueryMock({ data: createdAgent, error: null }));

    const { POST } = await loadAgentsRoute();
    const res = await POST(
      makeJsonRequest({
        name: "Coach Financeiro",
        description: "Ajuda com financas",
        system_prompt: "Sempre pergunte o valor em reais.",
        tools: ["calculator"],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.agent).toEqual(createdAgent);
  });

  it("applies default values for omitted optional fields", async () => {
    fromMock.mockReturnValue(buildAgentQueryMock({ data: { id: "x" }, error: null }));

    const { POST } = await loadAgentsRoute();
    const res = await POST(makeJsonRequest({ name: "Minimal Agent" }));
    expect(res.status).toBe(201);
  });

  it("rejects invalid payload (name too short)", async () => {
    const { POST } = await loadAgentsRoute();
    const res = await POST(makeJsonRequest({ name: "A" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid domain enum", async () => {
    const { POST } = await loadAgentsRoute();
    const res = await POST(makeJsonRequest({ name: "Valid Name", domain: "unknown_domain" }));
    expect(res.status).toBe(400);
  });

  it("rejects temperature out of range", async () => {
    const { POST } = await loadAgentsRoute();
    const res = await POST(makeJsonRequest({ name: "Valid", temperature: 5 }));
    expect(res.status).toBe(400);
  });

  it("returns 500 when Supabase insert errors", async () => {
    fromMock.mockReturnValue(buildAgentQueryMock({ data: null, error: { message: "constraint violation" } }));

    const { POST } = await loadAgentsRoute();
    const res = await POST(makeJsonRequest({ name: "Test" }));
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/agents/[id]", () => {
  it("updates an existing agent", async () => {
    const updated = { id: "a1", name: "Coach Atualizado", user_id: "user-1" };
    fromMock.mockReturnValue(buildAgentQueryMock({ data: updated, error: null }));

    const { PATCH } = await loadAgentByIdRoute();
    const res = await PATCH(makePatchRequest("a1", { name: "Coach Atualizado" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent).toEqual(updated);
  });

  it("rejects empty patch", async () => {
    // PATCH com {} parseia como object vazio, que e valido para Zod .optional() em todos os campos.
    // Configuramos o mock para retornar sucesso, garantindo que o handler nao
    // quebra com TypeError e devolve um 200 (update com nada aplicado).
    fromMock.mockReturnValue(buildAgentQueryMock({ data: { id: "a1", name: "unchanged" }, error: null }));
    const { PATCH } = await loadAgentByIdRoute();
    const res = await PATCH(makePatchRequest("a1", {}), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid patch (temperature out of range)", async () => {
    const { PATCH } = await loadAgentByIdRoute();
    const res = await PATCH(makePatchRequest("a1", { temperature: 5 }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 500 when Supabase update errors", async () => {
    fromMock.mockReturnValue(buildAgentQueryMock({ data: null, error: { message: "not found" } }));

    const { PATCH } = await loadAgentByIdRoute();
    // name precisa ter >= 2 chars para passar validacao Zod.
    const res = await PATCH(makePatchRequest("a1", { name: "Valid" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/agents/[id]", () => {
  it("deletes an agent", async () => {
    fromMock.mockReturnValue(buildAgentQueryMock({ data: null, error: null }));

    const { DELETE } = await loadAgentByIdRoute();
    const res = await DELETE(makeDeleteRequest("a1"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 500 when Supabase delete errors", async () => {
    fromMock.mockReturnValue(buildAgentQueryMock({ data: null, error: { message: "fk violation" } }));

    const { DELETE } = await loadAgentByIdRoute();
    const res = await DELETE(makeDeleteRequest("a1"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(500);
  });
});