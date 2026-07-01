"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { AlertTriangle, CheckCircle2, Code2, Copy, FileCode2, Globe2, Loader2, Play, ShieldCheck, Sparkles, TerminalSquare, Wrench } from "lucide-react";
import { apiRequest } from "@/lib/api/client";
import { GhostButton, PageTitle, PrimaryButton, TextArea } from "@/components/platform/form-controls";
import { cn } from "@/lib/utils";

type ToolCategory = "diagnostics" | "web" | "text" | "data" | "workspace" | "automation";
type ToolAvailability = "available" | "requires_configuration" | "requires_local_bridge";
type ToolRisk = "low" | "medium" | "high";

type PublicAgentTool = {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  risk: ToolRisk;
  availability: ToolAvailability;
  enabled: boolean;
  inputHint: string;
  exampleInput: unknown;
  notes?: string;
};

type ToolSummary = {
  total: number;
  available: number;
  requiresConfiguration: number;
  requiresLocalBridge: number;
};

type ToolRunResult = {
  toolId: string;
  ok: boolean;
  message: string;
  durationMs: number;
  output?: unknown;
};

type ToolsPayload = {
  tools: PublicAgentTool[];
  summary: ToolSummary;
};

const categoryLabels: Record<ToolCategory, string> = {
  diagnostics: "Diagnóstico",
  web: "Web",
  text: "Texto",
  data: "Dados",
  workspace: "Workspace",
  automation: "Automação",
};

const categoryIcons: Record<ToolCategory, ComponentType<{ className?: string }>> = {
  diagnostics: ShieldCheck,
  web: Globe2,
  text: FileCode2,
  data: Code2,
  workspace: TerminalSquare,
  automation: Sparkles,
};

const availabilityLabels: Record<ToolAvailability, string> = {
  available: "Disponível",
  requires_configuration: "Configurar",
  requires_local_bridge: "Ponte local",
};

const riskLabels: Record<ToolRisk, string> = {
  low: "baixo risco",
  medium: "risco médio",
  high: "alto risco",
};

function formatInput(input: unknown) {
  return JSON.stringify(input ?? {}, null, 2);
}

function parseJsonInput(value: string) {
  if (!value.trim()) return {};
  return JSON.parse(value);
}

function resultToText(result: ToolRunResult | null) {
  if (!result) return "";
  return JSON.stringify(result, null, 2);
}

function availabilityClass(availability: ToolAvailability) {
  if (availability === "available") return "bg-emerald-50 text-emerald-700";
  if (availability === "requires_configuration") return "bg-amber-50 text-amber-700";
  return "bg-blue-50 text-blue-700";
}

