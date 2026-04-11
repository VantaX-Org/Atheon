import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { useParams, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  ArrowLeft, Clock, CheckCircle2, XCircle, AlertCircle,
  Activity, Database, BarChart3
} from "lucide-react";


interface RunDetail {
  id: string;
  subCatalystName: string;
  clusterName: string;
  clusterDomain: string;
  status: string;
  matched: number;
  discrepancies: number;
  exceptions: number;
  totalValue: number;
  startedAt: string;
  completedAt: string;
  kpis: Array<{ name: string; value: number; status: string; unit: string; target: number }>;
  metrics: Array<{ id: string; name: string; value: number; unit: string; status: string }>;
  sourceData: Array<{ id: string; sourceSystem: string; recordType: string; value: number; status: string }>;
}

export function CatalystRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    loadRun();
  }, [runId]);

  async function loadRun() {
    setLoading(true);
    try {
      const data = await api.catalysts.runDetail(runId!);
      setRun(data);
    } catch (err) {
      console.error('Failed to load run details:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm t-muted">Loading run details...</p>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold t-primary mb-2">Run Not Found</h2>
          <p className="text-sm t-muted mb-4">
            The catalyst run you're looking for doesn't exist or you don't have access to it.
          </p>
          <Button variant="primary" onClick={() => navigate('/catalysts')}>
            <ArrowLeft size={14} className="mr-2" /> Back to Catalysts
          </Button>
        </Card>
      </div>
    );
  }

  const StatusIcon = run.status === 'success' ? CheckCircle2
    : run.status === 'failed' ? XCircle
    : run.status === 'partial' ? AlertCircle
    : Clock;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="border-b border-[var(--border-card)] bg-[var(--bg-secondary)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/catalysts')}
                className="p-2 hover:bg-[var(--bg-card-solid)] rounded-lg transition-colors"
              >
                <ArrowLeft size={20} className="t-muted" />
              </button>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold t-primary">Catalyst Run</h1>
                  <Badge variant={run.status === 'success' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'}>
                    <StatusIcon size={12} className="mr-1" />
                    {run.status}
                  </Badge>
                </div>
                <p className="text-sm t-muted mt-1">{run.subCatalystName} • {run.clusterName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm t-muted">
              <Clock size={14} />
              <span>{new Date(run.startedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 size={20} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-xs t-muted uppercase tracking-wider">Matched Records</p>
                <p className="text-2xl font-bold t-primary">{run.matched?.toLocaleString() || '0'}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <AlertCircle size={20} className="text-amber-400" />
              </div>
              <div>
                <p className="text-xs t-muted uppercase tracking-wider">Discrepancies</p>
                <p className="text-2xl font-bold t-primary">{run.discrepancies?.toLocaleString() || '0'}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <XCircle size={20} className="text-red-400" />
              </div>
              <div>
                <p className="text-xs t-muted uppercase tracking-wider">Exceptions</p>
                <p className="text-2xl font-bold t-primary">{run.exceptions?.toLocaleString() || '0'}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Database size={20} className="text-blue-400" />
              </div>
              <div>
                <p className="text-xs t-muted uppercase tracking-wider">Total Value</p>
                <p className="text-2xl font-bold t-primary">
                  {run.totalValue ? `R ${(run.totalValue / 1000000).toFixed(2)}M` : 'N/A'}
                </p>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* KPIs Generated */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">KPIs Generated ({run.kpis?.length || 0})</h3>
            </div>
            {run.kpis && run.kpis.length > 0 ? (
              <div className="space-y-3">
                {run.kpis.map((kpi: Record<string, unknown>, i: number) => (
                  <div key={i} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium t-primary">{kpi.name}</span>
                      <Badge variant={kpi.status === 'green' ? 'success' : kpi.status === 'amber' ? 'warning' : 'danger'} className="text-xs">
                        {kpi.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="t-muted">Value: <span className="t-primary font-medium">{kpi.value} {kpi.unit}</span></span>
                      <span className="t-muted">Target: <span className="t-primary">{kpi.target} {kpi.unit}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm t-muted">
                No KPIs generated in this run
              </div>
            )}
          </Card>

          {/* Metrics Created in Pulse */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Activity className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">Metrics Created in Pulse ({run.metrics?.length || 0})</h3>
            </div>
            {run.metrics && run.metrics.length > 0 ? (
              <div className="space-y-3">
                {run.metrics.map((metric: Record<string, unknown>, i: number) => (
                  <div key={i} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium t-primary">{metric.name}</span>
                      <Badge variant={metric.status === 'green' ? 'success' : metric.status === 'amber' ? 'warning' : 'danger'} className="text-xs">
                        {metric.status}
                      </Badge>
                    </div>
                    <div className="text-sm t-muted">
                      Value: <span className="t-primary font-medium">{metric.value} {metric.unit}</span>
                    </div>
                    <button
                      onClick={() => navigate(`/pulse?metric=${metric.id}`)}
                      className="text-xs text-accent hover:underline mt-1"
                    >
                      View in Pulse →
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm t-muted">
                No metrics created in this run
              </div>
            )}
          </Card>

          {/* Source Data Attribution */}
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">Source Data Processed</h3>
            </div>
            {run.sourceData && run.sourceData.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-card)]">
                      <th className="text-left py-2 px-3 t-muted font-medium">Record ID</th>
                      <th className="text-left py-2 px-3 t-muted font-medium">Source System</th>
                      <th className="text-left py-2 px-3 t-muted font-medium">Record Type</th>
                      <th className="text-right py-2 px-3 t-muted font-medium">Value</th>
                      <th className="text-center py-2 px-3 t-muted font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.sourceData.slice(0, 50).map((record: Record<string, unknown>, i: number) => (
                      <tr key={i} className="border-b border-[var(--border-card)]/50 hover:bg-[var(--bg-card-solid)]">
                        <td className="py-2 px-3 t-primary font-mono text-xs">{record.id}</td>
                        <td className="py-2 px-3 t-muted">{record.sourceSystem}</td>
                        <td className="py-2 px-3 t-muted">{record.recordType}</td>
                        <td className="py-2 px-3 text-right t-primary">{record.value?.toLocaleString()}</td>
                        <td className="py-2 px-3 text-center">
                          <Badge variant={record.status === 'matched' ? 'success' : record.status === 'discrepancy' ? 'warning' : 'danger'} className="text-xs">
                            {record.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {run.sourceData.length > 50 && (
                  <p className="text-xs t-muted text-center py-4">
                    Showing 50 of {run.sourceData.length} records
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-sm t-muted">
                No source data attribution available
              </div>
            )}
          </Card>

          {/* Execution Timeline */}
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Clock className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">Execution Timeline</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 rounded-full bg-blue-400 mt-1.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium t-primary">Run Started</p>
                  <p className="text-xs t-muted">{new Date(run.startedAt).toLocaleString()}</p>
                </div>
              </div>
              {run.completedAt && (
                <div className="flex items-start gap-3">
                  <div className={`w-3 h-3 rounded-full mt-1.5 ${run.status === 'success' ? 'bg-emerald-400' : run.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium t-primary">Run Completed</p>
                    <p className="text-xs t-muted">{new Date(run.completedAt).toLocaleString()}</p>
                    <p className="text-xs t-muted mt-1">
                      Duration: {Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000 / 60)} minutes
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 rounded-full bg-accent mt-1.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium t-primary">Health Scores Updated</p>
                  <p className="text-xs t-muted">Apex health dimensions recalculated with new data</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 rounded-full bg-accent mt-1.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium t-primary">Pulse Metrics Refreshed</p>
                  <p className="text-xs t-muted">{run.metrics?.length || 0} operational metrics updated</p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Add these imports at the top with other imports:
// import { Sparkles, Brain, TrendingUp } from "lucide-react";

// Add these state variables after existing state:
// const [llmInsights, setLlmInsights] = useState<{ summary: string; risks: string[]; actions: string[]; impact: string } | null>(null);
// const [loadingInsights, setLoadingInsights] = useState(false);

// Add these functions:
/*
async function generateLLMInsights() {
  setLoadingInsights(true);
  try {
    const response = await fetch(`/api/catalysts/runs/${runId}/llm-insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    if (data.success) {
      setLlmInsights(data.insights);
    }
  } catch (err) {
    console.error('Failed to generate LLM insights:', err);
  } finally {
    setLoadingInsights(false);
  }
}

async function loadCachedInsights() {
  try {
    const response = await fetch(`/api/catalysts/runs/${runId}/insights`);
    if (response.ok) {
      const data = await response.json();
      setLlmInsights(data);
    }
  } catch (err) {
    // No cached insights, that's ok
  }
}
*/

// Call loadCachedInsights in useEffect after loading run
