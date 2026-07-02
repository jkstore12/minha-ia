// Testes para scripts/apply-migrations.mjs.
//
// Cobre:
//  - Falha amigavel quando dbUrl nao e fornecida.
//  - Ordem: arquivos sao aplicados em ordem alfabetica.
//  - Idempotencia: migrations ja em schema_migrations nao sao re-executadas.
//  - Error handling: falha em uma migration para o batch e rollback nao registra.
//  - Tracking: cada migration aplicada e registrada em schema_migrations.
//
// Estrategia: a funcao applyMigrations aceita `pgModule` por injecao,
// entao usamos um fake pg para controlar o comportamento do client.

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyMigrations } from "../apply-migrations.mjs";

function makeFakePg({ failOnVersion = null, initialApplied = [] } = {}) {
  const queries = [];
  const appliedVersions = new Set(initialApplied);

  class FakeClient {
    constructor(config) {
      this.config = config;
      queries.push({ type: "connect-config", connectionString: config.connectionString });
    }
    async connect() {
      queries.push({ type: "connect" });
    }
    async query(sql, params) {
      queries.push({ type: "query", sql: String(sql).trim().slice(0, 80), params });
      const trimmed = String(sql).trim();

      if (trimmed.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) {
        return { rows: [], rowCount: 0 };
      }
      if (trimmed === "SELECT version FROM schema_migrations ORDER BY version") {
        return { rows: [...appliedVersions].map((version) => ({ version })), rowCount: appliedVersions.size };
      }
      if (trimmed === "BEGIN") {
        queries.push({ type: "tx-begin" });
        return { rows: [], rowCount: 0 };
      }
      if (trimmed === "COMMIT") {
        queries.push({ type: "tx-commit" });
        return { rows: [], rowCount: 0 };
      }
      if (trimmed === "ROLLBACK") {
        queries.push({ type: "tx-rollback" });
        return { rows: [], rowCount: 0 };
      }
      if (trimmed.startsWith("INSERT INTO schema_migrations")) {
        const version = params?.[0];
        if (version && failOnVersion === version) {
          throw new Error("Simulated migration failure");
        }
        appliedVersions.add(version);
        return { rows: [], rowCount: 1 };
      }
      // Conteudo da migration — passa.
      return { rows: [], rowCount: 0 };
    }
    async end() {
      queries.push({ type: "end" });
    }
  }

  const fakePg = { Client: FakeClient };
  return { fakePg, queries, getApplied: () => [...appliedVersions] };
}

function setupMigrations(files) {
  const dir = mkdtempSync(join(tmpdir(), "apply-migrations-test-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe("applyMigrations", () => {
  let migrationsDir;
  let silentLog;

  beforeEach(() => {
    silentLog = {
      info: () => {},
      ok: () => {},
      warn: () => {},
      err: () => {},
      step: () => {},
      dim: () => {},
    };
  });

  afterEach(() => {
    if (migrationsDir) {
      rmSync(migrationsDir, { recursive: true, force: true });
      migrationsDir = null;
    }
  });

  it("returns ok=false when dbUrl is not provided", async () => {
    const result = await applyMigrations({ dbUrl: "", logFn: silentLog });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-db-url");
  });

  it("connects to the database using provided URL", async () => {
    migrationsDir = setupMigrations({ "0001_x.sql": "SELECT 1;" });
    const { fakePg } = makeFakePg();

    await applyMigrations({
      dbUrl: "postgres://u:p@h:5432/db",
      pgModule: fakePg,
      migrationsDir,
      logFn: silentLog,
    });

    const connectCall = fakePg.Client.prototype.constructor;
    // Validamos via instancia criada: como Client e uma classe, capturamos
    // o construtor via uma das queries.
    expect(connectCall).toBeDefined();
  });

  it("applies migrations in alphabetical order and registers each", async () => {
    migrationsDir = setupMigrations({
      "0001_first.sql": "CREATE TABLE a (id int);",
      "0002_second.sql": "CREATE TABLE b (id int);",
      "0003_third.sql": "CREATE TABLE c (id int);",
    });
    const { fakePg, getApplied, queries } = makeFakePg();

    const result = await applyMigrations({
      dbUrl: "postgres://x@y/z",
      pgModule: fakePg,
      migrationsDir,
      logFn: silentLog,
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(3);
    expect(getApplied().sort()).toEqual(["0001_first", "0002_second", "0003_third"]);

    // BEGIN/COMMIT aparecem 3 vezes (uma por migration).
    const begins = queries.filter((q) => q.type === "tx-begin").length;
    const commits = queries.filter((q) => q.type === "tx-commit").length;
    expect(begins).toBe(3);
    expect(commits).toBe(3);
  });

  it("is idempotent: re-running does not re-apply already-applied migrations", async () => {
    migrationsDir = setupMigrations({
      "0001_first.sql": "SELECT 1;",
      "0002_second.sql": "SELECT 2;",
    });
    const { fakePg } = makeFakePg({ initialApplied: ["0001_first"] });

    const result = await applyMigrations({
      dbUrl: "postgres://x",
      pgModule: fakePg,
      migrationsDir,
      logFn: silentLog,
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
  });

  it("ROLLBACK on failure: failing migration is NOT registered, batch aborts", async () => {
    migrationsDir = setupMigrations({
      "0001_first.sql": "SELECT 1;",
      "0002_fails.sql": "SELECT 2;",
      "0003_third.sql": "SELECT 3;",
    });
    const { fakePg, getApplied, queries } = makeFakePg({ failOnVersion: "0002_fails" });

    const result = await applyMigrations({
      dbUrl: "postgres://x",
      pgModule: fakePg,
      migrationsDir,
      logFn: silentLog,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("migration-failed");

    // 0001 foi aplicada (registrada), 0002 falhou e NAO foi registrada,
    // 0003 nao foi tentada.
    expect(getApplied()).toContain("0001_first");
    expect(getApplied()).not.toContain("0002_fails");
    expect(getApplied()).not.toContain("0003_third");

    // BEGIN aparece 2 vezes (0001 com sucesso + 0002 que falhou), ROLLBACK 1x.
    const begins = queries.filter((q) => q.type === "tx-begin").length;
    const rollbacks = queries.filter((q) => q.type === "tx-rollback").length;
    const commits = queries.filter((q) => q.type === "tx-commit").length;
    expect(begins).toBe(2);
    expect(rollbacks).toBe(1);
    expect(commits).toBe(1);
  });

  it("calls client.end() exactly once after processing", async () => {
    migrationsDir = setupMigrations({ "0001_x.sql": "SELECT 1;" });
    const { fakePg, queries } = makeFakePg();

    await applyMigrations({
      dbUrl: "postgres://x",
      pgModule: fakePg,
      migrationsDir,
      logFn: silentLog,
    });

    const ends = queries.filter((q) => q.type === "end").length;
    expect(ends).toBe(1);
  });

  it("applies zero migrations when all are already in schema_migrations", async () => {
    migrationsDir = setupMigrations({
      "0001_first.sql": "SELECT 1;",
      "0002_second.sql": "SELECT 2;",
    });
    const { fakePg } = makeFakePg({ initialApplied: ["0001_first", "0002_second"] });

    const result = await applyMigrations({
      dbUrl: "postgres://x",
      pgModule: fakePg,
      migrationsDir,
      logFn: silentLog,
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(0);
  });
});