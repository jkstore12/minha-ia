import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 8765;
const MAX_BODY_BYTES = 1_000_000;
const MAX_OUTPUT_BYTES = 80_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const TOKEN = process.env.LOCAL_AGENT_BRIDGE_TOKEN;
const HOST = process.env.LOCAL_AGENT_BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.LOCAL_AGENT_BRIDGE_PORT || DEFAULT_PORT);
const WORKSPACE_ROOT = path.resolve(process.env.LOCAL_AGENT_WORKSPACE || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

const allowedCommands = {
  "npm.typecheck": { command: npmBinary(), args: ["run", "typecheck"], timeoutMs: 120_000 },
  "npm.lint": { command: npmBinary(), args: ["run", "lint"], timeoutMs: 120_000 },
  "npm.build": { command: npmBinary(), args: ["run", "build"], timeoutMs: 180_000 },
  "node.check.telegram": { command: process.execPath, args: ["--check", "api/webhook-telegram.js"], timeoutMs: 30_000 },
  "node.check.whatsapp": { command: process.execPath, args: ["--check", "api/webhook-whatsapp.js"], timeoutMs: 30_000 },
};

function npmBinary() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function getBearerToken(request) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

function assertAuthorized(request) {
  if (!TOKEN) {
    throw Object.assign(new Error("LOCAL_AGENT_BRIDGE_TOKEN não configurado no processo da ponte."), { status: 503 });
  }

  if (getBearerToken(request) !== TOKEN) {
    throw Object.assign(new Error("Token da ponte local inválido."), { status: 401 });
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Payload maior que o limite permitido."), { status: 413 });
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON inválido."), { status: 400 });
  }
}

function resolveWorkspacePath(inputPath) {
  const requestedPath = String(inputPath || "").replace(/\\/g, "/");
  const resolvedPath = path.resolve(WORKSPACE_ROOT, requestedPath);
  const relativePath = path.relative(WORKSPACE_ROOT, resolvedPath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw Object.assign(new Error("Caminho fora do workspace autorizado."), { status: 403 });
  }

  const lowerPath = relativePath.toLowerCase().replace(/\\/g, "/");
  const blocked =
    lowerPath === ".env" ||
    lowerPath.startsWith(".env.") ||
    lowerPath.startsWith(".git/") ||
    lowerPath.startsWith(".vercel/") ||
    lowerPath.startsWith("node_modules/");

  if (blocked) {
    throw Object.assign(new Error("Arquivo bloqueado por política de segurança da ponte local."), { status: 403 });
  }

  return { resolvedPath, relativePath };
}

function trimOutput(value) {
  const text = String(value || "");
  if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return text;
  return `${text.slice(0, MAX_OUTPUT_BYTES)}\n\n[saida truncada pelo limite da ponte local]`;
}

function runProcess(commandSpec, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: WORKSPACE_ROOT,
      shell: false,
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    const timeout = setTimeout(() => {
      finished = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        code: null,
        signal: "SIGTERM",
        stdout: trimOutput(stdout),
        stderr: trimOutput(`${stderr}\nProcesso encerrado por timeout.`),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = trimOutput(stdout + chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      stderr = trimOutput(stderr + chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve({ ok: false, code: null, signal: null, stdout: trimOutput(stdout), stderr: error.message });
    });
    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, signal, stdout: trimOutput(stdout), stderr: trimOutput(stderr) });
    });
  });
}

async function handleTool(toolId, input) {
  if (toolId === "git.status") {
    const result = await runProcess({ command: "git", args: ["status", "--short", "--branch"] }, 30_000);
    return {
      ok: result.ok,
      message: result.ok ? "Status Git consultado." : "Não foi possível consultar o status Git.",
      output: { workspaceRoot: WORKSPACE_ROOT, ...result },
    };
  }

  if (toolId === "workspace.files.read") {
    const { resolvedPath, relativePath } = resolveWorkspacePath(input?.path);
    const maxChars = Math.min(Math.max(Number(input?.maxChars || 12_000), 200), 60_000);
    const stat = await fs.stat(resolvedPath);

    if (!stat.isFile()) {
      throw Object.assign(new Error("O caminho informado não é um arquivo."), { status: 400 });
    }

    if (stat.size > 500_000) {
      throw Object.assign(new Error("Arquivo grande demais para leitura pela ponte local."), { status: 413 });
    }

    const content = await fs.readFile(resolvedPath, "utf8");
    return {
      ok: true,
      message: "Arquivo lido com sucesso.",
      output: {
        path: relativePath.replace(/\\/g, "/"),
        sizeBytes: stat.size,
        truncated: content.length > maxChars,
        content: content.slice(0, maxChars),
      },
    };
  }

  if (toolId === "terminal.run") {
    const commandName = String(input?.command || "");
    const commandSpec = allowedCommands[commandName];
    if (!commandSpec) {
      throw Object.assign(new Error("Comando não permitido pela ponte local."), { status: 403 });
    }

    const timeoutMs = Math.min(Math.max(Number(input?.timeoutMs || commandSpec.timeoutMs || DEFAULT_TIMEOUT_MS), 1000), 180_000);
    const result = await runProcess(commandSpec, timeoutMs);
    return {
      ok: result.ok,
      message: result.ok ? "Comando permitido executado com sucesso." : "Comando permitido terminou com falha.",
      output: { command: commandName, timeoutMs, ...result },
    };
  }

  throw Object.assign(new Error("Ferramenta não suportada pela ponte local."), { status: 404 });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
    assertAuthorized(request);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: true,
        message: "Ponte local ativa.",
        output: {
          workspaceRoot: WORKSPACE_ROOT,
          allowedCommands: Object.keys(allowedCommands),
          supportedTools: ["git.status", "workspace.files.read", "terminal.run"],
        },
      });
    }

    const match = url.pathname.match(/^\/tools\/([^/]+)$/);
    if (request.method !== "POST" || !match) {
      return json(response, 404, { ok: false, error: "Endpoint não encontrado." });
    }

    const body = await readJsonBody(request);
    const result = await handleTool(decodeURIComponent(match[1]), body.input || {});
    return json(response, result.ok ? 200 : 500, result);
  } catch (error) {
    const status = Number(error?.status || 500);
    return json(response, status, {
      ok: false,
      error: error instanceof Error ? error.message : "Falha na ponte local.",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ponte local da Minha IA ativa em http://${HOST}:${PORT}`);
  console.log(`Workspace autorizado: ${WORKSPACE_ROOT}`);
});
