/**
 * v46-platform: Custom Role Builder
 * Admin+ UI for composing custom roles from the platform's canonical permission
 * taxonomy (apex/pulse/catalysts/mind/memory/iam/admin × read/write).
 *
 * Custom roles may inherit from a built-in base role (analyst/operator/manager/
 * admin) — inherited permissions are shown pre-checked and read-only so the
 * user understands the cumulative set. A custom role with users assigned cannot
 * be deleted; the backend enforces this and returns 409.
 *
 * Route: /custom-roles | Role: admin, support_admin, superadmin
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { useAppStore } from '@/stores/appStore';
import { api, ApiError } from '@/lib/api';
import type { CustomRole } from '@/lib/api';
import {
  Shield, Plus, Pencil, Trash2, CheckCircle, Loader2, AlertCircle, Users,
} from 'lucide-react';

type BaseRole = { id: string; name: string; permissions: string[] };

interface FormState {
  name: string;
  description: string;
  inheritsFrom: string;
  permissions: string[];
}

const EMPTY_FORM: FormState = { name: '', description: '', inheritsFrom: '', permissions: [] };

/** Group permission strings by their leading namespace (apex, pulse, …). */
function groupPermissions(perms: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const p of perms) {
    const [ns] = p.split('.');
    if (!groups[ns]) groups[ns] = [];
    groups[ns].push(p);
  }
  return groups;
}

/** Human label for a permission string. `apex.read` → "read apex". */
function permLabel(p: string): string {
  const parts = p.split('.');
  if (parts.length < 2) return p;
  const action = parts.slice(1).join('.');
  return action;
}

