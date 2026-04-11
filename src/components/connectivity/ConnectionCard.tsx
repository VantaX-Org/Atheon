/**
 * SPEC-016: Thin Pages Buildout — Connectivity Page Connection Card
 * Reusable card for MCP servers, A2A protocol, and ERP connection status.
 */
import { CheckCircle, AlertCircle, XCircle, RefreshCw } from 'lucide-react';

export interface Connection {
  id: string;
  name: string;
  type: 'mcp' | 'a2a' | 'erp' | 'api';
  status: 'connected' | 'disconnected' | 'error' | 'syncing';
  lastSync?: string;
  recordsSynced?: number;
  endpoint?: string;
  version?: string;
}

interface Props {
  connection: Connection;
  onSync?: (connection: Connection) => void;
  onConfigure?: (connection: Connection) => void;
}

const statusConfig = {
  connected: { icon: <CheckCircle size={14} />, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Connected' },
  disconnected: { icon: <XCircle size={14} />, color: 'text-gray-400', bg: 'bg-gray-500/10', label: 'Disconnected' },
  error: { icon: <AlertCircle size={14} />, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Error' },
  syncing: { icon: <RefreshCw size={14} className="animate-spin" />, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Syncing' },
};

const typeLabels = {
  mcp: 'MCP Server',
  a2a: 'A2A Protocol',
  erp: 'ERP Adapter',
  api: 'REST API',
};

export function ConnectionCard({ connection, onSync, onConfigure }: Props) {
  const status = statusConfig[connection.status];

  return (
    <div
      className="rounded-xl p-4 transition-all hover:bg-[var(--bg-secondary)]"
      style={{ border: '1px solid var(--border-card)' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${status.bg}`}>
            {status.icon}
          </div>
          <div>
            <h4 className="text-sm font-medium t-primary">{connection.name}</h4>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] t-muted">{typeLabels[connection.type]}</span>
              {connection.version && (
                <span className="text-[10px] px-1 rounded bg-[var(--bg-secondary)] t-muted">v{connection.version}</span>
              )}
            </div>
          </div>
        </div>
        <span className={`flex items-center gap-1 text-[10px] ${status.color}`}>
          {status.icon} {status.label}
        </span>
      </div>

      {connection.endpoint && (
        <p className="text-[10px] t-muted font-mono truncate mb-2">{connection.endpoint}</p>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[10px] t-muted">
          {connection.lastSync && (
            <span>Last sync: {new Date(connection.lastSync).toLocaleString()}</span>
          )}
          {connection.recordsSynced !== undefined && (
            <span>{connection.recordsSynced.toLocaleString()} records</span>
          )}
        </div>
        <div className="flex gap-1.5">
          {onSync && connection.status !== 'syncing' && (
            <button
              onClick={() => onSync(connection)}
              className="px-2 py-1 text-[10px] rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              Sync
            </button>
          )}
          {onConfigure && (
            <button
              onClick={() => onConfigure(connection)}
              className="px-2 py-1 text-[10px] rounded-lg bg-[var(--bg-secondary)] t-muted hover:t-primary transition-colors"
            >
              Configure
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