export function ToolCenterClient() {
  const [tools, setTools] = useState<PublicAgentTool[]>([]);
  const [summary, setSummary] = useState<ToolSummary | null>(null);
  const [selectedToolId, setSelectedToolId] = useState("");
  const [input, setInput] = useState("{}");
  const [result, setResult] = useState<ToolRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === selectedToolId) || tools.find((tool) => tool.enabled),
    [selectedToolId, tools],
  );

  useEffect(() => {
    let active = true;

    async function loadTools() {
      setLoading(true);
      setError(null);
      try {
        const payload = await apiRequest<ToolsPayload>("/api/tools");
        if (!active) return;
        setTools(payload.tools);
        setSummary(payload.summary);
        const firstExecutable = payload.tools.find((tool) => tool.enabled && tool.availability === "available") || payload.tools[0];
        if (firstExecutable) {
          setSelectedToolId(firstExecutable.id);
          setInput(formatInput(firstExecutable.exampleInput));
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as ferramentas.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadTools();
    return () => {
      active = false;
    };
  }, []);

  function selectTool(tool: PublicAgentTool) {
    setSelectedToolId(tool.id);
    setInput(formatInput(tool.exampleInput));
    setResult(null);
    setError(null);
  }

  async function runSelectedTool() {
    if (!selectedTool || !selectedTool.enabled) return;
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const payload = await apiRequest<{ run: ToolRunResult }>("/api/tools", {
        method: "POST",
        body: JSON.stringify({
          toolId: selectedTool.id,
          input: parseJsonInput(input),
        }),
      });
      setResult(payload.run);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "A ferramenta falhou.");
    } finally {
      setRunning(false);
    }
  }

  async function copyResult() {
    await navigator.clipboard.writeText(resultToText(result));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-6">
      <PageTitle
        eyebrow="Ferramentas"
        title="Central de ferramentas do agente"
        description="Execute diagnósticos e utilitários seguros agora. Recursos de terminal, arquivos e navegador local ficam preparados para uma ponte local autenticada, sem expor seu servidor."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-500">Ferramentas</p>
          <p className="mt-1 text-2xl font-semibold">{summary?.total ?? "-"}</p>
        </div>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-700">Executáveis agora</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-900">{summary?.available ?? "-"}</p>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
          <p className="text-sm text-amber-700">Precisam configurar</p>
          <p className="mt-1 text-2xl font-semibold text-amber-900">{summary?.requiresConfiguration ?? "-"}</p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
          <p className="text-sm text-blue-700">Ponte local</p>
          <p className="mt-1 text-2xl font-semibold text-blue-900">{summary?.requiresLocalBridge ?? "-"}</p>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Segurança da execução</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              O Vercel executa apenas ferramentas sem acesso ao seu computador. Comandos de terminal, arquivos locais e testes no navegador precisam de uma ponte local com token e aprovações por ação.
            </p>
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(280px,420px)_1fr]">
        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Catálogo</h2>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-zinc-500" /> : null}
          </div>

          <div className="grid gap-3">
            {tools.map((tool) => {
              const Icon = categoryIcons[tool.category];
              const active = selectedTool?.id === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => selectTool(tool)}
                  className={cn(
                    "min-w-0 rounded-lg border bg-white p-4 text-left transition duration-200 active:scale-[0.99]",
                    active ? "border-zinc-950 shadow-sm" : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-800">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-sm font-semibold text-zinc-950">{tool.name}</h3>
                        {active ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}
                      </div>
                      <p className="mt-1 text-sm leading-5 text-zinc-600">{tool.description}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className={cn("rounded-full px-2 py-1 text-xs font-medium", availabilityClass(tool.availability))}>
                          {availabilityLabels[tool.availability]}
                        </span>
                        <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">
                          {categoryLabels[tool.category]}
                        </span>
                        <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">
                          {riskLabels[tool.risk]}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          {selectedTool ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", availabilityClass(selectedTool.availability))}>
                      {availabilityLabels[selectedTool.availability]}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">
                      {selectedTool.id}
                    </span>
                  </div>
                  <h2 className="mt-3 break-words text-xl font-semibold">{selectedTool.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">{selectedTool.description}</p>
                </div>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
                  <Wrench className="h-5 w-5" />
                </div>
              </div>

              {selectedTool.notes ? (
                <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">{selectedTool.notes}</p>
              ) : null}

              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="tool-input">
                    Entrada da ferramenta
                  </label>
                  <GhostButton type="button" onClick={() => setInput(formatInput(selectedTool.exampleInput))}>
                    Usar exemplo
                  </GhostButton>
                </div>
                <p className="text-xs leading-5 text-zinc-500">{selectedTool.inputHint}</p>
                <TextArea
                  id="tool-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  spellCheck={false}
                  className="min-h-48 font-mono text-sm"
                />
              </div>

              <PrimaryButton
                type="button"
                onClick={() => void runSelectedTool()}
                disabled={running || !selectedTool.enabled}
                className="h-12 w-full sm:w-auto"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Executar ferramenta
              </PrimaryButton>

              {!selectedTool.enabled ? (
                <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-800">
                  Esta ferramenta está preparada no catálogo, mas só será liberada quando a ponte local estiver configurada com segurança.
                </p>
              ) : null}

              <div className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-950 p-4 text-white">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Resultado</h3>
                  <GhostButton type="button" onClick={() => void copyResult()} disabled={!result} className="border-white/10 bg-white/10 text-white hover:bg-white/15 hover:text-white">
                    <Copy className="h-4 w-4" />
                    {copied ? "Copiado" : "Copiar"}
                  </GhostButton>
                </div>
                <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-xs leading-5 text-zinc-100">
                  {result ? resultToText(result) : "Execute uma ferramenta para ver a resposta aqui."}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex min-h-72 items-center justify-center text-sm text-zinc-500">
              Nenhuma ferramenta carregada.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
