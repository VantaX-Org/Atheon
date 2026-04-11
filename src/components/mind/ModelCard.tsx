/**
 * SPEC-016: Thin Pages Buildout — Mind Page Model Card
 * Reusable AI model card for the Mind page showing inference stats and status.
 */
import { Brain, Zap, Clock, CheckCircle, AlertCircle } from 'lucide-react';

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  tier: 'fast' | 'balanced' | 'premium';
  status: 'active' | 'degraded' | 'offline';
  latencyMs: number;
  tokensPerSecond: number;
  costPer1kTokens: number;
  maxTokens: number;
  capabilities: string[];
}

interface Props {
  model: AIModel;
  onSelect?: (model: AIModel) => void;
  selected?: boolean;
}

const tierConfig = {
  fast: { label: 'Fast', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  balanced: { label: 'Balanced', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  premium: { label: 'Premium', color: 'text-amber-500', bg: 'bg-amber-500/10' },
};

const statusConfig = {
  active: { icon: <CheckCircle size={12} />, color: 'text-emerald-500', label: 'Active' },
  degraded: { icon: <AlertCircle size={12} />, color: 'text-amber-500', label: 'Degraded' },
  offline: { icon: <AlertCircle size={12} />, color: 'text-red-500', label: 'Offline' },
};

export function ModelCard({ model, onSelect, selected }: Props) {
  const tier = tierConfig[model.tier];
  const status = statusConfig[model.status];

  return (
    <button
      onClick={() => onSelect?.(model)}
      className={`w-full text-left p-4 rounded-xl transition-all ${
        selected ? 'ring-2 ring-accent bg-accent/5' : 'hover:bg-[var(--bg-secondary)]'
      }`}
      style={{ border: '1px solid var(--border-card)' }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tier.bg}`}>
            <Brain size={16} className={tier.color} />
          </div>
          <div>
            <h4 className="text-sm font-medium t-primary">{model.name}</h4>
            <p className="text-[10px] t-muted">{model.provider}</p>
          </div>
        </div>
        <div className={`flex items-center gap-1 ${status.color}`}>
          {status.icon}
          <span className="text-[10px]">{status.label}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 t-muted mb-0.5">
            <Clock size={10} />
            <span className="text-[9px]">Latency</span>
          </div>
          <span className="text-xs font-semibold t-primary">{model.latencyMs}ms</span>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 t-muted mb-0.5">
            <Zap size={10} />
            <span className="text-[9px]">Speed</span>
          </div>
          <span className="text-xs font-semibold t-primary">{model.tokensPerSecond} t/s</span>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 t-muted mb-0.5">
            <span className="text-[9px]">Cost</span>
          </div>
          <span className="text-xs font-semibold t-primary">${model.costPer1kTokens}/1k</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mt-3">
        {model.capabilities.slice(0, 4).map(cap => (
          <span
            key={cap}
            className="px-1.5 py-0.5 text-[9px] rounded bg-[var(--bg-secondary)] t-muted"
          >
            {cap}
          </span>
        ))}
        {model.capabilities.length > 4 && (
          <span className="text-[9px] t-muted">+{model.capabilities.length - 4}</span>
        )}
      </div>

      <div className="flex items-center justify-between mt-3">
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${tier.bg} ${tier.color}`}>
          {tier.label}
        </span>
        <span className="text-[10px] t-muted">{model.maxTokens.toLocaleString()} max tokens</span>
      </div>
    </button>
  );
}
