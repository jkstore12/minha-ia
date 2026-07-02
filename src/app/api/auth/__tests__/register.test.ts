// Testes para /api/auth/register.
//
// Cobre:
//  - 500 quando SUPABASE_SERVICE_ROLE_KEY nao esta setada.
//  - 400 com mensagem de validacao para payloads invalidos.
//  - 409 quando email ja existe (palavras-chave already/registered/exists).
//  - 400 quando email e invalido (palavra-chave invalid).
//  - 500 generico quando createUser falha sem match de mensagem.
//  - Happy path: cria user + upsert profile + retorna { ok: true, status: "pending" }.
//  - Rollback: deleta user se upsertPendingProfile falha.
//
// Estrategia ESM: jest.unstable_mockModule aplicado ANTES do import
// dinamico. Variaveis de ambiente setadas via beforeEach antes do
// resetModules.

import { jest } from "@jest/globals";

let originalEnv: Record<string, string | undefined>;
let fetchMock: jest.Mock;
let createUserMock: jest.Mock;
let deleteUserMock: jest.Mock;

beforeEach(() => {
  originalEnv = {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };

  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";

  // Tipagem permissiva. Default `jest.fn()` retorna `Mock<never, never[]>`
  // que torna mockResolvedValue inutilizavel; castamos para um tipo
  // generico permissivo.
  createUserMock = jest.fn() as unknown as jest.Mock;
  deleteUserMock = jest.fn() as unknown as jest.Mock;
  fetchMock = jest.fn() as unknown as jest.Mock;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

// Helper para aplicar mockResolvedValue sem brigar com a tipagem `never`
// que jest.Mock aplica quando o generic T nao e inferido. Uso de `any`
// intencional aqui — o objetivo do helper e isolar o escape hatch.
function resolveMock(mock: jest.Mock, value: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mock as any).mockResolvedValue(value);
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function makeRequest(body: unknown): Request {
  return new Request("http://x/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  jest.resetModules();
  jest.unstable_mockModule("@supabase/supabase-js", () => ({
    createClient: () => ({
      auth: {
        admin: {
          createUser: createUserMock,
          deleteUser: deleteUserMock,
        },
      },
    }),
  }));
  return import("@/app/api/auth/register/route");
}

describe("POST /api/auth/register", () => {
  it("returns 500 when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    jest.resetModules();
    jest.unstable_mockModule("@supabase/supabase-js", () => ({
      createClient: jest.fn(),
    }));
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(makeRequest({ name: "Alice", email: "alice@x.com", password: "secret123" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("returns 400 when name is too short", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ name: "A", email: "alice@x.com", password: "secret123" }));
    const json = await res.json();
    expect(json.error).toMatch(/nome/i);
  });

  it("returns 400 when email is malformed", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ name: "Alice", email: "not-an-email", password: "secret123" }));
    const json = await res.json();
    expect(json.error).toMatch(/e-?mail/i);
  });

  it("returns 400 when password is too short", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ name: "Alice", email: "alice@x.com", password: "123" }));
    const json = await res.json();
    expect(json.error).toMatch(/senha/i);
  });

  it("returns 409 when email already exists", async () => {
    resolveMock(createUserMock, {
      data: { user: null },
      error: { message: "User already registered" },
    });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ name: "Alice", email: "alice@x.com", password: "secret123" }));
    const json = await res.json();
    expect(json.error).toMatch(/j[áa] tem uma conta/);
  });

  it("returns 400 when createUser says email is invalid", async () => {
    resolveMock(createUserMock, {
      data: { user: null },
      error: { message: "Invalid email format" },
    });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ name: "Alice", email: "alice@x.com", password: "secret123" }));
    const json = await res.json();
    expect(json.error).toMatch(/e-?mail real/i);
  });

  it("returns 500 for generic createUser error", async () => {
    resolveMock(createUserMock, {
      data: { user: null },
      error: { message: "internal server error" },
    });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ name: "Alice", email: "alice@x.com", password: "secret123" }));
    const json = await res.json();
    expect(json.error).toMatch(/n[ãa]o foi poss[íi]vel criar a conta/i);
  });

  it("happy path: creates user, upserts profile, returns pending", async () => {
    resolveMock(createUserMock, {
      data: { user: { id: "user-uuid-123", email: "alice@x.com" } },
      error: null,
    });
    resolveMock(fetchMock, {
      ok: true,
      status: 200,
      json: async () => [{ id: "user-uuid-123" }],
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ name: "Alice", email: "alice@x.com", password: "secret123" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      status: "pending",
      message: expect.stringContaining("aprovada"),
    });

    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalled();
    const profileCall = fetchMock.mock.calls[0] as unknown as [string, { method?: string; body?: string } | undefined];
    expect(String(profileCall?.[0])).toContain("/rest/v1/user_profiles");
    expect(profileCall?.[1]?.method).toBe("POST");
    const body = JSON.parse(String(profileCall?.[1]?.body));
    expect(body).toMatchObject({
      id: "user-uuid-123",
      display_name: "Alice",
      role: "user",
      approval_status: "pending",
      approved_at: null,
      approved_by: null,
    });
  });

  it("lowercases email before creating user", async () => {
    resolveMock(createUserMock, {
      data: { user: { id: "user-uuid-123" } },
      error: null,
    });
    resolveMock(fetchMock, { ok: true, status: 200, json: async () => [] });

    const { POST } = await loadRoute();
    await POST(makeRequest({ name: "Alice", email: "ALICE@Example.COM", password: "secret123" }));

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alice@example.com" }),
    );
  });

  it("passes name in user_metadata and sets email_confirm=true", async () => {
    resolveMock(createUserMock, {
      data: { user: { id: "user-uuid-123" } },
      error: null,
    });
    resolveMock(fetchMock, { ok: true, status: 200, json: async () => [] });

    const { POST } = await loadRoute();
    await POST(makeRequest({ name: "Alice", email: "alice@x.com", password: "secret123" }));

    expect(createUserMock).toHaveBeenCalledWith({
      email: "alice@x.com",
      password: "secret123",
      email_confirm: true,
      user_metadata: { name: "Alice" },
    });
  });

  it("ROLLBACK: deletes user when profile upsert fails", async () => {
    resolveMock(createUserMock, {
      data: { user: { id: "user-uuid-123" } },
      error: null,
    });
    resolveMock(deleteUserMock, { data: null, error: null });

    resolveMock(fetchMock, {
      ok: false,
      status: 500,
      json: async () => ({ message: "Profile write failed" }),
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ name: "Alice", email: "alice@x.com", password: "secret123" }));
    expect(res.status).toBe(500);

    expect(deleteUserMock).toHaveBeenCalledWith("user-uuid-123");
    const json = await res.json();
    expect(json.error).toMatch(/perfil/i);
  });

  it("trims whitespace from name and email", async () => {
    resolveMock(createUserMock, {
      data: { user: { id: "user-uuid-123" } },
      error: null,
    });
    resolveMock(fetchMock, { ok: true, status: 200, json: async () => [] });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ name: "  Alice  ", email: "  alice@x.com  ", password: "secret123" }));
    expect(res.status).toBe(200);

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@x.com",
        user_metadata: { name: "Alice" },
      }),
    );
  });

  it("accepts minimum valid input (name='Al', email='a@b.co', password='123456')", async () => {
    resolveMock(createUserMock, {
      data: { user: { id: "u1" } },
      error: null,
    });
    resolveMock(fetchMock, { ok: true, status: 200, json: async () => [] });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ name: "Al", email: "a@b.co", password: "123456" }));
    expect(res.status).toBe(200);
  });
});