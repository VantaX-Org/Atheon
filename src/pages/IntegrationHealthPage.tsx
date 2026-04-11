/**
 * ADMIN-010: Integration Health Monitoring
 * Per-connection health card, sync history, error log, data freshness, alerts.
 * Route: /integration-health | Role: admin, support_admin, superadmin
 */
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import {
  Wifi, CheckCircle, XCircle, AlertTriangle, Clock,
  RefreshCw,
} from 'lucide-react';

interface IntegrationConnection {
  id: string;
  name: string;
  type: string;
  status: 'healthy' | 'degraded' | 'error' | 'disconnected';
  lastSync: string;
  nextSync: string;
  recordsSynced: number;
  errorCount: number;
  dataFreshness: string;
  avgSyncDuration: string;
}

interface SyncEvent {
  id: string;
  connectionName: string;
  status: 'success' | 'partial' | 'failed';
  recordsProcessed: number;
  errors: number;
  duration: string;
  timestamp: string;
}

interface ErrorLogEntry {
  id: string;
  connectionName: string;
  errorType: string;
  message: string;
  timestamp: string;
  resolved: boolean;
}

export function IntegrationHealthPage() {
  const { activeTab, setActiveTab } = useTabState('connections');

  const [connections] = useState<IntegrationConnection[]>([
    { id: '1', name: 'SAP S/4HANA', type: 'ERP', status: 'healthy', lastSync: new Date(Date.now() - 900000).toISOString(), nextSync: new Date(Date.now() + 900000).toISOString(), recordsSynced: 45200, errorCount: 0, dataFreshness: '15 min', avgSyncDuration: '2m 34s' },
    { id: '2', name: 'Sage 300', type: 'ERP', status: 'healthy', lastSync: new Date(Date.now() - 3600000).toISOString(), nextSync: new Date(Date.now() + 900000).toISOString(), recordsSynced: 12800, errorCount: 2, dataFreshness: '1 hr', avgSyncDuration: '1m 12s' },
    { id: '3', name: 'Xero Accounting', type: 'Accounting', status: 'degraded', lastSync: new Date(Date.now() - 7200000).toISOString(), nextSync: new Date(Date.now() + 1800000).toISOString(), recordsSynced: 8400, errorCount: 15, dataFreshness: '2 hrs', avgSyncDuration: '45s' },
    { id: '4', name: 'Salesforce CRM', type: 'CRM', status: 'error', lastSync: new Date(Date.now() - 86400000).toISOString(), nextSync: new Date(Date.now() + 900000).toISOString(), recordsSynced: 0, errorCount: 42, dataFreshness: '24 hrs', avgSyncDuration: 'N/A' },
    { id: '5', name: 'Azure AD', type: 'Identity', status: 'healthy', lastSync: new Date(Date.now() - 300000).toISOString(), nextSync: new Date(Date.now() + 600000).toISOString(), recordsSynced: 245, errorCount: 0, dataFreshness: '5 min', avgSyncDuration: '12s' },
  ]);

  const [syncHistory] = useState<SyncEvent[]>([
    { id: '1', connectionName: 'SAP S/4HANA', status: 'success', recordsProcessed: 1240, errors: 0, duration: '2m 18s', timestamp: new Date(Date.now() - 900000).toISOString() },
    { id: '2', connectionName: 'Sage 300', status: 'success', recordsProcessed: 560, errors: 2, duration: '1m 05s', timestamp: new Date(Date.now() - 3600000).toISOString() },
    { id: '3', connectionName: 'Xero Accounting', status: 'partial', recordsProcessed: 320, errors: 15, duration: '52s', timestamp: new Date(Date.now() - 7200000).toISOString() },
    { id: '4', connectionName: 'Salesforce CRM', status: 'failed', recordsProcessed: 0, errors: 42, duration: '5s', timestamp: new Date(Date.now() - 86400000).toISOString() },
    { id: '5', connectionName: 'Azure AD', status: 'success', recordsProcessed: 245, errors: 0, duration: '11s', timestamp: new Date(Date.now() - 300000).toISOString() },
  ]);

  const [errorLog] = useState<ErrorLogEntry[]>([
    { id: '1', connectionName: 'Salesforce CRM', errorType: 'AUTH_EXPIRED', message: 'OAuth token expired — refresh failed. Re-authentication required.', timestamp: new Date(Date.now() - 86400000).toISOString(), resolved: false },
    { id: '2', connectionName: 'Xero Accounting', errorType: 'RATE_LIMIT', message: 'API rate limit exceeded (429). Backing off for 60s.', timestamp: new Date(Date.now() - 7200000).toISOString(), resolved: false },
    { id: '3', connectionName: 'Sage 300', errorType: 'DATA_VALIDATION', message: 'Invalid currency code "ZZZ" in 2 invoice records.', timestamp: new Date(Date.now() - 3600000).toISOString(), resolved: true },
  ]);

  const tabs = [
    { id: 'connections', label: 'Connections', icon: <Wifi size={14} />, count: connections.length },
    { id: 'sync-history', label: 'Sync History', icon: <RefreshCw size={14} /> },
    { id: 'errors', label: 'Error Log', icon: <AlertTriangle size={14} />, count: errorLog.filter(e => !e.resolved).length },
    { id: 'freshness', label: 'Data Freshness', icon: <Clock size={14} /> },
  ];

  const statusColor = (s: string) => s === 'healthy' || s === 'success' ? 'success' : s === 'degraded' || s === 'partial' ? 'warning' : 'danger';
  const statusIcon = (s: string) => {
    if (s === 'healthy' || s === 'success') return <CheckCircle size={14} className="text-emerald-400" />;
    if (s === 'degraded' || s === 'partial') return <AlertTriangle size={14} className="text-amber-400" />;
    return <XCircle size={14} className="text-red-400" />;
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Wifi className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold t-primary">Integration Health</h1>
          <p className="text-xs t-muted">Monitor connections, sync status, and data freshness</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Connections</p>
          <p className="text-xl font-bold t-primary">{connections.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Healthy</p>
          <p className="text-xl font-bold text-emerald-400">{connections.filter(c => c.status === 'healthy').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Errors</p>
          <p className="text-xl font-bold text-red-400">{connections.filter(c => c.status === 'error').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Records Synced</p>
          <p className="text-xl font-bold t-primary">{(connections.reduce((s, c) => s + c.recordsSynced, 0) / 1000).toFixed(1)}k</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="connections" activeTab={activeTab}>
        <div className="space-y-2">
          {connections.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  {statusIcon(c.status)}
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium t-primary">{c.name}</p>
                      <Badge variant="default" className="text-[10px]">{c.type}</Badge>
                      <Badge variant={statusColor(c.status)} className="text-[10px]">{c.status}</Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2 text-[10px]">
                      <div><span className="t-muted">Last Sync</span><p className="t-primary">{new Date(c.lastSync).toLocaleTimeString()}</p></div>
                      <div><span className="t-muted">Freshness</span><p className="t-primary">{c.dataFreshness}</p></div>
                      <div><span className="t-muted">Records</span><p className="t-primary">{c.recordsSynced.toLocaleString()}</p></div>
                      <div><span className="t-muted">Avg Duration</span><p className="t-primary">{c.avgSyncDuration}</p></div>
                    </div>
                  </div>
                </div>
                {c.errorCount > 0 && (
                  <Badge variant="danger" className="text-[10px]">{c.errorCount} errors</Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="sync-history" activeTab={activeTab}>
        <div className="space-y-2">
          {syncHistory.map((s) => (
            <Card key={s.id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {statusIcon(s.status)}
                <div>
                  <p className="text-sm font-medium t-primary">{s.connectionName}</p>
                  <p className="text-[10px] t-muted">
                    {s.recordsProcessed.toLocaleString()} records · {s.duration} · {s.errors > 0 ? `${s.errors} errors` : 'No errors'}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <Badge variant={statusColor(s.status)} className="text-[10px]">{s.status}</Badge>
                <p className="text-[10px] t-muted mt-1">{new Date(s.timestamp).toLocaleString()}</p>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="errors" activeTab={activeTab}>
        <div className="space-y-2">
          {errorLog.map((e) => (
            <Card key={e.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <XCircle size={14} className={e.resolved ? 't-muted' : 'text-red-400'} />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium t-primary">{e.connectionName}</p>
                      <Badge variant="danger" className="text-[10px] font-mono">{e.errorType}</Badge>
                      {e.resolved && <Badge variant="success" className="text-[10px]">resolved</Badge>}
                    </div>
                    <p className="text-xs t-muted mt-0.5">{e.message}</p>
                    <p className="text-[10px] t-muted mt-1">{new Date(e.timestamp).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="freshness" activeTab={activeTab}>
        <div className="space-y-2">
          {connections.map((c) => {
            const freshnessMinutes = c.dataFreshness.includes('hr') ? parseInt(c.dataFreshness) * 60 : parseInt(c.dataFreshness);
            const barColor = freshnessMinutes <= 15 ? 'var(--accent)' : freshnessMinutes <= 60 ? '#f59e0b' : '#ef4444';
            const maxMin = 24 * 60;
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium t-primary">{c.name}</span>
                    <Badge variant="default" className="text-[10px]">{c.type}</Badge>
                  </div>
                  <span className="text-xs font-medium" style={{ color: barColor }}>{c.dataFreshness}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min((freshnessMinutes / maxMin) * 100, 100)}%`, background: barColor }} />
                </div>
              </Card>
            );
          })}
        </div>
      </TabPanel>
    </div>
  );
}
