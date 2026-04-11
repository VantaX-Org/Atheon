/**
 * ADMIN-005: Bulk User Management
 * CSV import/export, bulk role change, bulk suspend/activate, import history.
 * Route: /bulk-users | Role: admin, support_admin, superadmin
 */
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import {
  Upload, Download, Users, FileText,
  Loader2, Clock,
} from 'lucide-react';

interface ImportRecord {
  id: string;
  fileName: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  status: 'completed' | 'processing' | 'failed';
  createdAt: string;
  createdBy: string;
}

interface BulkUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'suspended' | 'invited';
  selected: boolean;
}

export function BulkUserManagementPage() {
  const { activeTab, setActiveTab } = useTabState('import');
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importHistory] = useState<ImportRecord[]>([
    { id: '1', fileName: 'users-batch-march.csv', totalRows: 45, successCount: 42, errorCount: 3, status: 'completed', createdAt: new Date(Date.now() - 86400000).toISOString(), createdBy: 'admin@company.com' },
    { id: '2', fileName: 'new-hires-q2.csv', totalRows: 12, successCount: 12, errorCount: 0, status: 'completed', createdAt: new Date(Date.now() - 604800000).toISOString(), createdBy: 'hr@company.com' },
    { id: '3', fileName: 'contractor-import.csv', totalRows: 8, successCount: 0, errorCount: 8, status: 'failed', createdAt: new Date(Date.now() - 172800000).toISOString(), createdBy: 'admin@company.com' },
  ]);

  const [users, setUsers] = useState<BulkUser[]>([
    { id: '1', name: 'John Smith', email: 'john@company.com', role: 'analyst', status: 'active', selected: false },
    { id: '2', name: 'Sarah Connor', email: 'sarah@company.com', role: 'manager', status: 'active', selected: false },
    { id: '3', name: 'Mike Davis', email: 'mike@company.com', role: 'operator', status: 'active', selected: false },
    { id: '4', name: 'Emily Chen', email: 'emily@company.com', role: 'viewer', status: 'suspended', selected: false },
    { id: '5', name: 'James Wilson', email: 'james@company.com', role: 'analyst', status: 'active', selected: false },
    { id: '6', name: 'Lisa Park', email: 'lisa@company.com', role: 'operator', status: 'invited', selected: false },
  ]);
  const [bulkAction, setBulkAction] = useState('');

  const selectedCount = users.filter(u => u.selected).length;

  const toggleAll = () => {
    const allSelected = users.every(u => u.selected);
    setUsers(users.map(u => ({ ...u, selected: !allSelected })));
  };

  const toggleUser = (id: string) => {
    setUsers(users.map(u => u.id === id ? { ...u, selected: !u.selected } : u));
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    await new Promise(r => setTimeout(r, 2000));
    setUploading(false);
    setSelectedFile(null);
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedCount === 0) return;
    setUsers(users.map(u => {
      if (!u.selected) return u;
      if (bulkAction === 'suspend') return { ...u, status: 'suspended' as const, selected: false };
      if (bulkAction === 'activate') return { ...u, status: 'active' as const, selected: false };
      if (bulkAction.startsWith('role:')) return { ...u, role: bulkAction.split(':')[1], selected: false };
      return { ...u, selected: false };
    }));
    setBulkAction('');
  };

  const tabs = [
    { id: 'import', label: 'CSV Import', icon: <Upload size={14} /> },
    { id: 'export', label: 'Export', icon: <Download size={14} /> },
    { id: 'bulk-actions', label: 'Bulk Actions', icon: <Users size={14} />, count: selectedCount || undefined },
    { id: 'history', label: 'Import History', icon: <Clock size={14} /> },
  ];

  const statusColor = (s: string) => s === 'completed' ? 'success' : s === 'processing' ? 'info' : 'danger';
  const userStatusColor = (s: string) => s === 'active' ? 'success' : s === 'suspended' ? 'danger' : 'warning';

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Users className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold t-primary">Bulk User Management</h1>
          <p className="text-xs t-muted">Import, export, and manage users in bulk</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Total Users</p>
          <p className="text-xl font-bold t-primary">{users.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Active</p>
          <p className="text-xl font-bold text-emerald-400">{users.filter(u => u.status === 'active').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Suspended</p>
          <p className="text-xl font-bold text-red-400">{users.filter(u => u.status === 'suspended').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Imports</p>
          <p className="text-xl font-bold t-primary">{importHistory.length}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="import" activeTab={activeTab}>
        <Card className="p-6">
          <div className="text-center">
            <Upload size={32} className="mx-auto text-accent mb-3" />
            <h3 className="text-sm font-medium t-primary mb-1">Import Users via CSV</h3>
            <p className="text-xs t-muted mb-4">Upload a CSV file with columns: name, email, role, department</p>
            <div className="border-2 border-dashed border-[var(--border-card)] rounded-xl p-8 mb-4 hover:border-accent/50 transition-colors">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="hidden"
                id="csv-upload"
              />
              <label htmlFor="csv-upload" className="cursor-pointer">
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText size={16} className="text-accent" />
                    <span className="text-sm t-primary">{selectedFile.name}</span>
                    <span className="text-xs t-muted">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                  </div>
                ) : (
                  <p className="text-sm t-muted">Click to select CSV file or drag & drop</p>
                )}
              </label>
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedFile(null)} disabled={!selectedFile}>Clear</Button>
              <Button size="sm" onClick={handleUpload} disabled={!selectedFile || uploading}>
                {uploading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Upload size={14} className="mr-1" />}
                Upload & Import
              </Button>
            </div>
          </div>
          <div className="mt-6 p-4 rounded-lg bg-[var(--bg-secondary)]">
            <p className="text-xs font-medium t-primary mb-2">CSV Template</p>
            <pre className="text-[10px] t-muted font-mono">name,email,role,department{'\n'}John Smith,john@company.com,analyst,Engineering{'\n'}Sarah Connor,sarah@company.com,manager,Operations</pre>
            <Button variant="outline" size="sm" className="mt-2 text-xs">
              <Download size={12} className="mr-1" /> Download Template
            </Button>
          </div>
        </Card>
      </TabPanel>

      <TabPanel id="export" activeTab={activeTab}>
        <Card className="p-6 text-center">
          <Download size={32} className="mx-auto text-accent mb-3" />
          <h3 className="text-sm font-medium t-primary mb-1">Export Users</h3>
          <p className="text-xs t-muted mb-4">Download a CSV of all users in your organization</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm">
              <Download size={14} className="mr-1" /> Export as CSV
            </Button>
            <Button variant="outline" size="sm">
              <Download size={14} className="mr-1" /> Export as JSON
            </Button>
          </div>
        </Card>
      </TabPanel>

      <TabPanel id="bulk-actions" activeTab={activeTab}>
        <Card className="p-4">
          {/* Bulk action bar */}
          <div className="flex items-center justify-between mb-4 p-3 rounded-lg bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={users.every(u => u.selected)} onChange={toggleAll} className="rounded" />
              <span className="text-xs t-muted">{selectedCount} selected</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={bulkAction}
                onChange={(e) => setBulkAction(e.target.value)}
                className="text-xs rounded-lg border border-[var(--border-card)] bg-[var(--bg-primary)] t-primary px-2 py-1"
              >
                <option value="">Select action...</option>
                <option value="suspend">Suspend Users</option>
                <option value="activate">Activate Users</option>
                <option value="role:analyst">Change Role → Analyst</option>
                <option value="role:operator">Change Role → Operator</option>
                <option value="role:manager">Change Role → Manager</option>
                <option value="role:viewer">Change Role → Viewer</option>
              </select>
              <Button size="sm" onClick={handleBulkAction} disabled={!bulkAction || selectedCount === 0} className="text-xs">
                Apply
              </Button>
            </div>
          </div>

          {/* Users table */}
          <div className="space-y-1">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">
                <input type="checkbox" checked={u.selected} onChange={() => toggleUser(u.id)} className="rounded" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium t-primary">{u.name}</p>
                    <Badge variant={userStatusColor(u.status)} className="text-[10px]">{u.status}</Badge>
                  </div>
                  <p className="text-[10px] t-muted">{u.email} · {u.role}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </TabPanel>

      <TabPanel id="history" activeTab={activeTab}>
        <div className="space-y-2">
          {importHistory.map((h) => (
            <Card key={h.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText size={16} className="text-accent" />
                  <div>
                    <p className="text-sm font-medium t-primary">{h.fileName}</p>
                    <p className="text-[10px] t-muted">
                      {h.totalRows} rows · {h.successCount} success · {h.errorCount} errors · by {h.createdBy}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] t-muted">{new Date(h.createdAt).toLocaleDateString()}</span>
                  <Badge variant={statusColor(h.status)}>{h.status}</Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>
    </div>
  );
}
