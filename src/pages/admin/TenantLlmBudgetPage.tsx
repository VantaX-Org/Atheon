/**
 * Superadmin-only page for managing a tenant's LLM token budget and PII
 * redaction settings (backend PR #226).
 *
 * Route: /admin/tenants/:id/llm
 *
 * Shows:
 *   - Current-month token usage with progress bar + colour bands
 *   - Reset date (when the monthly counter rolls over)
 *   - PII redaction toggle state
 *
 * Editable:
 *   - Monthly token budget (number, or "Unlimited" → null)
 *   - PII redaction enabled/disabled
 *
 * Role gating is handled at the route level in App.tsx via
 * <ProtectedRoute allowedRoles={SUPERADMIN_ROLES}>.
 */
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, ApiError } from '@/lib/api';
import type { LlmBudgetResponse } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { UsageBar, usageColor } from '@/components/UsageBar';
import { PageHeader } from '@/components/ui/page-header';
import {
  ArrowLeft, Shield, AlertTriangle, Calendar, Save, Info, CheckCircle, XCircle, Zap,
} from 'lucide-react';
import { format } from 'date-fns';

interface TenantMeta {
  id: string;
  name: string;
  slug: string;
}

function pctColorStyle(color: ReturnType<typeof usageColor>): string {
  if (color === 'red') return 'text-neg';
  if (color === 'amber') return 'text-[var(--warning)]';
  return 'text-accent';
}

