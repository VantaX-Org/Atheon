/**
 * ADMIN-008: Feature Flags System
 * Feature flag store, admin UI, flag types (boolean, percentage, tenant list), frontend/backend SDKs.
 * Route: /feature-flags | Role: superadmin only
 */
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Flag, Plus, Trash2, ToggleLeft, ToggleRight,
  Search, Percent, List,
} from 'lucide-react';

type FlagType = 'boolean' | 'percentage' | 'tenant_list';

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  type: FlagType;
  enabled: boolean;
  value: boolean | number | string[];
  environment: 'production' | 'staging' | 'all';
  updatedAt: string;
  updatedBy: string;
}

export function FeatureFlagsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [flags, setFlags] = useState<FeatureFlag[]>([
    { id: '1', key: 'enable_ai_chat_v2', name: 'AI Chat V2', description: 'Enable the new AI chat interface with streaming', type: 'boolean', enabled: true, value: true, environment: 'all', updatedAt: new Date(Date.now() - 86400000).toISOString(), updatedBy: 'superadmin@atheon.io' },
    { id: '2', key: 'catalyst_parallel_exec', name: 'Parallel Catalyst Execution', description: 'Allow catalysts to run in parallel within a cluster', type: 'percentage', enabled: true, value: 50, environment: 'production', updatedAt: new Date(Date.now() - 172800000).toISOString(), updatedBy: 'superadmin@atheon.io' },
    { id: '3', key: 'beta_knowledge_graph', name: 'Knowledge Graph Beta', description: 'Enable the new knowledge graph visualization', type: 'tenant_list', enabled: true, value: ['VantaX Demo', 'Acme Corp'], environment: 'production', updatedAt: new Date(Date.now() - 604800000).toISOString(), updatedBy: 'superadmin@atheon.io' },
    { id: '4', key: 'dark_mode_v2', name: 'Dark Mode V2', description: 'Enable the redesigned dark mode theme', type: 'boolean', enabled: false, value: false, environment: 'staging', updatedAt: new Date(Date.now() - 259200000).toISOString(), updatedBy: 'superadmin@atheon.io' },
    { id: '5', key: 'erp_batch_sync', name: 'ERP Batch Sync', description: 'Enable batch mode for ERP synchronization', type: 'percentage', enabled: true, value: 25, environment: 'production', updatedAt: new Date(Date.now() - 432000000).toISOString(), updatedBy: 'superadmin@atheon.io' },
  ]);

  const [newFlag, setNewFlag] = useState<{ key: string; name: string; description: string; type: FlagType; environment: 'production' | 'staging' | 'all' }>({ key: '', name: '', description: '', type: 'boolean', environment: 'all' });

  const toggleFlag = (id: string) => {
    setFlags(prev => prev.map(f => f.id === id ? { ...f, enabled: !f.enabled, updatedAt: new Date().toISOString() } : f));
  };

  const deleteFlag = (id: string) => {
    setFlags(prev => prev.filter(f => f.id !== id));
  };

  const createFlag = () => {
    if (!newFlag.key.trim() || !newFlag.name.trim()) return;
    const flag: FeatureFlag = {
      id: crypto.randomUUID(),
      key: newFlag.key,
      name: newFlag.name,
      description: newFlag.description,
      type: newFlag.type,
      enabled: false,
      value: newFlag.type === 'boolean' ? false : newFlag.type === 'percentage' ? 0 : [],
      environment: newFlag.environment,
      updatedAt: new Date().toISOString(),
      updatedBy: 'current-user',
    };
    setFlags(prev => [...prev, flag]);
    setShowCreate(false);
    setNewFlag({ key: '', name: '', description: '', type: 'boolean', environment: 'all' });
  };

  const filteredFlags = searchQuery
    ? flags.filter(f => f.key.includes(searchQuery.toLowerCase()) || f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : flags;

  const typeIcon = (t: FlagType) => {
    switch (t) {
      case 'boolean': return <ToggleLeft size={12} />;
      case 'percentage': return <Percent size={12} />;
      case 'tenant_list': return <List size={12} />;
    }
  };

  const envColor = (e: string) => e === 'production' ? 'danger' : e === 'staging' ? 'warning' : 'info';

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Flag className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold t-primary">Feature Flags</h1>
            <p className="text-xs t-muted">Control feature rollout across the platform</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1" /> New Flag
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Total Flags</p>
          <p className="text-xl font-bold t-primary">{flags.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Enabled</p>
          <p className="text-xl font-bold text-emerald-400">{flags.filter(f => f.enabled).length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Disabled</p>
          <p className="text-xl font-bold text-red-400">{flags.filter(f => !f.enabled).length}</p>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
        <input
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
          placeholder="Search flags by key or name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Flags list */}
      <div className="space-y-2">
        {filteredFlags.map((f) => (
          <Card key={f.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <button onClick={() => toggleFlag(f.id)} className="mt-0.5">
                  {f.enabled
                    ? <ToggleRight size={22} className="text-emerald-400" />
                    : <ToggleLeft size={22} className="t-muted" />}
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium t-primary">{f.name}</p>
                    <Badge variant={envColor(f.environment)} className="text-[10px]">{f.environment}</Badge>
                    <Badge variant="default" className="text-[10px] flex items-center gap-0.5">{typeIcon(f.type)} {f.type}</Badge>
                  </div>
                  <p className="text-[10px] font-mono t-muted mt-0.5">{f.key}</p>
                  <p className="text-xs t-muted mt-1">{f.description}</p>
                  {f.type === 'percentage' && (
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-24 h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${f.value as number}%` }} />
                      </div>
                      <span className="text-[10px] t-muted">{f.value as number}% rollout</span>
                    </div>
                  )}
                  {f.type === 'tenant_list' && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(f.value as string[]).map(t => <Badge key={t} variant="default" className="text-[10px]">{t}</Badge>)}
                    </div>
                  )}
                  <p className="text-[10px] t-muted mt-2">Updated {new Date(f.updatedAt).toLocaleDateString()} by {f.updatedBy}</p>
                </div>
              </div>
              <button onClick={() => deleteFlag(f.id)} className="p-1.5 rounded-md hover:bg-red-500/10 t-muted hover:text-red-400 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          </Card>
        ))}
      </div>

      {/* Create Flag Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold t-primary mb-4">Create Feature Flag</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Flag Key</label>
                <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary font-mono" value={newFlag.key} onChange={(e) => setNewFlag(p => ({ ...p, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} placeholder="e.g., enable_feature_x" />
              </div>
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Display Name</label>
                <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={newFlag.name} onChange={(e) => setNewFlag(p => ({ ...p, name: e.target.value }))} placeholder="Feature X" />
              </div>
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Description</label>
                <textarea className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" rows={2} value={newFlag.description} onChange={(e) => setNewFlag(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Type</label>
                  <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={newFlag.type} onChange={(e) => setNewFlag(p => ({ ...p, type: e.target.value as FlagType }))}>
                    <option value="boolean">Boolean</option>
                    <option value="percentage">Percentage</option>
                    <option value="tenant_list">Tenant List</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Environment</label>
                  <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={newFlag.environment} onChange={(e) => setNewFlag(p => ({ ...p, environment: e.target.value as 'production' | 'staging' | 'all' }))}>
                    <option value="all">All</option>
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowCreate(false)} className="flex-1">Cancel</Button>
              <Button onClick={createFlag} disabled={!newFlag.key.trim() || !newFlag.name.trim()} className="flex-1">
                <Plus size={14} className="mr-1" /> Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
