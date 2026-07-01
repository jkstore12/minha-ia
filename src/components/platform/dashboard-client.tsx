"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BellRing, Bot, CalendarClock, CheckCircle2, Database, Loader2, MessageSquare, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type DashboardData = {
  metrics: {
    agents: number;
    activeAgents: number;
    conversations: number;
    memories: number;
    scheduledTasks: number;
    activeTasks: number;
    totalRuns: number;
    successRuns: number;
    errorRuns: number;
  };
  recentLogs: Array<{ id: string; level: string; message: string; created_at: string }>;
};

type HealthService = {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

type HealthData = {
  ok: boolean;
  checkedAt: string;
  deep: boolean;
  score: number;
  services: HealthService[];
};

function MetricCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Bot }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{label}</p>
        <Icon className="h-5 w-5 text-emerald-600" />
      </div>
      <p className="mt-4 text-3xl font-semibold">{value}</p>
    </section>
  );
}

function serviceTone(status: HealthService["status"]) {
  if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-red-200 bg-red-50 text-red-800";
}

function serviceIcon(status: HealthService["status"]) {
  if (status === "ok") return CheckCircle2;
  if (status === "warning") return AlertTriangle;
  return XCircle;
}

function HealthPanel({
  health,
  loading,
  onRefresh,
}: {
  health: HealthData | null;
  loading: boolean;
  onRefresh: (deep?: boolean) => void;
}) {
  const issueCount = health?.services.filter((service) => service.status !== "ok").length || 0;

  return (
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-600">Saúde do sistema</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">Integrações em produção</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">
            Veja se banco, IA, WhatsApp, Telegram e lembretes estão prontos para operar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRefresh(true)}
          disabled={loading}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Testar conexões
        </button>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[0.8fr_2fr]">
        <div className={cn("rounded-xl border p-4", health?.ok ? "border-emerald-200 bg-emerald-50" : issueCount ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-zinc-50")}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
              <ShieldCheck className={cn("h-5 w-5", health?.ok ? "text-emerald-600" : "text-amber-600")} />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-600">Prontidão</p>
              <p className="text-3xl font-semibold text-zinc-950">{health ? `${health.score}%` : "--"}</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-700">
            {health
              ? issueCount
                ? `${issueCount} ponto${issueCount === 1 ? "" : "s"} precisa${issueCount === 1 ? "" : "m"} de atenção.`
                : "Tudo essencial está respondendo."
              : "Carregando diagnóstico..."}
          </p>
          {health?.checkedAt ? (
            <p className="mt-2 text-xs text-zinc-500">Atualizado em {new Date(health.checkedAt).toLocaleString("pt-BR")}</p>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(health?.services || []).map((service) => {
            const Icon = serviceIcon(service.status);
            return (
              <div key={service.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-start gap-3">
                  <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border", serviceTone(service.status))}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-950">{service.label}</p>
                    <p className="mt-1 text-sm leading-5 text-zinc-600">{service.message}</p>
                  </div>
                </div>
              </div>
            );
          })}
          {!health?.services?.length ? (
            <div className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 md:col-span-2 xl:col-span-3">
              {loading ? "Verificando integrações..." : "Nenhum diagnóstico carregado ainda."}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((response) => response.json())
      .then((payload) => setData(payload))
      .catch(() => setError("Não foi possível carregar métricas."));
    void loadHealth(false);
  }, []);

  async function loadHealth(deep = false) {
    setHealthLoading(true);
    try {
      const response = await fetch(`/api/health${deep ? "?deep=1" : ""}`, { cache: "no-store" });
      const payload = (await response.json()) as HealthData & { error?: string };
      if (!payload.services?.length) {
        throw new Error(payload.error || "Diagnóstico indisponível.");
      }
      setHealth(payload);
    } catch (healthError) {
      setHealth({
        ok: false,
        checkedAt: new Date().toISOString(),
        deep,
        score: 0,
        services: [
          {
            id: "health",
            label: "Diagnóstico",
            status: "error",
            message: healthError instanceof Error ? healthError.message : "Não foi possível carregar a saúde do sistema.",
          },
        ],
      });
    } finally {
      setHealthLoading(false);
    }
  }

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Carregando dashboard...</p>;

  const successRate = data.metrics.totalRuns ? Math.round((data.metrics.successRuns / data.metrics.totalRuns) * 100) : 0;

  return (
    <div>
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Dashboard</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Centro de comando</h1>
      </div>

      <Link
        href="/abilities"
        className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:bg-emerald-100 sm:p-5"
      >
        <span>
          <span className="block font-semibold text-emerald-900">Habilidades e lembretes</span>
          <span className="mt-1 block text-sm text-zinc-600">Crie lembretes, veja pendências e adicione novas habilidades ao seu agente.</span>
        </span>
        <BellRing className="h-5 w-5 shrink-0 text-emerald-600" />
      </Link>

      <HealthPanel health={health} loading={healthLoading} onRefresh={loadHealth} />

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Agentes ativos" value={data.metrics.activeAgents} icon={Bot} />
        <MetricCard label="Conversas" value={data.metrics.conversations} icon={MessageSquare} />
        <MetricCard label="Memórias" value={data.metrics.memories} icon={Database} />
        <MetricCard label="Agendamentos ativos" value={data.metrics.activeTasks} icon={CalendarClock} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <p className="text-sm text-zinc-500">Taxa de sucesso</p>
          <p className="mt-4 text-4xl font-semibold">{successRate}%</p>
          <p className="mt-2 text-xs text-zinc-500">{data.metrics.successRuns} sucesso / {data.metrics.errorRuns} erro</p>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-2">
          <p className="font-semibold">Logs recentes</p>
          <div className="mt-4 space-y-3">
            {data.recentLogs.length ? data.recentLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                {log.level === "error" ? <XCircle className="mt-0.5 h-4 w-4 text-red-600" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />}
                <div className="min-w-0">
                  <p className="text-sm">{log.message}</p>
                  <p className="mt-1 text-xs text-zinc-500">{new Date(log.created_at).toLocaleString("pt-BR")}</p>
                </div>
              </div>
            )) : <p className="text-sm text-zinc-500">Nenhum log ainda.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
