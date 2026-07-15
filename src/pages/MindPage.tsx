import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "@/lib/api";
import type { MindModels, MindStats, MindQueryResult } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabsLayout } from "@/components/ui/page-tabs-layout";
import { SharedSavingsStrip } from "@/components/SharedSavingsStrip";
import {
  Settings2,
  Play,
  BarChart3,
  Loader2,
  Zap,
  AlertTriangle,
  Sparkles,
  Cpu,
  Clock,
  Hash,
  CheckCircle2,
} from "lucide-react";

/**
 * Mind — ML model governance & LLM query playground.
 *
 * Tabs:
 *  1. Model Tiers — GET /api/mind/models (tier catalog, industry adapters, training state)
 *  2. Prompt Playground — POST /api/mind/query (with tier selector + 429 budget handling)
 *  3. Usage & Stats — GET /api/mind/stats (tenant-scoped query/token/latency breakdown)
 *
 * All data here is tenant-scoped (the backend resolves tenant from auth); companyId is
 * not needed for these endpoints.
 *
 * PR #226: /api/mind/query returns 429 when the tenant's monthly LLM token budget is
 * exhausted. We surface a friendly message instead of a generic error.
 */

const BUDGET_EXCEEDED_MESSAGE =
  "Your tenant's LLM budget has been reached for this month. Contact your admin to increase it.";

