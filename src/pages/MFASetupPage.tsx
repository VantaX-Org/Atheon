/**
 * MFASetupPage — dedicated route (/settings/mfa) that hosts the enrollment wizard + management UI.
 *
 * The page consolidates:
 *  - Current MFA status (enabled/disabled, backup codes remaining).
 *  - Enrollment wizard (when disabled).
 *  - Backup-code regeneration (requires fresh TOTP).
 *  - Disable MFA (requires fresh TOTP, with a warning for admin roles under enforcement).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Shield, Loader2, RefreshCw, XCircle, ArrowLeft, AlertTriangle, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { MFAEnrollmentWizard } from '@/components/MFAEnrollmentWizard';
import { BackupCodesDisplay } from '@/components/BackupCodesDisplay';

const ADMIN_ROLES = new Set(['superadmin', 'support_admin', 'admin']);

/**
 * Presentational enrollment stepper (Login → MFA Setup → Confirmation).
 * `activeStep` is derived purely from existing page state — no new data.
 *   1 = login already done (always complete on this route)
 *   2 = MFA setup (active while not yet enabled)
 *   3 = confirmation (complete once MFA is enabled)
 */
function MfaStepper({ activeStep }: { activeStep: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: 'Step 1 · Login' },
    { n: 2, label: 'Step 2 · MFA Setup' },
    { n: 3, label: 'Step 3 · Confirmation' },
  ] as const;
  return (
    <ol className="flex items-start justify-center gap-0" aria-label="Setup progress">
      {steps.map((s, i) => {
        const done = s.n < activeStep;
        const active = s.n === activeStep;
        const reached = s.n <= activeStep;
        return (
          <li key={s.n} className="flex items-start">
            <div className="flex flex-col items-center gap-2" style={{ width: 132 }}>
              <span
                aria-current={active ? 'step' : undefined}
                className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold transition-colors"
                style={
                  reached
                    ? { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }
                    : { background: 'var(--bg-input)', color: 'var(--text-muted)', border: '1px solid var(--border-card)' }
                }
              >
                {done ? <Check size={14} /> : s.n}
              </span>
              <span
                className="text-label text-center leading-tight"
                style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="mt-3.5 h-px"
                style={{ width: 56, background: s.n < activeStep ? 'var(--accent)' : 'var(--border-card)' }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function MFASetupPage() {
  const user = useAppStore((s) => s.user);
  const mfaEnforcementWarning = useAppStore((s) => s.mfaEnforcementWarning);
  const setMfaEnforcementWarning = useAppStore((s) => s.setMfaEnforcementWarning);
  const navigate = useNavigate();

  const [status, setStatus] = useState<{ enabled: boolean; backupCodesRemaining?: number } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  // Regenerate backup codes flow
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  // Disable MFA flow
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  const isAdminRole = useMemo(() => (user?.role ? ADMIN_ROLES.has(user.role) : false), [user?.role]);
  const graceExpired = isAdminRole && mfaEnforcementWarning && mfaEnforcementWarning.daysRemaining <= 0;

  // Stepper position (presentation only): enabled → confirmation, otherwise MFA-setup stage.
  const activeStep: 1 | 2 | 3 = status?.enabled ? 3 : 2;

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await api.auth.mfaStatus();
      setStatus({ enabled: !!res.enabled, backupCodesRemaining: res.backupCodesRemaining });
      // Once MFA is enabled, clear any grace-period warning.
      if (res.enabled && mfaEnforcementWarning) setMfaEnforcementWarning(null);
    } catch {
      // Status endpoint may not exist in all deployments — gracefully fall back to "unknown".
      setStatus({ enabled: false });
    } finally {
      setStatusLoading(false);
    }
  // mfaEnforcementWarning/setter intentionally stable via zustand — include to satisfy lint but they don't change identity.
  }, [mfaEnforcementWarning, setMfaEnforcementWarning]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleWizardComplete = () => {
    setShowWizard(false);
    setMfaEnforcementWarning(null);
    loadStatus();
  };

  const handleRegenerate = async () => {
    if (regenCode.length !== 6) { setRegenError('Enter the 6-digit code from your authenticator'); return; }
    setRegenLoading(true);
    setRegenError(null);
    try {
      const res = await api.auth.mfaRegenerateBackupCodes(regenCode);
      const codes = res.backupCodes || res.backup_codes || [];
      if (codes.length === 0) {
        setRegenError('Server did not return new codes — please try again.');
      } else {
        setNewBackupCodes(codes);
        setRegenOpen(false);
        setRegenCode('');
      }
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Failed to regenerate codes');
    } finally {
      setRegenLoading(false);
    }
  };

  const handleDisable = async () => {
    if (disableCode.length !== 6) { setDisableError('Enter the 6-digit code from your authenticator'); return; }
    setDisableLoading(true);
    setDisableError(null);
    try {
      await api.auth.mfaDisable(disableCode);
      setDisableOpen(false);
      setDisableCode('');
      loadStatus();
    } catch (err) {
      setDisableError(err instanceof Error ? err.message : 'Failed to disable MFA');
    } finally {
      setDisableLoading(false);
    }
  };

  return (
    <div className="animate-fadeIn mx-auto max-w-5xl pb-10">
      {/* Back affordance — preserved for navigation/a11y, set quietly above the editorial masthead. */}
      <div className="mb-8">
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="inline-flex items-center gap-2 text-sm t-muted hover:t-primary transition-[color] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
          title="Back to settings"
          aria-label="Back to settings"
        >
          <ArrowLeft size={14} />
          Back to Settings
        </button>
      </div>

      {/* Enrollment stepper */}
      <div className="mb-10">
        <MfaStepper activeStep={activeStep} />
      </div>

      {/* Editorial masthead */}
      <header className="text-center mb-12">
        <p className="text-label t-accent mb-3">Access · Two-Factor</p>
        <h1 className="text-hero t-primary mx-auto max-w-3xl">Secure Your Financial Assurance Account</h1>
        <p className="text-body-sm t-secondary mt-4 max-w-xl mx-auto">
          Enable Multi-Factor Authentication (MFA) for enhanced protection of your account and recovery codes.
        </p>
      </header>

      {mfaEnforcementWarning && !status?.enabled && (
        <div
          role="alert"
          className="flex items-start gap-3 p-4 rounded-md border mx-auto max-w-2xl mb-8"
          style={{
            background: graceExpired ? 'rgb(var(--neg-rgb) / 0.08)' : 'rgb(var(--warning-rgb, 180 120 60) / 0.08)',
            borderColor: graceExpired ? 'rgb(var(--neg-rgb) / 0.35)' : 'rgb(var(--warning-rgb, 180 120 60) / 0.35)',
          }}
        >
          <AlertTriangle
            className="w-5 h-5 flex-shrink-0 mt-0.5"
            style={{ color: graceExpired ? 'var(--neg)' : 'var(--warning)' }}
          />
          <div className="flex-1">
            <p
              className="text-sm font-semibold"
              style={{ color: graceExpired ? 'var(--neg)' : 'var(--warning)' }}
            >
              {graceExpired ? 'MFA is now required for your role' : `MFA required — ${mfaEnforcementWarning.daysRemaining} day${mfaEnforcementWarning.daysRemaining === 1 ? '' : 's'} remaining`}
            </p>
            <p className="text-xs t-secondary mt-0.5">
              {mfaEnforcementWarning.reason || `Your role requires two-factor authentication. Enable it ${graceExpired ? 'now to retain access.' : 'within the grace period to avoid losing access.'}`}
            </p>
          </div>
        </div>
      )}

      <Card size="relaxed" className="mx-auto max-w-2xl">
        <p className="text-label t-muted mb-5 flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-accent" /> Authentication Status
        </p>

        {statusLoading ? (
          <div className="flex items-center gap-2 text-xs t-muted"><Loader2 size={14} className="animate-spin" /> Loading status...</div>
        ) : status?.enabled ? (
          <div className="space-y-4">
            <div
              className="flex items-center gap-3 p-3 rounded-md"
              style={{ background: 'rgb(var(--accent-rgb) / 0.08)', border: '1px solid rgb(var(--accent-rgb) / 0.25)' }}
            >
              <Shield className="w-5 h-5 text-accent" />
              <div className="flex-1">
                <p className="text-sm font-medium text-accent">MFA enabled</p>
                <p className="text-xs t-muted">Your account is protected with TOTP two-factor authentication.</p>
              </div>
              <Badge variant="success" size="sm">Active</Badge>
            </div>

            {typeof status.backupCodesRemaining === 'number' && (
              <div
                className="flex items-center justify-between gap-3 p-3 rounded-md"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}
              >
                <div>
                  <p className="text-sm t-primary">Recovery codes remaining</p>
                  <p className="text-xs t-muted">
                    <span className="font-mono tnum">{status.backupCodesRemaining}</span> of 8 unused
                    {status.backupCodesRemaining < 3 && (
                      <span style={{ color: 'var(--warning)' }}> — consider regenerating soon</span>
                    )}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setRegenOpen(true)} title="Regenerate recovery codes (invalidates old ones)">
                  <RefreshCw size={14} /> Regenerate
                </Button>
              </div>
            )}

            <div className="pt-2" style={{ borderTop: '1px solid var(--divider)' }}>
              <div className="flex items-center justify-between gap-3 mt-4">
                <div>
                  <p className="text-sm t-primary">Disable MFA</p>
                  <p className="text-xs t-muted">Remove two-factor authentication from your account.</p>
                </div>
                <Button variant="danger" size="sm" onClick={() => setDisableOpen(true)} title="Disable two-factor authentication">
                  <XCircle size={14} /> Disable
                </Button>
              </div>
              {isAdminRole && (
                <p className="text-caption mt-2 flex items-start gap-1.5" style={{ color: 'var(--warning)' }}>
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  <span>
                    Your role requires MFA. Disabling it may revoke your access once the enforcement grace period expires.
                  </span>
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className="flex items-center gap-3 p-3 rounded-md"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}
            >
              <Shield className="w-5 h-5 t-muted" />
              <div className="flex-1">
                <p className="text-sm t-primary">MFA not enabled</p>
                <p className="text-xs t-muted">Add an extra layer of protection by enabling TOTP two-factor authentication.</p>
              </div>
              <Badge variant="warning" size="sm">Disabled</Badge>
            </div>
            {statusError && <p className="text-xs text-neg text-center">{statusError}</p>}
            {!showWizard && (
              <div className="pt-1 space-y-3">
                <p className="text-caption t-muted text-center max-w-md mx-auto">
                  Your account security is our priority. This step adds an essential layer of defense.
                </p>
                <Button variant="primary" className="w-full justify-center" onClick={() => setShowWizard(true)} title="Start MFA enrollment">
                  <Shield size={16} /> Verify &amp; Enable
                </Button>
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  className="block w-full text-center text-sm t-secondary hover:t-primary transition-[color] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
                >
                  Cancel Setup
                </button>
              </div>
            )}
          </div>
        )}
      </Card>

      {showWizard && !status?.enabled && (
        <Card size="relaxed" className="mx-auto max-w-2xl mt-6">
          <MFAEnrollmentWizard onComplete={handleWizardComplete} onCancel={() => setShowWizard(false)} />
        </Card>
      )}

      <div className="text-xs t-muted text-center mt-10 pt-6" style={{ borderTop: '1px solid var(--divider)' }}>
        Return to <Link to="/settings" className="font-medium" style={{ color: 'var(--accent)' }}>Settings</Link>
      </div>

      {/* Regenerate backup codes — uses canonical Modal primitive. */}
      <Modal
        open={regenOpen}
        onClose={() => { setRegenOpen(false); setRegenCode(''); setRegenError(null); }}
        size="sm"
        dismissible={!regenLoading}
      >
        <Modal.Header
          title={<><RefreshCw size={14} className="inline mr-2" />Regenerate recovery codes</>}
        />
        <Modal.Body>
          <p className="text-caption t-muted mb-3">
            Enter the current 6-digit code from your authenticator. Your existing recovery codes will be
            <strong> invalidated</strong> immediately and replaced with 8 new ones.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full px-3 py-2.5 rounded-md text-center font-mono text-lg tracking-widest tnum outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
            value={regenCode}
            onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            aria-label="Six-digit authenticator code"
            autoFocus
          />
          {regenError && <p className="text-caption text-neg mt-2">{regenError}</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => { setRegenOpen(false); setRegenCode(''); setRegenError(null); }}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleRegenerate} disabled={regenLoading || regenCode.length !== 6}>
            {regenLoading ? <Loader2 size={14} className="animate-spin mr-1" /> : <RefreshCw size={14} className="mr-1" />}
            Regenerate
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Shown-once recovery codes — wider (lg) so the code grid breathes. */}
      <Modal
        open={!!newBackupCodes}
        onClose={() => { setNewBackupCodes(null); loadStatus(); }}
        size="lg"
      >
        <Modal.Body>
          {newBackupCodes && (
            <BackupCodesDisplay
              codes={newBackupCodes}
              heading="New recovery codes"
              subheading="Your previous recovery codes have been invalidated. Save these new codes now."
              onAcknowledge={() => { setNewBackupCodes(null); loadStatus(); }}
            />
          )}
        </Modal.Body>
      </Modal>

      {/* Disable MFA — destructive; the Modal handles ESC/backdrop blocking
          via dismissible={!disableLoading} while the API call is in flight. */}
      <Modal
        open={disableOpen}
        onClose={() => { setDisableOpen(false); setDisableCode(''); setDisableError(null); }}
        size="sm"
        dismissible={!disableLoading}
      >
        <Modal.Header
          title={<><XCircle size={14} className="inline mr-2 text-neg" />Disable two-factor authentication</>}
        />
        <Modal.Body>
          {isAdminRole && (
            <div
              className="flex items-start gap-2 p-2 rounded-md mb-3"
              style={{
                background: 'rgb(var(--warning-rgb, 180 120 60) / 0.08)',
                border: '1px solid rgb(var(--warning-rgb, 180 120 60) / 0.30)',
              }}
            >
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
              <p className="text-caption" style={{ color: 'var(--warning)' }}>
                Your role <strong>{user?.role}</strong> requires MFA under the platform policy. Disabling it may lock you
                out once the enforcement grace period expires.
              </p>
            </div>
          )}
          <p className="text-caption t-muted mb-3">Confirm by entering the current 6-digit code from your authenticator.</p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full px-3 py-2.5 rounded-md text-center font-mono text-lg tracking-widest tnum outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            aria-label="Six-digit authenticator code"
            autoFocus
          />
          {disableError && <p className="text-caption text-neg mt-2">{disableError}</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => { setDisableOpen(false); setDisableCode(''); setDisableError(null); }}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={handleDisable} disabled={disableLoading || disableCode.length !== 6}>
            {disableLoading ? <Loader2 size={14} className="animate-spin mr-1" /> : <XCircle size={14} className="mr-1" />}
            Confirm disable
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
