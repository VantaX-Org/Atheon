/**
 * ADMIN-006: Custom Role Builder
 * Role builder wizard, custom roles per tenant (max 10), edit/delete, backend middleware update.
 * Route: /custom-roles | Role: admin, support_admin, superadmin
 */
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Shield, Plus, Edit2, Trash2, CheckCircle, Loader2,
} from 'lucide-react';

interface Permission {
  id: string;
  label: string;
  category: string;
  description: string;
}

interface CustomRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  userCount: number;
  createdAt: string;
  isSystem: boolean;
}

const ALL_PERMISSIONS: Permission[] = [
  { id: 'dashboard:read', label: 'View Dashboard', category: 'Intelligence', description: 'Access main dashboard' },
  { id: 'apex:read', label: 'View Apex', category: 'Intelligence', description: 'Access executive intelligence' },
  { id: 'pulse:read', label: 'View Pulse', category: 'Intelligence', description: 'Access process intelligence' },
  { id: 'catalysts:read', label: 'View Catalysts', category: 'Intelligence', description: 'Access autonomous catalysts' },
  { id: 'catalysts:execute', label: 'Execute Catalysts', category: 'Intelligence', description: 'Run catalyst actions' },
  { id: 'mind:read', label: 'View Mind', category: 'Intelligence', description: 'Access AI configuration' },
  { id: 'mind:write', label: 'Configure Mind', category: 'Intelligence', description: 'Modify AI settings' },
  { id: 'memory:read', label: 'View Memory', category: 'Data', description: 'Access knowledge graph' },
  { id: 'memory:write', label: 'Edit Memory', category: 'Data', description: 'Modify knowledge graph' },
  { id: 'iam:read', label: 'View Users', category: 'Administration', description: 'View user list and roles' },
  { id: 'iam:write', label: 'Manage Users', category: 'Administration', description: 'Create/edit/delete users' },
  { id: 'integrations:read', label: 'View Integrations', category: 'Administration', description: 'View ERP connections' },
  { id: 'integrations:write', label: 'Manage Integrations', category: 'Administration', description: 'Configure ERP adapters' },
  { id: 'audit:read', label: 'View Audit Log', category: 'Administration', description: 'Access audit trail' },
  { id: 'settings:read', label: 'View Settings', category: 'Administration', description: 'View tenant settings' },
  { id: 'settings:write', label: 'Manage Settings', category: 'Administration', description: 'Modify tenant settings' },
];

