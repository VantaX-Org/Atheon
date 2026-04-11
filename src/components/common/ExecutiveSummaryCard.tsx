/**
 * SPEC-019: Executive Dashboard Redesign
 * C-suite-ready summary card with KPI sparklines, trend indicators, and drill-down.
 */
import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, ChevronRight, ChevronDown } from 'lucide-react';
/** Simple inline sparkline using SVG polyline */
function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface ExecutiveKPI {
  label: string;
  value: number | string;
  unit?: string;
  trend: 'up' | 'down' | 'stable';
  changePercent?: number;
  sparkData?: number[];
  status: 'healthy' | 'warning' | 'critical';
}

interface Props {
  title: string;
  subtitle?: string;
  kpis: ExecutiveKPI[];
  onDrillDown?: (kpi: ExecutiveKPI) => void;
}

const statusColors = {
  healthy: 'text-emerald-500',
  warning: 'text-amber-500',
  critical: 'text-red-500',
};

const trendIcons = {
  up: <TrendingUp size={12} className="text-emerald-500" />,
  down: <TrendingDown size={12} className="text-red-500" />,
  stable: <Minus size={12} className="text-gray-400" />,
};

export function ExecutiveSummaryCard({ title, subtitle, kpis, onDrillDown }: Props) {
  const [expanded, setExpanded] = useState(false);
  const displayKpis = expanded ? kpis : kpis.slice(0, 4);

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'var(--bg-card-solid)',
        border: '1px solid var(--border-card)',
        boxShadow: '0 2px 12px rgba(100, 120, 180, 0.07)',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold t-primary">{title}</h3>
          {subtitle && <p className="text-[11px] t-muted mt-0.5">{subtitle}</p>}
        </div>
        {kpis.length > 4 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-accent flex items-center gap-1 hover:underline"
          >
            {expanded ? 'Show less' : `+${kpis.length - 4} more`}
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {displayKpis.map((kpi) => (
          <button
            key={kpi.label}
            onClick={() => onDrillDown?.(kpi)}
            className="p-3 rounded-xl text-left transition-all hover:bg-[var(--bg-secondary)] group"
            style={{ border: '1px solid var(--border-card)' }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] t-muted uppercase tracking-wider">{kpi.label}</span>
              <div className={`w-1.5 h-1.5 rounded-full ${
                kpi.status === 'healthy' ? 'bg-emerald-500' : kpi.status === 'warning' ? 'bg-amber-500' : 'bg-red-500'
              }`} />
            </div>
            <div className="flex items-end gap-1.5">
              <span className={`text-lg font-bold ${statusColors[kpi.status]}`}>
                {typeof kpi.value === 'number' ? kpi.value.toLocaleString() : kpi.value}
              </span>
              {kpi.unit && <span className="text-[10px] t-muted mb-0.5">{kpi.unit}</span>}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {trendIcons[kpi.trend]}
              {kpi.changePercent !== undefined && (
                <span className={`text-[10px] ${kpi.trend === 'up' ? 'text-emerald-500' : kpi.trend === 'down' ? 'text-red-500' : 't-muted'}`}>
                  {kpi.changePercent > 0 ? '+' : ''}{kpi.changePercent.toFixed(1)}%
                </span>
              )}
            </div>
            {kpi.sparkData && kpi.sparkData.length > 0 && (
              <div className="mt-2 h-6">
                <MiniSparkline data={kpi.sparkData} color={kpi.status === 'healthy' ? '#10b981' : kpi.status === 'warning' ? '#f59e0b' : '#ef4444'} />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
