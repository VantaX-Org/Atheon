import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import type { AnomalyItem } from "@/lib/api";

interface AnomalyListProps {
  anomalies: AnomalyItem[];
}

export function AnomalyList({ anomalies }: AnomalyListProps) {
  if (anomalies.length === 0) {
    return <p className="text-sm t-muted text-center py-6">No anomalies detected.</p>;
  }

  return (
    <div className="space-y-2">
      {anomalies.map((a, i) => (
        <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
          <AlertTriangle size={16} className={a.severity === 'high' ? 'text-red-400' : a.severity === 'medium' ? 'text-amber-400' : 'text-gray-400'} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium t-primary">{a.metric}</p>
            <p className="text-xs t-secondary mt-0.5">{a.hypothesis || `Anomaly detected in ${a.metric}`}</p>
          </div>
          <Badge variant={a.severity === 'high' ? 'danger' : a.severity === 'medium' ? 'warning' : 'default'} size="sm">
            {a.severity}
          </Badge>
        </div>
      ))}
    </div>
  );
}