export function CustomRoleBuilderPage() {
  const [roles, setRoles] = useState<CustomRole[]>([
    { id: 'r1', name: 'Department Lead', description: 'Can view intelligence and manage team members', permissions: ['dashboard:read', 'apex:read', 'pulse:read', 'catalysts:read', 'iam:read'], userCount: 5, createdAt: new Date(Date.now() - 2592000000).toISOString(), isSystem: false },
    { id: 'r2', name: 'Data Analyst Pro', description: 'Extended analyst role with memory access', permissions: ['dashboard:read', 'pulse:read', 'memory:read', 'memory:write'], userCount: 8, createdAt: new Date(Date.now() - 1296000000).toISOString(), isSystem: false },
    { id: 'r3', name: 'Integration Admin', description: 'Focused on ERP and data integration management', permissions: ['dashboard:read', 'integrations:read', 'integrations:write', 'audit:read'], userCount: 2, createdAt: new Date(Date.now() - 604800000).toISOString(), isSystem: false },
  ]);
  const [showWizard, setShowWizard] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [newRole, setNewRole] = useState({ name: '', description: '', permissions: [] as string[] });
  const [saving, setSaving] = useState(false);

  const MAX_CUSTOM_ROLES = 10;

  const startCreate = () => {
    setNewRole({ name: '', description: '', permissions: [] });
    setWizardStep(0);
    setEditingRole(null);
    setShowWizard(true);
  };

  const startEdit = (role: CustomRole) => {
    setNewRole({ name: role.name, description: role.description, permissions: [...role.permissions] });
    setWizardStep(0);
    setEditingRole(role);
    setShowWizard(true);
  };

  const togglePermission = (permId: string) => {
    setNewRole(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permId)
        ? prev.permissions.filter(p => p !== permId)
        : [...prev.permissions, permId],
    }));
  };

  const saveRole = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 1000));
    if (editingRole) {
      setRoles(prev => prev.map(r => r.id === editingRole.id ? { ...r, name: newRole.name, description: newRole.description, permissions: newRole.permissions } : r));
    } else {
      setRoles(prev => [...prev, { id: crypto.randomUUID(), name: newRole.name, description: newRole.description, permissions: newRole.permissions, userCount: 0, createdAt: new Date().toISOString(), isSystem: false }]);
    }
    setSaving(false);
    setShowWizard(false);
  };

  const deleteRole = (id: string) => {
    setRoles(prev => prev.filter(r => r.id !== id));
  };

  const categories = [...new Set(ALL_PERMISSIONS.map(p => p.category))];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold t-primary">Custom Role Builder</h1>
            <p className="text-xs t-muted">Create custom roles with granular permissions (max {MAX_CUSTOM_ROLES})</p>
          </div>
        </div>
        <Button size="sm" onClick={startCreate} disabled={roles.length >= MAX_CUSTOM_ROLES}>
          <Plus size={14} className="mr-1" /> New Role
        </Button>
      </div>

      {/* Role count indicator */}
      <Card className="p-3 flex items-center justify-between">
        <span className="text-xs t-muted">{roles.length} of {MAX_CUSTOM_ROLES} custom roles used</span>
        <div className="w-32 h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
          <div className="h-full rounded-full bg-accent" style={{ width: `${(roles.length / MAX_CUSTOM_ROLES) * 100}%` }} />
        </div>
      </Card>

      {/* Roles list */}
      <div className="space-y-2">
        {roles.map((role) => (
          <Card key={role.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center mt-0.5">
                  <Shield size={14} className="text-accent" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium t-primary">{role.name}</p>
                    {role.isSystem && <Badge variant="info" className="text-[10px]">system</Badge>}
                  </div>
                  <p className="text-xs t-muted mt-0.5">{role.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {role.permissions.slice(0, 5).map(p => (
                      <Badge key={p} variant="default" className="text-[10px]">{p}</Badge>
                    ))}
                    {role.permissions.length > 5 && (
                      <Badge variant="default" className="text-[10px]">+{role.permissions.length - 5} more</Badge>
                    )}
                  </div>
                  <p className="text-[10px] t-muted mt-2">{role.userCount} users · Created {new Date(role.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              {!role.isSystem && (
                <div className="flex items-center gap-1">
                  <button onClick={() => startEdit(role)} className="p-1.5 rounded-md hover:bg-[var(--bg-secondary)] t-muted hover:t-primary transition-colors">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => deleteRole(role.id)} className="p-1.5 rounded-md hover:bg-red-500/10 t-muted hover:text-red-400 transition-colors" disabled={role.userCount > 0}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Wizard Modal */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowWizard(false)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold t-primary mb-4">
              {editingRole ? 'Edit Role' : 'Create Custom Role'} — Step {wizardStep + 1} of 3
            </h3>

            {/* Step indicators */}
            <div className="flex items-center gap-2 mb-6">
              {['Details', 'Permissions', 'Review'].map((step, i) => (
                <div key={step} className="flex items-center gap-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium ${
                    i <= wizardStep ? 'bg-accent text-white' : 'bg-[var(--bg-secondary)] t-muted'
                  }`}>{i + 1}</div>
                  <span className="text-xs t-muted">{step}</span>
                  {i < 2 && <div className="w-8 h-px bg-[var(--border-card)]" />}
                </div>
              ))}
            </div>

            {wizardStep === 0 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Role Name</label>
                  <input
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                    value={newRole.name}
                    onChange={(e) => setNewRole(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Department Lead"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Description</label>
                  <textarea
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                    rows={3}
                    value={newRole.description}
                    onChange={(e) => setNewRole(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe what this role can do..."
                  />
                </div>
              </div>
            )}

            {wizardStep === 1 && (
              <div className="space-y-4">
                {categories.map(cat => (
                  <div key={cat}>
                    <p className="text-xs font-medium t-primary mb-2">{cat}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ALL_PERMISSIONS.filter(p => p.category === cat).map(perm => (
                        <label key={perm.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors">
                          <input
                            type="checkbox"
                            checked={newRole.permissions.includes(perm.id)}
                            onChange={() => togglePermission(perm.id)}
                            className="mt-0.5 rounded"
                          />
                          <div>
                            <p className="text-xs font-medium t-primary">{perm.label}</p>
                            <p className="text-[10px] t-muted">{perm.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {wizardStep === 2 && (
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-[var(--bg-secondary)]">
                  <div className="flex justify-between text-xs mb-2"><span className="t-muted">Name:</span><span className="t-primary font-medium">{newRole.name}</span></div>
                  <div className="flex justify-between text-xs mb-2"><span className="t-muted">Description:</span><span className="t-primary">{newRole.description}</span></div>
                  <div className="text-xs"><span className="t-muted">Permissions ({newRole.permissions.length}):</span></div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {newRole.permissions.map(p => <Badge key={p} variant="default" className="text-[10px]">{p}</Badge>)}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={() => wizardStep === 0 ? setShowWizard(false) : setWizardStep(s => s - 1)}>
                {wizardStep === 0 ? 'Cancel' : 'Back'}
              </Button>
              {wizardStep < 2 ? (
                <Button onClick={() => setWizardStep(s => s + 1)} disabled={wizardStep === 0 && !newRole.name.trim()}>
                  Next
                </Button>
              ) : (
                <Button onClick={saveRole} disabled={saving || !newRole.name.trim() || newRole.permissions.length === 0}>
                  {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : <CheckCircle size={14} className="mr-1" />}
                  {editingRole ? 'Save Changes' : 'Create Role'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
