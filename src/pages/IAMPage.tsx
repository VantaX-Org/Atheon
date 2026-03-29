import { useState, useEffect } from "react";
import { Portal } from "@/components/ui/portal";
import { useAppStore } from "@/stores/appStore";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { IAMPolicy, SSOConfig, IAMRole, IAMUser } from "@/lib/api";
import {
 Shield, Key, Users, UserCheck, Lock, Unlock, Plus,
 ShieldCheck, Globe, Loader2, X, Pencil, Trash2, Save
} from "lucide-react";

export function IAMPage() {
 const { activeTab, setActiveTab } = useTabState('policies');
 const [policies, setPolicies] = useState<IAMPolicy[]>([]);
 const [ssoConfigs, setSsoConfigs] = useState<SSOConfig[]>([]);
 const [roles, setRoles] = useState<IAMRole[]>([]);
 const [users, setUsers] = useState<IAMUser[]>([]);
 const [loading, setLoading] = useState(true);
 const [showNewPolicy, setShowNewPolicy] = useState(false);
 // Phase 4.5: User edit state
 const [editingUserId, setEditingUserId] = useState<string | null>(null);
 const [editRole, setEditRole] = useState('');
 const [savingUser, setSavingUser] = useState(false);
 const [creatingPolicy, setCreatingPolicy] = useState(false);
 const [policyForm, setPolicyForm] = useState({ name: '', description: '', type: 'rbac' });

 const activeTenantId = useAppStore((s) => s.activeTenantId);
 const userTenantId = useAppStore((s) => s.user?.tenantId);
 const tenantId = activeTenantId || userTenantId || '';

 const handleCreatePolicy = async () => {
 if (!policyForm.name.trim() || creatingPolicy) return;
 setCreatingPolicy(true);
 try {
 await api.iam.createPolicy({
 tenant_id: tenantId,
 name: policyForm.name.trim(),
 description: policyForm.description.trim(),
 type: policyForm.type,
 rules: []});
 const p = await api.iam.policies(tenantId);
 setPolicies(p.policies);
 setPolicyForm({ name: '', description: '', type: 'rbac' });
 setShowNewPolicy(false);
  } catch (err) {
  console.error('Failed to create policy', err);
  }
  setCreatingPolicy(false);
 };

 useEffect(() => {
 async function load() {
 setLoading(true);
 const [p, s, r, u] = await Promise.allSettled([
 api.iam.policies(tenantId), api.iam.sso(tenantId), api.iam.roles(tenantId), api.iam.users(tenantId),
 ]);
 if (p.status === 'fulfilled') setPolicies(p.value.policies);
 if (s.status === 'fulfilled') setSsoConfigs(s.value.configs);
 if (r.status === 'fulfilled') setRoles(r.value.roles);
 if (u.status === 'fulfilled') setUsers(u.value.users);
 setLoading(false);
 }
 load();
 }, [tenantId]);

 const tabs = [
 { id: 'policies', label: 'Policies', icon: <Shield size={14} />, count: policies.length },
 { id: 'users', label: 'Users', icon: <Users size={14} />, count: users.length },
 { id: 'sso', label: 'SSO / Identity', icon: <Key size={14} /> },
 { id: 'roles', label: 'Roles & Permissions', icon: <Users size={14} /> },
 ];

 if (loading) {
 return (
 <div className="flex items-center justify-center h-96">
 <Loader2 className="w-8 h-8 text-accent animate-spin" />
 </div>
 );
 }

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <div className=" w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
 <ShieldCheck className="w-5 h-5 text-accent"/>
 </div>
 <div>
 <h1 className="text-2xl font-bold t-primary">Identity & Access Management</h1>
 <p className="text-sm t-muted">RBAC/ABAC policies, SSO federation, per-tenant isolation</p>
 </div>
 </div>
 <Button variant="primary" size="sm" onClick={() => setShowNewPolicy(true)} title="Create a new access policy"><Plus size={14} /> New Policy</Button>
 </div>

 {/* New Policy Modal */}
 {showNewPolicy && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">Create New Policy</h3>
 <button onClick={() => setShowNewPolicy(false)} className="text-gray-400 hover:text-gray-400"><X size={18} /></button>
 </div>
 <div className="space-y-3">
 <div><label className="text-xs t-muted">Policy Name</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={policyForm.name} onChange={e => setPolicyForm(p => ({ ...p, name: e.target.value }))} placeholder="Read-only analysts" /></div>
 <div><label className="text-xs t-muted">Description</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={policyForm.description} onChange={e => setPolicyForm(p => ({ ...p, description: e.target.value }))} placeholder="Policy description" /></div>
 <div><label className="text-xs t-muted">Type</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={policyForm.type} onChange={e => setPolicyForm(p => ({ ...p, type: e.target.value }))}><option value="rbac">RBAC (Role-Based)</option><option value="abac">ABAC (Attribute-Based)</option></select></div>
 </div>
 <p className="text-[10px] text-gray-400">Rules can be added after creating the policy.</p>
 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => setShowNewPolicy(false)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleCreatePolicy} disabled={!policyForm.name.trim() || creatingPolicy}>
 {creatingPolicy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create Policy
 </Button>
 </div>
 </div>
 </div></Portal>
 )}

 {/* Summary */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <Card>
 <span className="text-xs t-secondary">Active Policies</span>
 <p className="text-2xl font-bold t-primary mt-1">{policies.length}</p>
 </Card>
 <Card>
 <span className="text-xs t-secondary">SSO Providers</span>
 <p className="text-2xl font-bold t-primary mt-1">{ssoConfigs.filter(s => s.enabled).length}</p>
 </Card>
 <Card>
 <span className="text-xs t-secondary">User Roles</span>
 <p className="text-2xl font-bold t-primary mt-1">{roles.length}</p>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Total Rules</span>
 <p className="text-2xl font-bold t-primary mt-1">{policies.reduce((s, p) => s + (Array.isArray(p.rules) ? p.rules.length : 0), 0)}</p>
 </Card>
 </div>

 <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

 {activeTab === 'policies' && (
 <TabPanel>
 <div className="space-y-4">
 {policies.map((policy) => (
 <Card key={policy.id}>
 <div className="flex items-start justify-between">
 <div>
 <div className="flex items-center gap-2">
 <h3 className="text-base font-semibold t-primary">{policy.name}</h3>
 <Badge variant={policy.type === 'rbac' ? 'info' : 'warning'} size="sm">{policy.type.toUpperCase()}</Badge>
 </div>
 <p className="text-xs t-muted mt-1">{policy.description}</p>
 <span className="text-[10px] text-gray-400">Tenant: {policy.tenantId}</span>
 </div>
 <Badge variant="outline">{Array.isArray(policy.rules) ? policy.rules.length : 0} rules</Badge>
 </div>

 <div className="mt-3 space-y-2">
 {(Array.isArray(policy.rules) ? policy.rules : []).map((rule, idx) => {
 const r = rule as Record<string, unknown>;
 return (
 <div key={idx} className="flex items-center gap-3 p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 {r.effect === 'allow' ? (
 <Unlock size={14} className="text-emerald-400" />
 ) : (
 <Lock size={14} className="text-red-400" />
 )}
 <span className="text-xs font-mono text-gray-400">{String(r.resource || '')}</span>
 <div className="flex gap-1">
 {(Array.isArray(r.actions) ? r.actions : []).map((a: unknown) => (
 <Badge key={String(a)} variant={r.effect === 'allow' ? 'success' : 'danger'} size="sm">{String(a)}</Badge>
 ))}
 </div>
 </div>
 );
 })}
 </div>
 </Card>
 ))}
 </div>
 </TabPanel>
 )}

 {/* Phase 4.5: Users Tab */}
 {activeTab === 'users' && (
 <TabPanel>
 <div className="space-y-3">
 {users.length === 0 && (
   <div className="text-center py-12 text-gray-400">
     <Users className="w-8 h-8 mx-auto mb-3 text-gray-300" />
     <p className="text-sm">No users found for this tenant</p>
   </div>
 )}
 {users.map((user) => (
 <Card key={user.id}>
 <div className="flex items-center justify-between">
   <div className="flex items-center gap-3">
     <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
       <UserCheck className="w-4 h-4 text-accent" />
     </div>
     <div>
       <p className="text-sm font-medium t-primary">{user.name}</p>
       <p className="text-xs t-muted">{user.email}</p>
     </div>
   </div>
   <div className="flex items-center gap-2">
     {editingUserId === user.id ? (
       <>
         <select
           value={editRole}
           onChange={(e) => setEditRole(e.target.value)}
           className="px-2 py-1 rounded-lg border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary"
         >
           {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
         </select>
         <Button variant="primary" size="sm" disabled={savingUser} onClick={async () => {
           setSavingUser(true);
           try {
             await api.iam.updateUser(user.id, { role: editRole });
             setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: editRole } : u));
           } catch (err) { console.error('Failed to update user role', err); }
           setEditingUserId(null);
           setSavingUser(false);
         }} title="Save role change">
           {savingUser ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
         </Button>
         <Button variant="secondary" size="sm" onClick={() => setEditingUserId(null)} title="Cancel editing"><X size={12} /></Button>
       </>
     ) : (
       <>
         <Badge variant={user.role?.includes('admin') ? 'danger' : user.role?.includes('exec') ? 'warning' : 'info'} size="sm">{user.role || 'viewer'}</Badge>
         <Button variant="secondary" size="sm" onClick={() => { setEditingUserId(user.id); setEditRole(user.role || 'viewer'); }} title="Edit user role"><Pencil size={12} /></Button>
         <Button variant="secondary" size="sm" onClick={async () => {
           if (!confirm(`Delete user ${user.name}?`)) return;
           try {
             await api.iam.deleteUser(user.id);
             setUsers(prev => prev.filter(u => u.id !== user.id));
           } catch (err) { console.error('Failed to delete user', err); }
         }} title="Delete user"><Trash2 size={12} className="text-red-400" /></Button>
       </>
     )}
   </div>
 </div>
 </Card>
 ))}
 </div>
 </TabPanel>
 )}

 {activeTab === 'sso' && (
 <TabPanel>
 <div className="space-y-4">
 {ssoConfigs.map((sso, i) => (
 <Card key={i}>
 <div className="flex items-start justify-between">
 <div className="flex items-center gap-3">
 <div className=" w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
 <Globe className="w-5 h-5 text-accent"/>
 </div>
 <div>
 <h3 className="text-base font-semibold t-primary">{sso.provider.replace('_', ' ').toUpperCase()}</h3>
 <span className="text-xs t-muted">{sso.domainHint}</span>
 </div>
 </div>
 <Badge variant={sso.enabled ? 'success' : 'default'}>{sso.enabled ? 'Active' : 'Disabled'}</Badge>
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
 <div className=" p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Client ID</span>
 <p className="text-xs t-secondary font-mono truncate">{sso.clientId}</p>
 </div>
 <div className=" p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Issuer URL</span>
 <p className="text-xs t-secondary font-mono truncate">{sso.issuerUrl}</p>
 </div>
 <div className=" p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Auto-Provision</span>
 <p className="text-xs t-secondary">{sso.autoProvision ? 'Yes' : 'No'}</p>
 </div>
 <div className=" p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Default Role</span>
 <p className="text-xs t-secondary">{sso.defaultRole}</p>
 </div>
 </div>
 </Card>
 ))}
 </div>
 </TabPanel>
 )}

 {activeTab === 'roles' && (
 <TabPanel>
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {roles.map((role) => {
 const Icon = role.name.toLowerCase().includes('admin') ? ShieldCheck : role.name.toLowerCase().includes('exec') ? Shield : role.name.toLowerCase().includes('manager') ? UserCheck : Users;
 const color = role.name.toLowerCase().includes('admin') ? 'text-red-400' : role.name.toLowerCase().includes('exec') ? 'text-accent' : role.name.toLowerCase().includes('manager') ? 'text-accent' : 'text-accent';
 return (
 <Card key={role.id}>
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-3">
 <Icon className={`w-5 h-5 ${color}`} />
 <h3 className="text-base font-semibold t-primary">{role.name}</h3>
 </div>
 <Badge variant="outline" size="sm">Level {role.level}</Badge>
 </div>
 <p className="text-xs t-muted">{role.description}</p>
 <div className="mt-3 flex items-center justify-between">
 <span className="text-[10px] text-gray-400">Users</span>
 <Badge variant="info" size="sm">{role.userCount}</Badge>
 </div>
 </Card>
 );
 })}
 </div>
 </TabPanel>
 )}
 </div>
 );
}