export function CustomRoleBuilderPage() {
  const toast = useToast();
  const activeTenantId = useAppStore((s) => s.activeTenantId);
  const userTenantId = useAppStore((s) => s.user?.tenantId);
  const tenantId = activeTenantId || userTenantId || undefined;

  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [allPermissions, setAllPermissions] = useState<string[]>([]);
  const [baseRoles, setBaseRoles] = useState<BaseRole[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, {
      message,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const res = await api.iam.customRoles(tenantId);
      setRoles(res.roles);
    } catch (err) {
      showError('Failed to load custom roles', err, 'Network error');
    }
  }, [tenantId, showError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [rolesRes, permsRes] = await Promise.all([
          api.iam.customRoles(tenantId),
          api.iam.permissions(),
        ]);
        if (!cancelled) {
          setRoles(rolesRes.roles);
          setAllPermissions(permsRes.permissions);
          setBaseRoles(permsRes.baseRoles);
        }
      } catch (err) {
        if (!cancelled) showError('Failed to load custom roles', err, 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, showError]);

  /** Inherited permission set for the currently-selected base role. */
  const inheritedPerms = useMemo(() => {
    if (!form.inheritsFrom) return new Set<string>();
    const base = baseRoles.find(b => b.id === form.inheritsFrom);
    return new Set(base?.permissions || []);
  }, [form.inheritsFrom, baseRoles]);

  /** Permissions grouped by namespace for the matrix UI. */
  const permissionGroups = useMemo(() => groupPermissions(allPermissions), [allPermissions]);

  /** Is a permission currently granted (inherited OR explicit)? */
  const isGranted = (p: string): boolean => inheritedPerms.has(p) || form.permissions.includes(p);

  /** Inherited permissions cannot be unchecked — they come from the base role. */
  const isInherited = (p: string): boolean => inheritedPerms.has(p);

  const togglePermission = (p: string) => {
    if (isInherited(p)) return; // read-only
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(p)
        ? prev.permissions.filter(x => x !== p)
        : [...prev.permissions, p],
    }));
  };

  /** Toggle an entire group — if any child is unchecked, check all; else uncheck all. */
  const toggleGroup = (groupPerms: string[]) => {
    const togglable = groupPerms.filter(p => !isInherited(p));
    const anyUnchecked = togglable.some(p => !form.permissions.includes(p));
    setForm(prev => {
      if (anyUnchecked) {
        // Add any missing togglable perms
        const next = new Set(prev.permissions);
        togglable.forEach(p => next.add(p));
        return { ...prev, permissions: [...next] };
      } else {
        // Remove all togglable perms
        return { ...prev, permissions: prev.permissions.filter(p => !togglable.includes(p)) };
      }
    });
  };

  const startCreate = () => {
    setEditingRole(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const startEdit = (role: CustomRole) => {
    setEditingRole(role);
    setForm({
      name: role.name,
      description: role.description,
      inheritsFrom: role.inheritsFrom || '',
      permissions: [...role.permissions],
    });
    setShowForm(true);
  };

  const saveRole = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingRole) {
        await api.iam.updateCustomRole(editingRole.id, {
          name: form.name,
          description: form.description,
          inherits_from: form.inheritsFrom || null,
          permissions: form.permissions,
        }, tenantId);
        toast.success('Role updated', { message: form.name });
      } else {
        await api.iam.createCustomRole({
          name: form.name,
          description: form.description,
          inherits_from: form.inheritsFrom || undefined,
          permissions: form.permissions,
        }, tenantId);
        toast.success('Role created', { message: form.name });
      }
      setShowForm(false);
      setEditingRole(null);
      setForm(EMPTY_FORM);
      await reload();
    } catch (err) {
      showError(editingRole ? 'Failed to update role' : 'Failed to create role', err, 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role: CustomRole) => {
    if (role.userCount > 0) {
      toast.error('Cannot delete', { message: `${role.userCount} user(s) are still assigned to "${role.name}".` });
      return;
    }
    if (!window.confirm(`Delete custom role "${role.name}"? This cannot be undone.`)) return;
    setDeletingId(role.id);
    try {
      await api.iam.deleteCustomRole(role.id, tenantId);
      setRoles(prev => prev.filter(r => r.id !== role.id));
      toast.success('Role deleted', { message: role.name });
    } catch (err) {
      showError('Delete failed', err, 'Could not delete role');
    } finally {
      setDeletingId(null);
    }
  };

  // Summary for preview: "A user with this role can: <readable list>"
  const previewSummary = useMemo(() => {
    const all = new Set<string>([...form.permissions, ...inheritedPerms]);
    if (all.size === 0) return 'Nothing — this role has no permissions.';
    const byNs = groupPermissions([...all]);
    return Object.entries(byNs)
      .map(([ns, perms]) => `${perms.map(permLabel).join('/')} ${ns}`)
      .join('; ');
  }, [form.permissions, inheritedPerms]);

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        eyebrow="Access · Role Builder"
        title="Custom Role Builder"
        dek="Compose custom roles from the permission taxonomy"
        actions={
          <Button size="sm" onClick={startCreate}>
            <Plus size={14} className="mr-1" /> New Role
          </Button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-label">Custom Roles</p>
          <p className="mt-1 text-3xl font-bold t-primary leading-none" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>{roles.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-label">Assigned Users</p>
          <p className="mt-1 text-3xl font-bold t-primary leading-none" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>{roles.reduce((sum, r) => sum + r.userCount, 0)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-label">Permission Surface</p>
          <p className="mt-1 text-3xl font-bold t-primary leading-none" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>{allPermissions.length}</p>
        </Card>
      </div>

      {/* Roles list */}
      {loading ? (
        <LoadingState variant="list" count={3} />
      ) : roles.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No custom roles yet"
          description="Create a role to grant a tailored permission surface to users."
        />
      ) : (
        <div className="space-y-3">
          {roles.map((role) => (
            <Card key={role.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-[var(--accent-subtle)] flex items-center justify-center mt-0.5 flex-shrink-0">
                    <Shield size={16} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-semibold t-primary tracking-tight">{role.name}</p>
                      {role.inheritsFrom && (
                        <span className="pill-accent inline-flex items-center rounded-full border px-2 py-0.5 text-caption" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>
                          INHERITS {role.inheritsFrom.toUpperCase()}
                        </span>
                      )}
                    </div>
                    {role.description && <p className="text-sm t-secondary mt-1">{role.description}</p>}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {role.inheritedPermissions.slice(0, 3).map(p => (
                        <span key={`inh-${p}`} className="inline-flex items-center rounded-md border px-2 py-0.5 text-caption text-accent" style={{ fontFamily: "'Space Mono', ui-monospace, monospace", background: 'var(--accent-subtle)', borderColor: 'rgb(var(--accent-rgb) / 0.20)' }}>{p}</span>
                      ))}
                      {role.permissions.slice(0, 5).map(p => (
                        <span key={p} className="inline-flex items-center rounded-md border px-2 py-0.5 text-caption t-secondary" style={{ fontFamily: "'Space Mono', ui-monospace, monospace", background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}>{p}</span>
                      ))}
                      {(role.permissions.length + role.inheritedPermissions.length) > 8 && (
                        <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-caption t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace", background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}>
                          +{(role.permissions.length + role.inheritedPermissions.length) - 8} MORE
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-caption t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>
                      <span className="flex items-center gap-1.5"><Users size={11} /> {role.userCount} USER{role.userCount === 1 ? '' : 'S'}</span>
                      <span className="flex items-center gap-1.5"><Shield size={11} /> {role.permissions.length + role.inheritedPermissions.length} PERMS</span>
                      <span>CREATED {new Date(role.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => startEdit(role)}
                    className="p-2 rounded-md hover:bg-[var(--bg-secondary)] t-muted hover:t-primary transition-colors active:scale-[0.97]"
                    title="Edit"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => handleDelete(role)}
                    disabled={deletingId === role.id || role.userCount > 0}
                    className="p-2 rounded-md hover:bg-[rgb(var(--neg-rgb)/0.08)] t-muted hover:text-[var(--neg)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]"
                    title={role.userCount > 0 ? `${role.userCount} user(s) assigned — cannot delete` : 'Delete'}
                  >
                    {deletingId === role.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-overlay,rgb(0_0_0/0.4))] p-4 backdrop-blur-sm" onClick={() => !saving && setShowForm(false)}>
          <div
            className="rounded-xl border shadow-xl max-w-5xl w-full max-h-[92vh] overflow-y-auto"
            style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Editorial header */}
            <div className="px-7 pt-7 pb-5 border-b" style={{ borderColor: 'var(--border-card)' }}>
              <p className="text-label">
                Custom Role Builder · {editingRole ? editingRole.name : 'New Role'}
              </p>
              <input
                className="mt-2 w-full bg-transparent text-3xl font-bold tracking-tight t-primary outline-none placeholder:text-[var(--text-muted)] border-b-2 border-transparent focus:border-[var(--accent)] transition-colors"
                value={form.name}
                onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Enter Role Name"
                aria-label="Role Name"
              />
              <textarea
                className="mt-3 w-full bg-transparent text-sm t-secondary outline-none resize-none placeholder:text-[var(--text-muted)]"
                rows={2}
                value={form.description}
                onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Define what this role can do across the platform."
                aria-label="Description"
              />
            </div>

            {/* Two-column editorial body */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 p-7">
              {/* Left: permission matrix */}
              <div className="space-y-5">
                <div>
                  <label className="text-label">Inherits From</label>
                  <select
                    className="mt-1.5 w-full px-3 py-2 rounded-lg border text-sm t-primary"
                    style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}
                    value={form.inheritsFrom}
                    onChange={(e) => setForm(p => ({ ...p, inheritsFrom: e.target.value }))}
                  >
                    <option value="">(none)</option>
                    {baseRoles.map(b => (
                      <option key={b.id} value={b.id}>{b.name} — {b.permissions.length} perms</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-label">Permission Levels</p>
                    <span className="text-caption t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>
                      {form.permissions.length + inheritedPerms.size} GRANTED
                      {inheritedPerms.size > 0 && <span> · {inheritedPerms.size} INHERITED</span>}
                    </span>
                  </div>
                  <div className="rounded-lg border divide-y" style={{ borderColor: 'var(--border-card)' }}>
                    {Object.entries(permissionGroups).map(([ns, perms]) => {
                      const togglable = perms.filter(p => !isInherited(p));
                      const allChecked = togglable.length > 0 && togglable.every(p => form.permissions.includes(p));
                      return (
                        <div key={ns} className="p-4" style={{ borderColor: 'var(--border-card)' }}>
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-label" style={{ color: 'var(--text-primary)' }}>{ns}</p>
                            {togglable.length > 0 && (
                              <button
                                type="button"
                                className="text-caption text-accent hover:underline"
                                onClick={() => toggleGroup(perms)}
                                style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
                              >
                                {allChecked ? 'DESELECT ALL' : 'SELECT ALL'}
                              </button>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            {perms.map(p => {
                              const granted = isGranted(p);
                              const inherited = isInherited(p);
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  role="switch"
                                  aria-checked={granted}
                                  aria-label={p}
                                  disabled={inherited}
                                  onClick={() => togglePermission(p)}
                                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-colors active:scale-[0.99] ${
                                    inherited ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--bg-secondary)]'
                                  }`}
                                  style={inherited ? { background: 'var(--accent-subtle)' } : undefined}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span
                                      className={inherited ? 'text-accent' : (granted ? 't-primary' : 't-secondary')}
                                      style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
                                    >
                                      {p}
                                    </span>
                                    {inherited && (
                                      <span className="text-caption t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>INHERITED</span>
                                    )}
                                  </span>
                                  {/* Toggle track */}
                                  <span
                                    className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors"
                                    style={{
                                      background: granted ? 'var(--accent)' : 'var(--border-card)',
                                      opacity: inherited ? 0.7 : 1,
                                    }}
                                  >
                                    <span
                                      className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                                      style={{ transform: granted ? 'translateX(18px)' : 'translateX(2px)' }}
                                    />
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {editingRole && editingRole.userCount > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--warning)', background: 'rgb(var(--warning-rgb,180 120 40)/0.08)' }}>
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' }} />
                    <p className="text-xs t-primary">
                      {editingRole.userCount} user(s) currently have this role. Changes will apply to them immediately.
                    </p>
                  </div>
                )}
              </div>

              {/* Right: Effective Permissions Preview panel */}
              <aside className="lg:sticky lg:top-0 h-fit">
                <div className="rounded-xl border p-5" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-card)' }}>
                  <p className="text-label">Effective Permissions Preview</p>
                  <p
                    className="mt-3 text-5xl font-bold t-primary leading-none"
                    style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
                  >
                    {form.permissions.length + inheritedPerms.size}
                  </p>
                  <p className="mt-1 text-caption t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>
                    PERMISSIONS GRANTED
                    {inheritedPerms.size > 0 && <span> · {inheritedPerms.size} INHERITED</span>}
                  </p>

                  <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-card)' }}>
                    <p className="text-xs t-secondary leading-relaxed break-words">{previewSummary}</p>
                  </div>

                  <div className="mt-5 flex items-center gap-2">
                    {form.permissions.length + inheritedPerms.size > 0 ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption"
                        style={{ fontFamily: "'Space Mono', ui-monospace, monospace", background: 'rgb(var(--rag-healthy-rgb) / 0.10)', color: 'var(--rag-healthy)', borderColor: 'rgb(var(--rag-healthy-rgb) / 0.24)' }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--rag-healthy)' }} />
                        HEALTHY CONFIGURATION
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption"
                        style={{ fontFamily: "'Space Mono', ui-monospace, monospace", background: 'rgb(var(--warning-rgb,180 120 40) / 0.10)', color: 'var(--warning)', borderColor: 'rgb(var(--warning-rgb,180 120 40) / 0.24)' }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--warning)' }} />
                        NO PERMISSIONS
                      </span>
                    )}
                  </div>
                </div>
              </aside>
            </div>

            {/* Footer actions */}
            <div className="flex justify-end gap-2 px-7 py-5 border-t" style={{ borderColor: 'var(--border-card)' }}>
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving} title="Cancel role changes">Cancel</Button>
              <Button
                onClick={saveRole}
                disabled={saving || !form.name.trim() || (form.permissions.length + inheritedPerms.size === 0)}
              >
                {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : <CheckCircle size={14} className="mr-1" />}
                {editingRole ? 'Save Role' : 'Create Role'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
