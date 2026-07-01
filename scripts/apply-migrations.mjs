#!/usr/bin/env node
/**
 * Aplica migrations SQL do Supabase em ordem, com tracking.
 *
 * Uso:
 *   1. Pegue a connection string em Supabase Dashboard > Project Settings > Database > Connection string (URI mode)
 *   2. export SUPABASE_DB_URL="postgresql://postgres:SENHA@db.xxx.supabase.co:5432/postgres"
 *   3. node scripts/apply-migrations.mjs
 *
 * O script:
 *   - Cria a tabela schema_migrations se nao existir
 *   - Le todos os arquivos .sql em supabase/migrations/ em ordem
 *   - Para cada um nao aplicado: executa e registra
 *   - Idempotente: pode rodar multiplas vezes sem erro
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

// Cores para output
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};
const log = {
  info: (m) => console.log(`${c.blue}ℹ${c.reset} ${m}`),
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.log(`${c.red}✗${c.reset} ${m}`),
  step: (m) => console.log(`\n${c.bold}${c.cyan}▶ ${m}${c.reset}`),
};

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    log.err("SUPABASE_DB_URL nao definida.");
    console.log("");
    console.log("Como pegar:");
    console.log("  1. Supabase Dashboard → Project Settings → Database");
    console.log("  2. Connection string → 'URI' mode");
    console.log("  3. Copie a string (parecida com postgresql://postgres:SENHA@db.xxx.supabase.co:5432/postgres)");
    console.log("");
    console.log("Depois:");
    console.log("  export SUPABASE_DB_URL='...'");
    console.log("  node scripts/apply-migrations.mjs");
    process.exit(1);
  }

  log.step("Conectando ao Supabase Postgres");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  log.ok("Conectado");

  log.step("Garantindo tabela schema_migrations");
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  log.ok("Tabela pronta");

  log.step("Listando migrations");
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  log.info(`${files.length} arquivos encontrados em ${MIGRATIONS_DIR}`);

  log.step("Verificando migrations ja aplicadas");
  const { rows: applied } = await client.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const appliedSet = new Set(applied.map((r) => r.version));
  log.info(`${appliedSet.size} ja aplicadas, ${files.length - appliedSet.size} pendentes`);

  log.step("Aplicando migrations pendentes");
  let appliedCount = 0;
  let errored = false;

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");

    if (appliedSet.has(version)) {
      log.dim(`  ${version} (ja aplicada)`);
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");

    try {
      log.info(`Aplicando ${version}...`);
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      log.ok(`  ${version} OK`);
      appliedCount++;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      log.err(`  ${version} FALHOU: ${err.message}`);
      log.warn("Migration com erro NAO foi registrada. Corrija e rode de novo.");
      errored = true;
      break;
    }
  }

  await client.end();

  console.log("");
  if (errored) {
    log.err("Aplicacao interrompida com erros.");
    process.exit(1);
  }
  log.ok(`${appliedCount} migration(s) aplicada(s) com sucesso.`);
  log.ok("Pronto. Proximo passo: configurar Storage bucket no Supabase (veja DEPLOY.md secao 2.3).");
}

main().catch((err) => {
  log.err(err.stack || err.message);
  process.exit(1);
});
