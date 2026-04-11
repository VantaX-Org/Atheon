/**
 * SPEC-016: Thin Pages Buildout — Memory Page Knowledge Graph Card
 * Displays entity distribution and graph statistics for the GraphRAG memory system.
 */

export interface GraphEntity {
  type: string;
  count: number;
  color: string;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  avgConnections: number;
  clusters: number;
  lastUpdated?: string;
}

interface Props {
  entities: GraphEntity[];
  stats: GraphStats;
  onEntityClick?: (entity: GraphEntity) => void;
}

export function KnowledgeGraphCard({ entities, stats, onEntityClick }: Props) {
  const maxCount = Math.max(...entities.map(e => e.count), 1);

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'var(--bg-card-solid)',
        border: '1px solid var(--border-card)',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold t-primary">Knowledge Graph</h3>
          <p className="text-[10px] t-muted mt-0.5">
            {stats.totalNodes.toLocaleString()} nodes, {stats.totalEdges.toLocaleString()} edges
          </p>
        </div>
        {stats.lastUpdated && (
          <span className="text-[10px] t-muted">
            Updated {new Date(stats.lastUpdated).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Nodes', value: stats.totalNodes },
          { label: 'Edges', value: stats.totalEdges },
          { label: 'Avg Links', value: stats.avgConnections.toFixed(1) },
          { label: 'Clusters', value: stats.clusters },
        ].map(s => (
          <div key={s.label} className="text-center p-2 rounded-lg bg-[var(--bg-secondary)]">
            <div className="text-xs font-bold t-primary">{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</div>
            <div className="text-[9px] t-muted">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Entity distribution */}
      <div className="space-y-2">
        <h4 className="text-[10px] uppercase tracking-wider t-muted">Entity Distribution</h4>
        {entities.map(entity => (
          <button
            key={entity.type}
            onClick={() => onEntityClick?.(entity)}
            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-secondary)] transition-all"
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: entity.color }}
            />
            <span className="text-xs t-secondary flex-1 text-left">{entity.type}</span>
            <span className="text-xs font-semibold t-primary">{entity.count.toLocaleString()}</span>
            <div className="w-20 h-1.5 rounded-full bg-[var(--bg-secondary)]">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(entity.count / maxCount) * 100}%`,
                  background: entity.color,
                }}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