export function TenantLlmBudgetPage() {
  const { id: tenantId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [budget, setBudget] = useState<LlmBudgetResponse | null>(null);
  const [tenantMeta, setTenantMeta] = useState<TenantMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [unlimited, setUnlimited] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>('');
  const [redactionEnabled, setRedactionEnabled] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    void loadData(tenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const loadData = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [budgetData, tenantData] = await Promise.all([
        api.admin.getLlmBudget(id),
        api.get<{ tenant: TenantMeta }>(`/api/v1/admin/tenants/${id}`).catch(() => null),
      ]);
      setBudget(budgetData);
      if (tenantData) setTenantMeta(tenantData.tenant);

      // Seed form from server state
      setUnlimited(budgetData.monthlyTokenBudget === null);
      setBudgetInput(
        budgetData.monthlyTokenBudget === null ? '' : String(budgetData.monthlyTokenBudget),
      );
      setRedactionEnabled(budgetData.llmRedactionEnabled);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load LLM budget';
      setError(message);
      toast.error('Failed to load LLM budget', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  };

  const parsedBudget = useMemo(() => {
    if (unlimited) return null;
    const n = Number(budgetInput);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.floor(n);
  }, [unlimited, budgetInput]);

  const isDirty = useMemo(() => {
    if (!budget) return false;
    const budgetChanged = unlimited
      ? budget.monthlyTokenBudget !== null
      : budget.monthlyTokenBudget !== parsedBudget;
    const redactionChanged = redactionEnabled !== budget.llmRedactionEnabled;
    return budgetChanged || redactionChanged;
  }, [budget, unlimited, parsedBudget, redactionEnabled]);

  const canSave = !saving && isDirty && (unlimited || (typeof parsedBudget === 'number' && !Number.isNaN(parsedBudget)));

  const handleSave = async () => {
    if (!tenantId || !budget) return;
    if (!unlimited && (typeof parsedBudget !== 'number' || Number.isNaN(parsedBudget))) {
      toast.error('Invalid budget', { message: 'Enter a non-negative integer or tick Unlimited.' });
      return;
    }
    setSaving(true);
    try {
      const body: { monthlyTokenBudget?: number | null; llmRedactionEnabled?: boolean } = {};
      if (
        (unlimited && budget.monthlyTokenBudget !== null) ||
        (!unlimited && budget.monthlyTokenBudget !== parsedBudget)
      ) {
        body.monthlyTokenBudget = unlimited ? null : (parsedBudget as number);
      }
      if (redactionEnabled !== budget.llmRedactionEnabled) {
        body.llmRedactionEnabled = redactionEnabled;
      }
      const updated = await api.admin.setLlmBudget(tenantId, body);
      setBudget(updated);
      setUnlimited(updated.monthlyTokenBudget === null);
      setBudgetInput(updated.monthlyTokenBudget === null ? '' : String(updated.monthlyTokenBudget));
      setRedactionEnabled(updated.llmRedactionEnabled);
      toast.success('LLM budget updated', {
        message: 'Changes have been saved and audit-logged.',
        requestId: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save LLM budget';
      toast.error('Save failed', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const usagePct = useMemo(() => {
    if (!budget || budget.monthlyTokenBudget === null || budget.monthlyTokenBudget <= 0) return 0;
    return Math.min((budget.tokensUsedThisMonth / budget.monthlyTokenBudget) * 100, 100);
  }, [budget]);

  const usageRag = usageColor(usagePct);
  const pctColorClass = pctColorStyle(usageRag);

  // Health pill derived from the existing usage band — RAG status only.
  const health = useMemo(() => {
    if (!budget || budget.monthlyTokenBudget === null) {
      return { label: 'Unlimited', dot: 'var(--accent)', pill: 'pill-accent' as const };
    }
    if (usageRag === 'red') return { label: 'Over', dot: 'var(--neg)', pill: 'pill-danger' as const };
    if (usageRag === 'amber') return { label: 'Near', dot: 'var(--warning)', pill: 'pill-warning' as const };
    return { label: 'Under', dot: 'var(--rag-healthy)', pill: 'pill-success' as const };
  }, [budget, usageRag]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        eyebrow="Tenants · LLM Budget"
        title="LLM Budget"
        dek={tenantMeta ? `${tenantMeta.name} · ${tenantMeta.slug}` : undefined}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/tenants')}>
            <ArrowLeft size={16} className="mr-2" />
            Back to Tenants
          </Button>
        }
      />

      {tenantMeta && (
        <div className="flex items-center gap-2">
          <span className="text-sm t-muted">Tenant:</span>
          <span className="text-sm font-medium t-primary">{tenantMeta.name}</span>
          <Badge variant="info" className="text-xs">{tenantMeta.slug}</Badge>
        </div>
      )}

      {error && (
        <div
          className="p-4 border rounded-md flex items-center gap-3"
          style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.2)' }}
        >
          <AlertTriangle size={18} className="text-neg flex-shrink-0" />
          <p className="text-sm text-neg">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-neg">
            <XCircle size={16} />
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && budget && (
        <>
          {/* Tokens used vs budget — hero card */}
          <Card>
            <div className="p-6 sm:p-8 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <p className="text-label flex items-center gap-2">
                  <Zap size={13} className="text-accent" aria-hidden />
                  Tokens Used vs Budget
                </p>
                <div className="flex items-center gap-2">
                  {!budget.exists && (
                    <Badge variant="default" className="text-xs">Defaults (no row yet)</Badge>
                  )}
                  <span
                    className={`pill ${health.pill} inline-flex items-center gap-1.5`}
                    role="status"
                    aria-label={`Budget health: ${health.label}`}
                  >
                    <span
                      aria-hidden
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: health.dot }}
                    />
                    Health · {health.label}
                  </span>
                </div>
              </div>

              {/* Twin hero metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2">
                <div className="pr-0 sm:pr-8">
                  <div
                    className="font-mono tnum t-primary font-bold tracking-tight leading-none"
                    style={{ fontSize: 'clamp(2.25rem, 6vw, 3.5rem)' }}
                  >
                    {budget.tokensUsedThisMonth.toLocaleString()}
                  </div>
                  <p className="text-label mt-3">Tokens Used</p>
                </div>
                <div
                  className="pt-6 sm:pt-0 sm:pl-8 mt-6 sm:mt-0 border-t sm:border-t-0 sm:border-l"
                  style={{ borderColor: 'var(--border-card)' }}
                >
                  <div
                    className="font-mono tnum font-bold tracking-tight leading-none"
                    style={{ fontSize: 'clamp(2.25rem, 6vw, 3.5rem)' }}
                  >
                    {budget.monthlyTokenBudget === null
                      ? <span className="text-accent">Unlimited</span>
                      : <span className="t-primary">{budget.monthlyTokenBudget.toLocaleString()}</span>}
                  </div>
                  <p className="text-label mt-3">Monthly Budget</p>
                </div>
              </div>

              {budget.monthlyTokenBudget === null ? (
                <div
                  className="p-4 rounded-sm border text-sm text-accent"
                  style={{ background: 'var(--accent-subtle)', borderColor: 'rgb(var(--accent-rgb) / 0.2)' }}
                >
                  This tenant is on an <strong>unlimited</strong> plan — no token cap is enforced.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-label">
                    <span>Consumption</span>
                    <span className={`font-mono tnum ${pctColorClass}`}>{usagePct.toFixed(1)}%</span>
                  </div>
                  <UsageBar
                    used={budget.tokensUsedThisMonth}
                    budget={budget.monthlyTokenBudget}
                    showLabel={false}
                    size="md"
                  />
                </div>
              )}

              {/* Meta strip */}
              <div
                className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-5 border-t"
                style={{ borderColor: 'var(--border-card)' }}
              >
                <div className="flex items-center gap-2">
                  <Calendar size={13} className="t-muted" aria-hidden />
                  <span className="text-label">Counter last reset</span>
                  <span className="text-sm font-medium t-primary font-mono tnum">
                    {budget.tokensResetAt
                      ? format(new Date(budget.tokensResetAt), 'PPP')
                      : '—'}
                  </span>
                  <span className="text-xs t-muted">(resets each calendar month)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-label">Redaction</span>
                  {budget.llmRedactionEnabled ? (
                    <Badge variant="success" className="text-xs">
                      <CheckCircle size={10} className="mr-1" />
                      Enabled
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="text-xs">
                      <AlertTriangle size={10} className="mr-1" />
                      Disabled
                    </Badge>
                  )}
                </div>
                {budget.updatedAt && (
                  <span className="text-xs t-muted font-mono tnum">
                    Last updated {format(new Date(budget.updatedAt), 'PPP p')}
                  </span>
                )}
              </div>
            </div>
          </Card>

          {/* Edit Form */}
          <Card>
            <div className="p-6 sm:p-8 space-y-6">
              <p className="text-label flex items-center gap-2">
                <Shield size={13} className="text-accent" aria-hidden />
                Set Budget &amp; Redaction
              </p>

              {/* Budget field */}
              <div className="space-y-2">
                <label htmlFor="llm-budget-input" className="block text-sm font-medium t-secondary">
                  Monthly token budget
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    id="llm-budget-input"
                    type="number"
                    min={0}
                    step={1000}
                    placeholder="e.g. 1000000"
                    value={budgetInput}
                    disabled={unlimited || saving}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    className="flex-1 max-w-xs px-3 py-2 rounded-md text-sm focus:outline-none focus:border-accent disabled:opacity-50 font-mono tnum"
                    style={{
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-card)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <label className="inline-flex items-center gap-2 text-sm t-secondary cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={unlimited}
                      disabled={saving}
                      onChange={(e) => setUnlimited(e.target.checked)}
                      className="w-4 h-4"
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    Unlimited
                  </label>
                </div>
                <p className="text-xs t-muted">
                  Tokens counted across all LLM calls (prompt + completion). When exceeded, subsequent calls are rejected until the monthly reset.
                </p>
              </div>

              {/* Redaction toggle */}
              <div className="space-y-2">
                <label className="block text-sm font-medium t-secondary">PII redaction</label>
                <div className="flex items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={redactionEnabled}
                      disabled={saving}
                      onChange={(e) => setRedactionEnabled(e.target.checked)}
                      className="w-4 h-4"
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span className={redactionEnabled ? 'text-accent' : 'text-[var(--warning)]'}>
                      {redactionEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                </div>
                <p className="text-xs t-muted flex items-start gap-1.5">
                  <Info size={12} className="mt-0.5 flex-shrink-0 t-muted" />
                  <span>
                    <strong className="t-secondary">Enabled (default):</strong> PII (emails, phones, IDs, credit cards) is redacted before LLM calls.
                    Disable only if this tenant has a DPA allowing raw PII processing.
                  </span>
                </p>
              </div>

              {/* Save actions */}
              <div
                className="flex flex-wrap items-center gap-3 pt-2 border-t"
                style={{ borderColor: 'var(--border-card)' }}
              >
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={!canSave}
                >
                  {saving ? (
                    <>
                      <div
                        className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin mr-2"
                        style={{ borderColor: 'var(--text-on-accent)', borderTopColor: 'transparent' }}
                      />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={14} className="mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
                <span className="text-xs t-muted inline-flex items-center gap-1">
                  <Info size={12} /> Changes are audit-logged
                </span>
                {isDirty && !saving && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (!budget) return;
                      setUnlimited(budget.monthlyTokenBudget === null);
                      setBudgetInput(
                        budget.monthlyTokenBudget === null ? '' : String(budget.monthlyTokenBudget),
                      );
                      setRedactionEnabled(budget.llmRedactionEnabled);
                    }}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <div className="text-xs t-muted">
            <Link to="/admin/tenants" className="text-accent hover:underline">
              Back to Tenant Management
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
