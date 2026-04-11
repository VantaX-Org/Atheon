import { Badge } from "@/components/ui/badge";
import { Eye } from "lucide-react";

interface AuditEntry {
  id: string;
  timestamp: string;
  user_email: string;
  action: string;
  resource: string;
  ip_address?: string;
  status: string;
  details?: string;
}

interface AuditTableProps {
  entries: AuditEntry[];
  onViewDetail: (entry: AuditEntry) => void;
}

export function AuditTable({ entries, onViewDetail }: AuditTableProps) {
  if (entries.length === 0) {
    return <p className="text-sm t-muted text-center py-8">No audit entries found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" role="table" aria-label="Audit log entries">
        <thead>
          <tr className="border-b border-[var(--border-card)]">
            <th className="text-left py-3 px-4 text-xs font-medium t-muted uppercase tracking-wider">Timestamp</th>
            <th className="text-left py-3 px-4 text-xs font-medium t-muted uppercase tracking-wider">User</th>
            <th className="text-left py-3 px-4 text-xs font-medium t-muted uppercase tracking-wider">Action</th>
            <th className="text-left py-3 px-4 text-xs font-medium t-muted uppercase tracking-wider">Resource</th>
            <th className="text-left py-3 px-4 text-xs font-medium t-muted uppercase tracking-wider">Status</th>
            <th className="text-left py-3 px-4 text-xs font-medium t-muted uppercase tracking-wider">IP</th>
            <th className="py-3 px-4"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-[var(--border-card)] hover:bg-[var(--bg-secondary)] transition-colors">
              <td className="py-3 px-4 text-xs t-muted whitespace-nowrap">{new Date(entry.timestamp).toLocaleString()}</td>
              <td className="py-3 px-4 text-xs t-primary">{entry.user_email}</td>
              <td className="py-3 px-4 text-xs t-primary font-medium">{entry.action}</td>
              <td className="py-3 px-4 text-xs t-secondary">{entry.resource}</td>
              <td className="py-3 px-4">
                <Badge variant={entry.status === 'success' ? 'success' : entry.status === 'error' ? 'danger' : 'default'} size="sm">{entry.status}</Badge>
              </td>
              <td className="py-3 px-4 text-xs t-muted">{entry.ip_address || '-'}</td>
              <td className="py-3 px-4">
                <button onClick={() => onViewDetail(entry)} className="p-1 rounded hover:bg-[var(--bg-secondary)]" aria-label="View details">
                  <Eye size={14} className="t-muted" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
