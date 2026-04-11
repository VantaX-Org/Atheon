import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { Metric } from "@/lib/api";

const trendIcon = (trend: number[]) => {
  if (trend.length >= 2 && trend[trend.length - 1] > trend[0]) return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (trend.length >= 2 && trend[trend.length - 1] < trend[0]) return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
};

const trendLabel = (trend: number[]) => {
  if (trend.length >= 2 && trend[trend.length - 1] > trend[0]) return 'improving';
  if (trend.length >= 2 && trend[trend.length - 1] < trend[0]) return 'declining';
  return 'stable';
};

interface MetricsGridProps {
  metrics: Metric[];
}

export function MetricsGrid({ metrics }: MetricsGridProps) {
  if (metrics.length === 0) {
    return <p className="text-sm t-muted text-center py-8">No metrics available yet. Run catalysts to generate metrics.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {metrics.map((m, i) => (
        <div key={i} className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium t-muted uppercase tracking-wider">
              {m.name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </span>
            <Badge variant={m.status === 'red' ? 'danger' : m.status === 'amber' ? 'warning' : 'success'} size="sm">
              {m.status}
            </Badge>
          </div>
          <p className="text-xl font-bold t-primary">{typeof m.value === 'number' ? m.value.toFixed(1) : m.value}</p>
          <div className="flex items-center gap-1.5 mt-1">
            {trendIcon(m.trend)}
            <span className="text-xs t-muted">{trendLabel(m.trend)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
