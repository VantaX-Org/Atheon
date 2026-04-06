/**
 * §11.4 Peer Comparison Bar — Range bar showing position vs industry peers
 */
import type { PeerBenchmarkItem } from '@/lib/api';

export function PeerComparisonBar({ benchmark }: { benchmark: PeerBenchmarkItem }) {
  const { dimension, p25Score, p50Score, p75Score, ownScore, percentileRank } = benchmark;
  const min = Math.max(0, p25Score - 10);
  const max = Math.min(100, p75Score + 10);
  const range = max - min || 1;

  const toPercent = (val: number) => Math.max(0, Math.min(100, ((val - min) / range) * 100));

  const rankColor = percentileRank === 'top_25' ? 'text-emerald-500' : percentileRank === 'above_median' ? 'text-blue-400' : percentileRank === 'below_median' ? 'text-amber-400' : 'text-red-400';
  const rankLabel = percentileRank === 'top_25' ? 'Top 25%' : percentileRank === 'above_median' ? 'Above Median' : percentileRank === 'below_median' ? 'Below Median' : percentileRank === 'bottom_25' ? 'Bottom 25%' : '—';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium t-primary capitalize">{dimension}</span>
        <span className={`text-[10px] font-medium ${rankColor}`}>{rankLabel}</span>
      </div>
      <div className="relative h-3 rounded-full bg-[var(--bg-secondary)]">
        {/* IQR range bar (P25-P75) */}
        <div
          className="absolute h-full rounded-full opacity-30"
          style={{
            left: `${toPercent(p25Score)}%`,
            width: `${toPercent(p75Score) - toPercent(p25Score)}%`,
            background: '#7AACB5',
          }}
        />
        {/* Median marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-[#7AACB5]"
          style={{ left: `${toPercent(p50Score)}%` }}
        />
        {/* Own score marker */}
        {ownScore !== null && (
          <div
            className="absolute top-[-2px] w-4 h-4 rounded-full border-2 border-white shadow-md"
            style={{
              left: `calc(${toPercent(ownScore)}% - 8px)`,
              background: percentileRank === 'top_25' ? '#4A6B5A' : percentileRank === 'above_median' ? '#60a5fa' : percentileRank === 'below_median' ? '#c9a059' : '#ef4444',
            }}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-[9px] t-muted">
        <span>P25: {p25Score}</span>
        <span>P50: {p50Score}</span>
        <span>P75: {p75Score}</span>
        {ownScore !== null && <span className="font-medium t-primary">You: {ownScore}</span>}
      </div>
    </div>
  );
}
