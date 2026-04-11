/**
 * SPEC-004: Frontend Component Decomposition — Risks List
 * Extracted from Dashboard.tsx for reuse across Dashboard and Pulse pages.
 */
import { AlertTriangle, ChevronRight } from 'lucide-react';

export interface Risk {
  id: string;
  title: string;
  severity: 'high' | 'medium' | 'low';
  category: string;
  status: 'active' | 'mitigated' | 'monitoring';
  description?: string;
  createdAt: string;
}

interface Props {
  risks: Risk[];
  maxItems?: number;
  onRiskClick?: (risk: Risk) => void;
  onViewAll?: () => void;
  compact?: boolean;
}

const severityColors = {
  high: { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/30' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/30' },
  low: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/30' },
};

export function RisksList({ risks, maxItems = 5, onRiskClick, onViewAll, compact = false }: Props) {
  const displayRisks = risks.slice(0, maxItems);

  if (risks.length === 0) {
    return (
      <div className="text-center py-6">
        <AlertTriangle size={24} className="mx-auto mb-2 t-muted opacity-40" />
        <p className="text-xs t-muted">No active risks detected</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {displayRisks.map((risk) => {
        const colors = severityColors[risk.severity];
        return (
          <button
            key={risk.id}
            onClick={() => onRiskClick?.(risk)}
            className={`w-full text-left rounded-xl p-3 transition-all hover:bg-[var(--bg-secondary)] border ${colors.border}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${colors.bg} ${colors.text}`}>
                    {risk.severity.toUpperCase()}
                  </span>
                  <span className="text-[10px] t-muted">{risk.category}</span>
                </div>
                <p className={`font-medium t-primary ${compact ? 'text-xs' : 'text-sm'} truncate`}>
                  {risk.title}
                </p>
                {!compact && risk.description && (
                  <p className="text-[11px] t-muted mt-0.5 line-clamp-2">{risk.description}</p>
                )}
              </div>
              <ChevronRight size={14} className="t-muted flex-shrink-0 mt-1" />
            </div>
          </button>
        );
      })}
      {risks.length > maxItems && onViewAll && (
        <button
          onClick={onViewAll}
          className="w-full text-center text-xs text-accent hover:underline py-2"
        >
          View all {risks.length} risks
        </button>
      )}
    </div>
  );
}
