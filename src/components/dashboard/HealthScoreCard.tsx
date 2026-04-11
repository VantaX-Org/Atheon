/**
 * SPEC-004: Frontend Component Decomposition — Dashboard Health Score Card
 * Extracted from Dashboard.tsx monolith for better maintainability.
 */
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Dimension {
  key: string;
  label: string;
  score: number;
  trend: 'improving' | 'declining' | 'stable';
  delta: number;
}

interface Props {
  overallScore: number;
  previousScore?: number;
  dimensions: Dimension[];
  calculatedAt?: string;
  onDimensionClick?: (dimension: Dimension) => void;
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-500';
  if (score >= 60) return 'text-amber-500';
  return 'text-red-500';
}

function getScoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

const trendIcons = {
  improving: <TrendingUp size={14} className="text-emerald-500" />,
  declining: <TrendingDown size={14} className="text-red-500" />,
  stable: <Minus size={14} className="text-gray-400" />,
};

export function HealthScoreCard({ overallScore, previousScore, dimensions, calculatedAt, onDimensionClick }: Props) {
  const delta = previousScore !== undefined ? overallScore - previousScore : 0;

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'var(--bg-card-solid)',
        border: '1px solid var(--border-card)',
      }}
    >
      {/* Overall Score */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold t-primary">Health Score</h3>
          {calculatedAt && (
            <p className="text-[10px] t-muted mt-0.5">
              Updated {new Date(calculatedAt).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${getScoreColor(overallScore)}`}>
            {overallScore}
          </div>
          {delta !== 0 && (
            <div className={`text-[11px] flex items-center gap-1 justify-end ${delta > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {delta > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-2 rounded-full bg-[var(--bg-secondary)] mb-4">
        <div
          className={`h-full rounded-full transition-all duration-700 ${getScoreBg(overallScore)}`}
          style={{ width: `${Math.min(100, Math.max(0, overallScore))}%` }}
        />
      </div>

      {/* Dimensions */}
      <div className="space-y-2">
        {dimensions.map((dim) => (
          <button
            key={dim.key}
            onClick={() => onDimensionClick?.(dim)}
            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[var(--bg-secondary)] transition-all text-left"
          >
            <div className="flex items-center gap-2">
              {trendIcons[dim.trend]}
              <span className="text-xs t-secondary">{dim.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold ${getScoreColor(dim.score)}`}>{dim.score}</span>
              <div className="w-16 h-1.5 rounded-full bg-[var(--bg-secondary)]">
                <div
                  className={`h-full rounded-full ${getScoreBg(dim.score)}`}
                  style={{ width: `${dim.score}%` }}
                />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
