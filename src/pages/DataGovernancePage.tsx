/**
 * ADMIN-009: Data Governance Dashboard
 * Data retention, DSAR history, erasure history, encryption status, compliance checklist.
 * Route: /data-governance | Role: admin, support_admin, superadmin
 */
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import {
  Shield, Lock, FileText, Trash2, CheckCircle, XCircle,
  Clock, AlertTriangle, Database, Eye, Download, Key,
} from 'lucide-react';

interface RetentionPolicy {
  dataType: string;
  retentionDays: number;
  autoDelete: boolean;
  lastPurge: string;
  recordsAffected: number;
}

interface DSARRequest {
  id: string;
  type: 'access' | 'erasure' | 'portability' | 'rectification';
  requestedBy: string;
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
  createdAt: string;
  completedAt?: string;
  dueDate: string;
}

interface ComplianceItem {
  id: string;
  category: string;
  requirement: string;
  status: 'compliant' | 'non_compliant' | 'in_progress' | 'not_applicable';
  lastAudit: string;
}

export function DataGovernancePage() {
  const { activeTab, setActiveTab } = useTabState('retention');

  const [retentionPolicies] = useState<RetentionPolicy[]>([
    { dataType: 'Audit Logs', retentionDays: 365, autoDelete: true, lastPurge: new Date(Date.now() - 604800000).toISOString(), recordsAffected: 12400 },
    { dataType: 'Session Data', retentionDays: 30, autoDelete: true, lastPurge: new Date(Date.now() - 86400000).toISOString(), recordsAffected: 890 },
    { dataType: 'API Logs', retentionDays: 90, autoDelete: true, lastPurge: new Date(Date.now() - 2592000000).toISOString(), recordsAffected: 45200 },
    { dataType: 'User Activity', retentionDays: 180, autoDelete: false, lastPurge: new Date(Date.now() - 7776000000).toISOString(), recordsAffected: 8900 },
    { dataType: 'ERP Sync Logs', retentionDays: 60, autoDelete: true, lastPurge: new Date(Date.now() - 1296000000).toISOString(), recordsAffected: 23100 },
  ]);

  const [dsarRequests] = useState<DSARRequest[]>([
    { id: 'DSAR-001', type: 'access', requestedBy: 'john@acme.com', status: 'completed', createdAt: new Date(Date.now() - 1209600000).toISOString(), completedAt: new Date(Date.now() - 604800000).toISOString(), dueDate: new Date(Date.now() - 432000000).toISOString() },
    { id: 'DSAR-002', type: 'erasure', requestedBy: 'sarah@techstart.io', status: 'in_progress', createdAt: new Date(Date.now() - 432000000).toISOString(), dueDate: new Date(Date.now() + 2160000000).toISOString() },
    { id: 'DSAR-003', type: 'portability', requestedBy: 'mike@acme.com', status: 'pending', createdAt: new Date(Date.now() - 172800000).toISOString(), dueDate: new Date(Date.now() + 2332800000).toISOString() },
  ]);

  const [complianceItems] = useState<ComplianceItem[]>([
    { id: '1', category: 'Data Protection', requirement: 'Data encrypted at rest (AES-256)', status: 'compliant', lastAudit: new Date(Date.now() - 2592000000).toISOString() },
    { id: '2', category: 'Data Protection', requirement: 'Data encrypted in transit (TLS 1.3)', status: 'compliant', lastAudit: new Date(Date.now() - 2592000000).toISOString() },
    { id: '3', category: 'Access Control', requirement: 'Role-based access control enforced', status: 'compliant', lastAudit: new Date(Date.now() - 1296000000).toISOString() },
    { id: '4', category: 'Access Control', requirement: 'MFA enabled for admin accounts', status: 'in_progress', lastAudit: new Date(Date.now() - 1296000000).toISOString() },
    { id: '5', category: 'Audit', requirement: 'Comprehensive audit logging', status: 'compliant', lastAudit: new Date(Date.now() - 604800000).toISOString() },
    { id: '6', category: 'Audit', requirement: 'Tamper-proof audit trail', status: 'compliant', lastAudit: new Date(Date.now() - 604800000).toISOString() },
    { id: '7', category: 'GDPR', requirement: 'DSAR processing within 30 days', status: 'compliant', lastAudit: new Date(Date.now() - 2592000000).toISOString() },
    { id: '8', category: 'GDPR', requirement: 'Data minimization policy enforced', status: 'in_progress', lastAudit: new Date(Date.now() - 2592000000).toISOString() },
    { id: '9', category: 'POPIA', requirement: 'Consent management', status: 'compliant', lastAudit: new Date(Date.now() - 1296000000).toISOString() },
    { id: '10', category: 'POPIA', requirement: 'Information officer appointed', status: 'compliant', lastAudit: new Date(Date.now() - 1296000000).toISOString() },
  ]);

  const tabs = [
    { id: 'retention', label: 'Data Retention', icon: <Database size={14} /> },
    { id: 'dsar', label: 'DSAR Requests', icon: <FileText size={14} />, count: dsarRequests.filter(d => d.status === 'pending').length },
    { id: 'encryption', label: 'Encryption', icon: <Lock size={14} /> },
    { id: 'compliance', label: 'Compliance', icon: <Shield size={14} /> },
  ];

  const dsarTypeColor = (t: string) => t === 'erasure' ? 'danger' : t === 'access' ? 'info' : t === 'portability' ? 'warning' : 'default';
  const dsarStatusColor = (s: string) => s === 'completed' ? 'success' : s === 'in_progress' ? 'info' : s === 'pending' ? 'warning' : 'danger';
  const complianceColor = (s: string) => s === 'compliant' ? 'success' : s === 'non_compliant' ? 'danger' : s === 'in_progress' ? 'warning' : 'default';
  const complianceIcon = (s: string) => {
    if (s === 'compliant') return <CheckCircle size={14} className="text-emerald-400" />;
    if (s === 'non_compliant') return <XCircle size={14} className="text-red-400" />;
    if (s === 'in_progress') return <Clock size={14} className="text-amber-400" />;
    return <AlertTriangle size={14} className="t-muted" />;
  };

  const compliantCount = complianceItems.filter(c => c.status === 'compliant').length;
  const compliancePct = (compliantCount / complianceItems.length) * 100;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold t-primary">Data Governance</h1>
          <p className="text-xs t-muted">Data retention, privacy requests, encryption & compliance</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Compliance Score</p>
          <p className="text-xl font-bold" style={{ color: compliancePct >= 80 ? 'var(--accent)' : '#f59e0b' }}>{compliancePct.toFixed(0)}%</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Open DSARs</p>
          <p className="text-xl font-bold text-amber-400">{dsarRequests.filter(d => d.status !== 'completed' && d.status !== 'rejected').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Encryption</p>
          <p className="text-xl font-bold text-emerald-400">AES-256</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Retention Policies</p>
          <p className="text-xl font-bold t-primary">{retentionPolicies.length}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="retention" activeTab={activeTab}>
        <div className="space-y-2">
          {retentionPolicies.map((p) => (
            <Card key={p.dataType} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium t-primary">{p.dataType}</p>
                  <p className="text-[10px] t-muted">
                    Retain for {p.retentionDays} days · Last purge: {new Date(p.lastPurge).toLocaleDateString()} · {p.recordsAffected.toLocaleString()} records affected
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.autoDelete ? 'success' : 'warning'} className="text-[10px]">
                    {p.autoDelete ? 'Auto-delete' : 'Manual'}
                  </Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="dsar" activeTab={activeTab}>
        <div className="space-y-2">
          {dsarRequests.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono t-muted">{d.id}</span>
                    <Badge variant={dsarTypeColor(d.type)} className="text-[10px]">{d.type}</Badge>
                    <Badge variant={dsarStatusColor(d.status)} className="text-[10px]">{d.status.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-sm t-primary mt-1">Requested by: {d.requestedBy}</p>
                  <p className="text-[10px] t-muted mt-0.5">
                    Created: {new Date(d.createdAt).toLocaleDateString()} · Due: {new Date(d.dueDate).toLocaleDateString()}
                    {d.completedAt && ` · Completed: ${new Date(d.completedAt).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  {d.type === 'access' && <button className="p-1.5 rounded-md hover:bg-[var(--bg-secondary)] t-muted"><Eye size={14} /></button>}
                  {d.type === 'portability' && <button className="p-1.5 rounded-md hover:bg-[var(--bg-secondary)] t-muted"><Download size={14} /></button>}
                  {d.type === 'erasure' && <button className="p-1.5 rounded-md hover:bg-red-500/10 t-muted hover:text-red-400"><Trash2 size={14} /></button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="encryption" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Lock size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">At-Rest Encryption</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">Algorithm</span><span className="t-primary font-medium">AES-256-GCM</span></div>
              <div className="flex justify-between"><span className="t-muted">Key Management</span><span className="t-primary font-medium">Cloudflare KMS</span></div>
              <div className="flex justify-between"><span className="t-muted">Key Rotation</span><span className="t-primary font-medium">90 days</span></div>
              <div className="flex justify-between"><span className="t-muted">Status</span><Badge variant="success">Active</Badge></div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Key size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">In-Transit Encryption</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">Protocol</span><span className="t-primary font-medium">TLS 1.3</span></div>
              <div className="flex justify-between"><span className="t-muted">Certificate</span><span className="t-primary font-medium">Cloudflare Edge</span></div>
              <div className="flex justify-between"><span className="t-muted">HSTS</span><span className="t-primary font-medium">Enabled</span></div>
              <div className="flex justify-between"><span className="t-muted">Status</span><Badge variant="success">Active</Badge></div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Database size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">Database Encryption</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">D1 Encryption</span><span className="t-primary font-medium">SQLite encryption at rest</span></div>
              <div className="flex justify-between"><span className="t-muted">PII Fields</span><span className="t-primary font-medium">Column-level encryption</span></div>
              <div className="flex justify-between"><span className="t-muted">Backup Encryption</span><span className="t-primary font-medium">Enabled</span></div>
              <div className="flex justify-between"><span className="t-muted">Status</span><Badge variant="success">Active</Badge></div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">JWT Token Security</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">Algorithm</span><span className="t-primary font-medium">HS256</span></div>
              <div className="flex justify-between"><span className="t-muted">Expiry</span><span className="t-primary font-medium">24 hours</span></div>
              <div className="flex justify-between"><span className="t-muted">Refresh Token</span><span className="t-primary font-medium">7 days</span></div>
              <div className="flex justify-between"><span className="t-muted">Password Hash</span><span className="t-primary font-medium">PBKDF2 (100k rounds)</span></div>
            </div>
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="compliance" activeTab={activeTab}>
        <div className="space-y-4">
          {[...new Set(complianceItems.map(c => c.category))].map(cat => (
            <div key={cat}>
              <h3 className="text-xs font-medium t-primary mb-2 uppercase tracking-wider">{cat}</h3>
              <div className="space-y-1">
                {complianceItems.filter(c => c.category === cat).map(item => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">
                    <div className="flex items-center gap-2">
                      {complianceIcon(item.status)}
                      <span className="text-xs t-primary">{item.requirement}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] t-muted">Audit: {new Date(item.lastAudit).toLocaleDateString()}</span>
                      <Badge variant={complianceColor(item.status)} className="text-[10px]">{item.status.replace('_', ' ')}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </TabPanel>
    </div>
  );
}