export function MindPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"models" | "playground" | "stats">("models");

  // Models tab
  const [models, setModels] = useState<MindModels | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Playground tab
  const [prompt, setPrompt] = useState("");
  const [selectedTier, setSelectedTier] = useState<string>("tier-1");
  const [queryResult, setQueryResult] = useState<MindQueryResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);

  // Stats tab
  const [stats, setStats] = useState<MindStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const data = await api.mind.models();
      setModels(data);
      if (data.tiers && data.tiers.length > 0 && !data.tiers.find((t) => t.id === selectedTier)) {
        setSelectedTier(data.tiers[0].id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load model catalog";
      setModelsError(message);
      toast.error("Failed to load model catalog", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setModelsLoading(false);
    }
    // selectedTier intentionally excluded — this loader runs once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const data = await api.mind.stats();
      setStats(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load usage stats";
      setStatsError(message);
      toast.error("Failed to load usage stats", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setStatsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadModels();
    loadStats();
  }, [loadModels, loadStats]);

  const testPrompt = async () => {
    if (!prompt.trim()) return;
    setTesting(true);
    setPlaygroundError(null);
    setQueryResult(null);
    try {
      const result = await api.mind.query(prompt, selectedTier);
      setQueryResult(result);
    } catch (err) {
      // PR #226: tenant LLM budget exceeded — show a friendly notice, not a crash.
      if (err instanceof ApiError && err.status === 429) {
        setPlaygroundError(BUDGET_EXCEEDED_MESSAGE);
        toast.warning("LLM budget reached", {
          message: BUDGET_EXCEEDED_MESSAGE,
        });
      } else {
        const message = err instanceof Error ? err.message : "Failed to run prompt";
        setPlaygroundError(message);
        toast.error("Prompt test failed", {
          message,
          requestId: err instanceof ApiError ? err.requestId : null,
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const tabs = [
    { id: "models", label: "Model Tiers", icon: <Settings2 size={14} /> },
    { id: "playground", label: "Prompt Playground", icon: <Play size={14} /> },
    { id: "stats", label: "Usage & Stats", icon: <BarChart3 size={14} /> },
  ];

  return (
    <div className="space-y-6">
      <SharedSavingsStrip />
      <PageTabsLayout
        variant="segmented"
        ariaLabel="Mind sections"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as typeof activeTab)}
        header={
          <PageHeader
            eyebrow="Mind · Reasoning Engine"
            title="Mind"
            dek="AI Model Governance & Configuration"
          />
        }
      >
      {/* Model Tiers */}
      {activeTab === "models" && (
        <div className="space-y-4">
          {modelsLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent)" }} />
            </div>
          )}
          {!modelsLoading && modelsError && (
            <div className="flex items-center gap-2 p-3 rounded-md border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.25)' }}>
              <AlertTriangle size={14} className="flex-shrink-0" style={{ color: 'var(--neg)' }} />
              <p className="text-xs flex-1" style={{ color: 'var(--neg)' }}>{modelsError}</p>
              <button onClick={loadModels} className="text-xs underline" style={{ color: 'var(--neg)' }}>Retry</button>
            </div>
          )}
          {!modelsLoading && !modelsError && models && (
            <>
              <section className="rounded-lg p-6 space-y-5" style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}>
                <div className="flex items-center gap-2">
                  <Cpu size={13} style={{ color: "var(--accent)" }} />
                  <h2 className="text-label" style={{ color: "var(--text-muted)" }}>Available Model Tiers</h2>
                </div>
                {models.tiers && models.tiers.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {models.tiers.map((tier) => (
                      <div key={tier.id} className="relative p-5 rounded-lg space-y-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-card)" }}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold t-primary leading-tight">{tier.name}</p>
                          <span className="font-mono text-[10px] tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}>{tier.id}</span>
                        </div>
                        <p className="text-xs t-secondary leading-relaxed">{tier.description}</p>
                        <div className="flex items-center gap-4 pt-2 mt-1" style={{ borderTop: "1px solid var(--border-card)" }}>
                          <span className="flex items-center gap-1.5 pt-2">
                            <Hash size={11} style={{ color: "var(--text-muted)" }} />
                            <span className="font-mono text-xs tabular-nums t-primary">{tier.maxTokens.toLocaleString()}</span>
                            <span className="text-caption t-muted">tok</span>
                          </span>
                          {typeof tier.avgLatency === "number" && (
                            <span className="flex items-center gap-1.5 pt-2">
                              <Clock size={11} style={{ color: "var(--text-muted)" }} />
                              <span className="font-mono text-xs tabular-nums t-primary">~{tier.avgLatency}</span>
                              <span className="text-caption t-muted">ms</span>
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] t-muted truncate" title={tier.model}>{tier.model}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs t-muted text-center py-8">No model tiers configured.</p>
                )}
              </section>

              <section className="rounded-lg p-6 space-y-4" style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}>
                <div className="flex items-center gap-2">
                  <Sparkles size={13} style={{ color: "var(--accent)" }} />
                  <h2 className="text-label" style={{ color: "var(--text-muted)" }}>Industry Adapters</h2>
                </div>
                {models.industryAdapters && models.industryAdapters.length > 0 ? (
                  <div className="space-y-2.5">
                    {models.industryAdapters.map((ad) => (
                      <div key={ad.id} className="flex items-center justify-between gap-4 p-4 rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-card)" }}>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold t-primary">{ad.name}</p>
                          <p className="font-mono text-[10px] t-muted mt-0.5 truncate">{ad.metrics?.join(" · ") || "No metrics listed"}</p>
                        </div>
                        <span className="pill pill-success shrink-0">
                          <CheckCircle2 size={11} /> {ad.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs t-muted text-center py-4">No industry adapters available yet.</p>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {/* Prompt Playground */}
      {activeTab === "playground" && (
        <div className="rounded-lg p-6 space-y-5" style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}>
          <div className="flex items-center gap-2">
            <Play size={13} style={{ color: "var(--accent)" }} />
            <h2 className="text-label" style={{ color: "var(--text-muted)" }}>Test Prompts</h2>
          </div>

          <div>
            <label className="text-label block mb-2" style={{ color: "var(--text-muted)" }}>Model Tier</label>
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm t-primary"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-card)" }}
              disabled={modelsLoading || testing || !models?.tiers?.length}
            >
              {/* Only real tiers from the catalog API — never fabricate options when the fetch failed. */}
              {models?.tiers?.length ? (
                models.tiers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
                ))
              ) : (
                <option value="">{modelsLoading ? "Loading tiers…" : "Model catalog unavailable"}</option>
              )}
            </select>
          </div>

          <div>
            <label className="text-label block mb-2" style={{ color: "var(--text-muted)" }}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter a prompt to test against the current model tier..."
              rows={4}
              className="w-full px-3 py-2.5 rounded-lg text-sm t-primary resize-y"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-card)" }}
            />
          </div>

          {playgroundError && (
            <div className="flex items-center gap-2 p-3 rounded-md border" style={{ background: 'rgb(var(--warning-rgb, 154 107 31) / 0.08)', borderColor: 'rgb(var(--warning-rgb, 154 107 31) / 0.25)' }}>
              <AlertTriangle size={14} className="flex-shrink-0" style={{ color: 'var(--warning)' }} />
              <p className="text-xs flex-1" style={{ color: 'var(--warning)' }}>{playgroundError}</p>
              <button onClick={() => setPlaygroundError(null)} className="text-xs underline" style={{ color: 'var(--warning)' }}>Dismiss</button>
            </div>
          )}

          <button
            onClick={testPrompt}
            disabled={testing || !prompt.trim() || !models?.tiers?.length}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-[var(--text-on-accent)] flex items-center gap-2"
            style={{ background: "var(--accent)", opacity: testing || !prompt.trim() || !models?.tiers?.length ? 0.55 : 1 }}
            title="Run prompt against the selected tier"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {testing ? "Running..." : "Test Prompt"}
          </button>

          {queryResult && (
            <div className="space-y-4 pt-1">
              <div className="flex items-center gap-2">
                <Sparkles size={13} style={{ color: "var(--accent)" }} />
                <h3 className="text-label" style={{ color: "var(--text-muted)" }}>Response</h3>
              </div>
              <div className="p-5 rounded-lg text-sm t-secondary leading-relaxed whitespace-pre-wrap" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-card)" }}>
                {queryResult.response}
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-card)" }}>
                  <Cpu size={11} style={{ color: "var(--text-muted)" }} /><span className="font-mono text-[11px] t-primary">{queryResult.model}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-card)" }}>
                  <Clock size={11} style={{ color: "var(--text-muted)" }} /><span className="font-mono text-[11px] tabular-nums t-primary">{queryResult.latencyMs}ms</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-card)" }}>
                  <Hash size={11} style={{ color: "var(--text-muted)" }} /><span className="font-mono text-[11px] tabular-nums t-primary">{queryResult.tokensIn + queryResult.tokensOut}</span><span className="text-caption t-muted">tok</span>
                </span>
                {queryResult.citations && queryResult.citations.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-card)" }}>
                    <span className="font-mono text-[11px] tabular-nums t-primary">{queryResult.citations.length}</span><span className="text-caption t-muted">citation{queryResult.citations.length === 1 ? "" : "s"}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {activeTab === "stats" && (
        <div className="space-y-4">
          {statsLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent)" }} />
            </div>
          )}
          {!statsLoading && statsError && (
            <div className="flex items-center gap-2 p-3 rounded-md border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.25)' }}>
              <AlertTriangle size={14} className="flex-shrink-0" style={{ color: 'var(--neg)' }} />
              <p className="text-xs flex-1" style={{ color: 'var(--neg)' }}>{statsError}</p>
              <button onClick={loadStats} className="text-xs underline" style={{ color: 'var(--neg)' }}>Retry</button>
            </div>
          )}
          {!statsLoading && !statsError && stats && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-lg p-5" style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}>
                  <p className="text-label" style={{ color: "var(--text-muted)" }}>Total Queries</p>
                  <p className="text-3xl font-bold font-mono tabular-nums t-primary mt-2">{stats.totalQueries.toLocaleString()}</p>
                </div>
                <div className="rounded-lg p-5" style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}>
                  <p className="text-label" style={{ color: "var(--text-muted)" }}>Avg Latency</p>
                  <p className="text-3xl font-bold font-mono tabular-nums t-primary mt-2">{stats.avgLatencyMs}<span className="text-lg t-muted ml-0.5">ms</span></p>
                </div>
                <div className="rounded-lg p-5" style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}>
                  <p className="text-label" style={{ color: "var(--text-muted)" }}>Total Tokens</p>
                  <p className="text-3xl font-bold font-mono tabular-nums t-primary mt-2">{stats.totalTokens.toLocaleString()}</p>
                </div>
              </div>

              <section className="rounded-lg p-6 space-y-4" style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}>
                <div className="flex items-center gap-2">
                  <BarChart3 size={13} style={{ color: "var(--accent)" }} />
                  <h2 className="text-label" style={{ color: "var(--text-muted)" }}>Usage by Tier</h2>
                </div>
                {stats.tierBreakdown && stats.tierBreakdown.length > 0 ? (
                  <div className="space-y-2.5">
                    {stats.tierBreakdown.map((row) => (
                      <div key={row.tier} className="flex items-center justify-between gap-4 p-4 rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-card)" }}>
                        <div className="min-w-0">
                          <p className="font-mono text-xs t-primary tracking-wide">{row.tier}</p>
                          <p className="text-caption t-muted mt-0.5"><span className="font-mono tabular-nums">{row.count}</span> queries</p>
                        </div>
                        <span className="font-mono text-xs tabular-nums t-secondary shrink-0">{Math.round(row.avg_latency)}ms avg</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs t-muted text-center py-8">No usage data yet. Run prompts in the Playground tab to see stats here.</p>
                )}
              </section>
            </>
          )}
        </div>
      )}
      </PageTabsLayout>
    </div>
  );
}
