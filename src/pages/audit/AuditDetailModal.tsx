import { X, Clock, User, Shield, FileText } from "lucide-react";

interface AuditEntry {
  id: string;
  user_id: string;
  action: string;
  layer: string;
  resource: string;
  details: string;
  outcome: string;
  created_at: string;
}

interface AuditDetailModalProps {
  entry: AuditEntry;
  onClose: () => void;
}

export function AuditDetailModal({ entry, onClose }: AuditDetailModalProps) {
  let parsedDetails: Record<string, unknown> = {};
  try { parsedDetails = JSON.parse(entry.details || '{}'); } catch { /* ignore */ }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl p-6 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold t-primary">Audit Entry Details</h3>
          <button onClick={onClose} className="t-muted hover:t-primary"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
            <p className="text-[10px] t-muted uppercase flex items-center gap-1"><Shield size={10} /> Action</p>
            <p className="text-sm font-medium t-primary mt-1">{entry.action}</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
            <p className="text-[10px] t-muted uppercase flex items-center gap-1"><User size={10} /> User</p>
            <p className="text-sm font-medium t-primary mt-1">{entry.user_id}</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
            <p className="text-[10px] t-muted uppercase flex items-center gap-1"><FileText size={10} /> Resource</p>
            <p className="text-sm font-medium t-primary mt-1">{entry.layer}/{entry.resource}</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
            <p className="text-[10px] t-muted uppercase flex items-center gap-1"><Clock size={10} /> Timestamp</p>
            <p className="text-sm font-medium t-primary mt-1">{new Date(entry.created_at).toLocaleString()}</p>
          </div>
        </div>

        <div>
          <p className="text-[10px] t-muted uppercase mb-2">Outcome</p>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
            entry.outcome === 'success' ? 'bg-emerald-500/10 text-emerald-500' :
            entry.outcome === 'denied' ? 'bg-red-500/10 text-red-500' :
            'bg-amber-500/10 text-amber-500'
          }`}>{entry.outcome}</span>
        </div>

        {Object.keys(parsedDetails).length > 0 && (
          <div>
            <p className="text-[10px] t-muted uppercase mb-2">Details</p>
            <pre className="p-3 rounded-lg text-xs t-secondary overflow-x-auto" style={{ background: 'var(--bg-secondary)' }}>
              {JSON.stringify(parsedDetails, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
