/**
 * §11.8 Executive Mobile View — Single-page summary optimized for phone screens
 * Target: loads in < 2 seconds, minimal JS, no heavy charts
 */
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { ExecutiveSummaryResponse } from '@/lib/api';
import { TrendingUp, TrendingDown, AlertTriangle, Target, ArrowRight, RefreshCw, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';

function MiniScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score >= 75 ? '#4A6B5A' : score >= 50 ? '#c9a059' : '#ef4444';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-card)" strokeWidth="6" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference - progress}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold t-primary">{score}</span>
        <span className="text-[8px] t-muted">SCORE</span>
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value.toFixed(0)}`;
}

export function ExecutiveMobilePage() {
  const [data, setData] = useState<ExecutiveSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.executiveSummary.get();
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw size={24} className="animate-spin t-muted" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertTriangle size={24} className="text-amber-400" />
        <p className="text-sm t-muted">{error || 'Failed to load executive summary'}</p>
        <button onClick={loadData} className="text-xs px-4 py-2 rounded-lg bg-[#4A6B5A] text-white">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8 animate-fadeIn max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-[#4A6B5A]" />
          <h1 className="text-lg font-bold t-primary">Executive Summary</h1>
        </div>
        <button onClick={loadData} className="w-7 h-7 rounded-lg flex items-center justify-center t-muted hover:t-primary" style={{ background: 'var(--bg-secondary)' }}>
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Atheon Score — Hero */}
      <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
        <MiniScoreRing score={data.atheonScore} />
        <p className="text-xs t-muted mt-2">Atheon Score™</p>
        {data.journey.improvement !== null && (
          <div className="flex items-center justify-center gap-1 mt-1">
            {data.journey.improvement > 0 ? (
              <TrendingUp size={12} className="text-emerald-500" />
            ) : (
              <TrendingDown size={12} className="text-red-500" />
            )}
            <span className={`text-xs font-medium ${data.journey.improvement > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {data.journey.improvement > 0 ? '+' : ''}{data.journey.improvement.toFixed(1)} since baseline
            </span>
          </div>
        )}
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-3" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
          <p className="text-[10px] t-muted mb-1">Health Score</p>
          <p className="text-xl font-bold t-primary">{data.healthScore}</p>
        </div>
        <div className="rounded-xl p-3" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
          <p className="text-[10px] t-muted mb-1">ROI Multiple</p>
          <p className="text-xl font-bold text-emerald-500">{data.roi.multiple.toFixed(1)}x</p>
        </div>
        <div className="rounded-xl p-3" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
          <p className="text-[10px] t-muted mb-1">Value Recovered</p>
          <p className="text-xl font-bold text-[#4A6B5A]">{formatCurrency(data.roi.recovered)}</p>
        </div>
        <div className="rounded-xl p-3" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
          <p className="text-[10px] t-muted mb-1">Active RCAs</p>
          <p className="text-xl font-bold text-amber-400">{data.diagnostics.activeRcas}</p>
        </div>
      </div>

      {/* Top Risks */}
      {data.topRisks.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
          <h3 className="text-xs font-semibold t-primary mb-2 flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-red-400" /> Top Risks
          </h3>
          <div className="space-y-2">
            {data.topRisks.map((risk, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-xs t-secondary truncate max-w-[70%]">{risk.title}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                  risk.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                  risk.severity === 'high' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-gray-500/20 t-muted'
                }`}>{risk.severity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Targets */}
      {data.targets.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
          <h3 className="text-xs font-semibold t-primary mb-2 flex items-center gap-1.5">
            <Target size={12} className="text-[#4A6B5A]" /> Active Targets
          </h3>
          <div className="space-y-2">
            {data.targets.map((t, i) => {
              const progress = t.targetValue > 0 ? Math.min(100, (t.currentValue / t.targetValue) * 100) : 0;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="t-secondary capitalize">{t.targetName}</span>
                    <span className="t-muted">{Math.round(t.currentValue)}/{t.targetValue}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--bg-secondary)]">
                    <div className="h-full rounded-full bg-[#4A6B5A] transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Signals */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold t-primary">New Signals This Week</h3>
          <span className="text-lg font-bold text-[#7AACB5]">{data.signals.newThisWeek}</span>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-2">
        <Link to="/dashboard" className="rounded-xl p-3 text-center text-xs font-medium t-primary hover:opacity-80 transition-opacity flex items-center justify-center gap-1.5" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
          Full Dashboard <ArrowRight size={10} />
        </Link>
        <Link to="/apex" className="rounded-xl p-3 text-center text-xs font-medium t-primary hover:opacity-80 transition-opacity flex items-center justify-center gap-1.5" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
          Apex Radar <ArrowRight size={10} />
        </Link>
      </div>

      {/* Score Trend (lightweight — text-based) */}
      {data.trend.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
          <h3 className="text-xs font-semibold t-primary mb-2">Score Trend</h3>
          <div className="flex items-end gap-1 h-12">
            {data.trend.map((point, i) => (
              <div
                key={i}
                className="flex-1 rounded-t transition-all"
                style={{
                  height: `${Math.max(10, point.score)}%`,
                  background: point.score >= 75 ? '#4A6B5A' : point.score >= 50 ? '#c9a059' : '#ef4444',
                  opacity: 0.3 + (i / data.trend.length) * 0.7,
                }}
                title={`${point.date}: ${point.score}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
