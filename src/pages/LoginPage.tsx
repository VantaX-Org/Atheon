import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Building2, Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { api, setToken, getToken, setTenantOverride, setRememberMe as setApiRememberMe } from "@/lib/api";
import { FormError } from "@/components/ui/state";
import type { IndustryVertical, UserRole } from "@/types";

type AuthMode= 'login' | 'register';

/**
 * The MFA challenge input accepts either a 6-digit TOTP or a backup code in xxxx-xxxx format.
 * Returns the parsed code (normalized) plus its format type, or null if invalid.
 */
function parseMfaInput(raw: string): { code: string; kind: 'totp' | 'backup' } | null {
  const trimmed = raw.trim();
  if (/^\d{6}$/.test(trimmed)) return { code: trimmed, kind: 'totp' };
  // Backup code: 4 alphanumeric + dash + 4 alphanumeric (case-insensitive).
  const backupMatch = trimmed.match(/^([a-zA-Z0-9]{4})-?([a-zA-Z0-9]{4})$/);
  if (backupMatch) return { code: `${backupMatch[1].toLowerCase()}-${backupMatch[2].toLowerCase()}`, kind: 'backup' };
  return null;
}

export function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Remember me" controls whether the auth token survives a browser close.
  // Default reads the existing preference (true on first visit for backwards
  // compatibility); toggling here writes through to api.setRememberMe BEFORE
  // setToken runs so the token lands in the right storage scope.
  const [rememberMe, setRememberMeState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('atheon_remember_me') !== 'false';
  });
  const [tenantOptions, setTenantOptions] = useState<{ slug: string; name: string }[] | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setUser = useAppStore((s) => s.setUser);
  const setIndustry = useAppStore((s) => s.setIndustry);
  const setActiveTenant = useAppStore((s) => s.setActiveTenant);
  const setMfaEnforcementWarning = useAppStore((s) => s.setMfaEnforcementWarning);
  const existingUser = useAppStore((s) => s.user);

  // MFA challenge state — shown after primary credentials succeed but before session is issued.
  const [mfaChallengeActive, setMfaChallengeActive] = useState(false);
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaInput, setMfaInput] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<number | null>(null);

  const handleAuthResult = (res: {
    token: string;
    refreshToken?: string;
    user: { id: string; email: string; name: string; role: string; tenantId: string; tenantName?: string; tenantIndustry?: string; permissions: string[] };
    mfaEnforcementWarning?: { daysRemaining: number; reason?: string; mfaSetupUrl?: string };
    backupCodesRemaining?: number;
  }) => {
    setToken(res.token, res.refreshToken || null);
    // Clear any stale tenant override from a previous session
    setTenantOverride(null);
    setActiveTenant(null, null, null);
    setUser({ id: res.user.id, email: res.user.email, name: res.user.name, role: res.user.role as UserRole, tenantId: res.user.tenantId, tenantName: res.user.tenantName, permissions: res.user.permissions });
    // Set industry from the user's tenant (default to 'general' if not provided)
    setIndustry((res.user.tenantIndustry || 'general') as IndustryVertical);
    // Persist MFA grace-period warning (if any) so the Dashboard / Settings pages can surface it.
    setMfaEnforcementWarning(res.mfaEnforcementWarning ?? null);
    // Role-aware landing — scoped read-only roles land on their own home
    // (auditor → /assurance, board_member → /board); everyone
    // else gets the operational dashboard as before.
    const landing =
      res.user.role === 'auditor' ? '/assurance'
      : res.user.role === 'board_member' ? '/board'
      : '/dashboard';
    navigate(landing);
  };

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (code && state) {
      setLoading(true);
      setError(null);
      api.auth.ssoCallback(code, state)
        .then((res) => handleAuthResult(res))
        .catch((err) => { setError(err instanceof Error ? err.message : 'SSO authentication failed'); window.history.replaceState({}, '', '/login'); })
        .finally(() => setLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase AY: SAML callback returns the user via a fragment token to keep
  // the secret out of server access logs. Persist the token, fetch the
  // user via /auth/me, then scrub the URL bar so reloads don't replay it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash.startsWith('#sso-token=')) return;
    const token = decodeURIComponent(hash.slice('#sso-token='.length));
    if (!token) return;
    setLoading(true);
    setToken(token, null);
    api.auth.me()
      .then((user) => {
        setTenantOverride(null);
        setActiveTenant(null, null, null);
        setUser({ id: user.id, email: user.email, name: user.name, role: user.role as UserRole, tenantId: user.tenantId, tenantName: user.tenantName, permissions: user.permissions });
        window.history.replaceState({}, '', window.location.pathname);
        const landing =
          user.role === 'auditor' ? '/assurance'
          : user.role === 'board_member' ? '/board'
          : '/dashboard';
        navigate(landing);
      })
      .catch((err) => {
        setToken('', null);
        setError(err instanceof Error ? err.message : 'SAML login failed');
        window.history.replaceState({}, '', window.location.pathname);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (existingUser && getToken()) {
      const landing =
        existingUser.role === 'auditor' ? '/assurance'
        : existingUser.role === 'board_member' ? '/board'
        : '/dashboard';
      navigate(landing, { replace: true });
    }
  }, [existingUser, navigate]);

  useEffect(() => {
    const token = searchParams.get('token');
    if (token && window.location.pathname.startsWith('/reset-password')) {
      setResetToken(token);
      setShowResetPw(true);
      window.history.replaceState({}, '', '/reset-password');
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'register') {
        if (!name.trim()) { setError('Name is required'); setLoading(false); return; }
        if (password.length < 10) { setError('Password must be at least 10 characters'); setLoading(false); return; }
        const res = await api.auth.register(email, password, name);
        handleAuthResult(res);
      } else {
        try {
          const res = await api.auth.login(email, password, selectedTenant || undefined);
          const mfaRequired = res.mfaRequired ?? res.mfa_required ?? false;
          if (mfaRequired) {
            // Session is not issued until the MFA challenge is satisfied.
            setMfaChallengeActive(true);
            setMfaChallengeToken(res.challengeToken ?? res.challenge_token ?? null);
            setMfaError(null);
            setLoading(false);
            return;
          }
          handleAuthResult(res);
        } catch (loginErr: unknown) {
          // Check if this is a tenant selection required response
          const errMsg = loginErr instanceof Error ? loginErr.message : '';
          if (errMsg.includes('Tenant selection required')) {
            // Re-fetch with raw fetch to get tenant list from response body
            const rawRes = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/auth/login`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password }),
            });
            const body = await rawRes.json() as { tenantSelectionRequired?: boolean; tenants?: { slug: string; name: string }[] };
            if (body.tenantSelectionRequired && body.tenants) {
              setTenantOptions(body.tenants);
              setError(null);
              setLoading(false);
              return;
            }
          }
          throw loginErr;
        }
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Authentication failed'); }
    finally { setLoading(false); }
  };

  const submitMfaChallenge = async () => {
    const parsed = parseMfaInput(mfaInput);
    if (!parsed) {
      setMfaError('Enter a 6-digit code or a backup code in xxxx-xxxx format');
      return;
    }
    setLoading(true);
    setMfaError(null);
    try {
      const res = await api.auth.mfaValidate(parsed.code, mfaChallengeToken ?? undefined);
      if (typeof res.backupCodesRemaining === 'number') {
        setBackupCodesRemaining(res.backupCodesRemaining);
      }
      handleAuthResult(res);
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const cancelMfaChallenge = () => {
    setMfaChallengeActive(false);
    setMfaChallengeToken(null);
    setMfaInput('');
    setMfaError(null);
    setBackupCodesRemaining(null);
  };

  const [showForgotPw, setShowForgotPw] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Password reset functionality - token parsed from URL params
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetDone, setResetDone] = useState(false);

  const handleSSO = async (provider: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.ssoAuthorize(provider === 'azure' ? 'azure_ad' : provider);
      if (res.redirect_url) { window.location.href = res.redirect_url; return; }
      setError('SSO configuration not available');
    } catch (err) { setError(err instanceof Error ? err.message : 'SSO login failed.'); }
    finally { setLoading(false); }
  };

  // Phase AY: WorkOS-brokered SAML. The user types their work email; we
  // look up their tenant's WorkOS Connection ID and redirect to WorkOS,
  // which then forwards to Okta / Azure AD / Ping / etc.
  const handleSamlSSO = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter your work email above, then click SAML SSO.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.samlStart(trimmed);
      if (res.authorizationUrl) {
        window.location.href = res.authorizationUrl;
        return;
      }
      setError('SAML configuration not available for this tenant.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SAML login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.auth.forgotPassword(forgotEmail);
      setForgotSent(true);
    } catch (err) {
      console.error('Forgot password request failed:', err);
      // Security: Don't reveal if email exists, but inform user of technical issues
      setError('Unable to process your request at this time. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetToken) {
      setError('Reset token missing. Please request a new password reset link.');
      return;
    }
    if (resetNewPassword.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.auth.resetPassword(resetToken, resetNewPassword);
      setResetDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen relative overflow-hidden lg:grid lg:grid-cols-[1.1fr_minmax(0,520px)]"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Editorial atmosphere — royal-blue bloom drifting in from the right
          behind the auth card, with a faint warm wash bottom-left. Subtle,
          dynamic, never asks for attention. Sits behind everything. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 92% 50%, rgb(var(--accent-rgb) / 0.16) 0%, transparent 48%),' +
            'radial-gradient(circle at 4% 96%, rgba(205, 163, 126, 0.06) 0%, transparent 52%)',
        }}
      />

      {/* ── Left editorial panel ─────────────────────────────────────────
          Marketing hero. Big bold display headline + a mono "data voice"
          trust strip. Hidden on small screens where the form takes over. */}
      <aside className="relative hidden lg:flex flex-col justify-between px-12 xl:px-20 py-14 animate-riseIn">
        <p
          className="uppercase tracking-[0.34em] text-caption"
          style={{ fontFamily: "'Space Mono', ui-monospace, monospace", color: 'var(--accent)' }}
        >
          Atheon · Connect · Detect · Fix · Recover · Report
        </p>

        <h1 className="text-5xl xl:text-6xl font-bold t-primary tracking-tight leading-[1.05] max-w-[15ch]">
          The money is already in your ERP. Recover it.
        </h1>

        <div className="space-y-2 max-w-md">
          <p
            className="uppercase tracking-[0.28em] text-caption t-muted"
            style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
          >
            Detect · Fix · Recover
          </p>
          <p className="text-body-sm t-secondary leading-relaxed">
            Every claimed Rand traced to its source record. Every finding evidenced, ranked, and ready for the board.
          </p>
        </div>
      </aside>

      {/* ── Right auth column ────────────────────────────────────────────
          Frosted glass card on a soft blue bloom, matching the mockup. */}
      <div className="relative flex flex-col items-center justify-center px-4 sm:px-6 py-10 lg:py-12">
        <div className="w-full max-w-md relative">
          {/* Brand header inside the card column — wordmark + mono eyebrow,
              mirroring the mockup's "Atheon / ENTERPRISE ASSURANCE PORTAL". */}

          {/* Form card — frosted glass, all sub-states render below the header.
              riseIn lands 80ms after the page atmosphere so the entrance feels
              conducted, not simultaneous. */}
          <div
            className="w-full p-7 sm:p-9 animate-riseIn backdrop-blur-[var(--glass-blur)]"
            style={{
              background: 'var(--glass-bg-strong)',
              border: '1px solid var(--glass-border)',
              boxShadow: 'var(--glass-shadow)',
              borderRadius: 'var(--radius)',
              animationDelay: '80ms',
            }}
          >
            <div className="flex flex-col items-center text-center mb-7">
              <div className="flex items-center gap-2.5 mb-2.5" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
                  <path d="M16 4L27 27H5L16 4Z" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
                  <line x1="9" y1="20" x2="23" y2="20" stroke="var(--accent)" strokeWidth=".8" opacity=".6" />
                  <line x1="11.5" y1="14.5" x2="20.5" y2="14.5" stroke="var(--info)" strokeWidth=".8" opacity=".5" />
                  <circle cx="16" cy="9" r="1.5" fill="var(--bronze)" />
                </svg>
                <span className="text-3xl font-bold tracking-tight" style={{ color: 'var(--accent)' }}>Atheon</span>
              </div>
              <p
                className="uppercase tracking-[0.3em] text-caption t-muted"
                style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
              >
                Enterprise Assurance Portal
              </p>
            </div>

            <h2 className="sr-only">{mode === 'register' ? 'Create your account' : 'Sign in to your Atheon workspace'}</h2>
            <FormError error={error} className="mb-4" />
          {mfaChallengeActive && (
            <div className="mb-5 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} style={{ color: 'var(--accent)' }} />
                <h3 className="text-sm font-semibold t-primary">Two-factor authentication</h3>
              </div>
              <p className="text-xs t-secondary">
                Enter the 6-digit code from your authenticator app, or a backup code in <code className="text-caption">xxxx-xxxx</code> format.
              </p>
              <input
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                aria-label="Authenticator code or backup code"
                value={mfaInput}
                onChange={(e) => setMfaInput(e.target.value.slice(0, 12))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !loading) submitMfaChallenge(); }}
                placeholder="123456 or xxxx-xxxx"
                className="w-full px-3 py-2.5 rounded-md text-center font-mono text-lg tracking-widest outline-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
                autoFocus
              />
              {mfaError && <p className="text-xs text-neg">{mfaError}</p>}
              {backupCodesRemaining !== null && backupCodesRemaining < 3 && (
                <p className="text-caption" style={{ color: 'var(--warning)' }}>
                  You have {backupCodesRemaining} backup code{backupCodesRemaining === 1 ? '' : 's'} left. Consider regenerating them from Settings &rarr; MFA after you sign in.
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={cancelMfaChallenge} type="button">Back to sign in</Button>
                <Button variant="primary" size="sm" onClick={submitMfaChallenge} disabled={loading || parseMfaInput(mfaInput) === null} type="button">
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  Verify
                </Button>
              </div>
            </div>
          )}
          {tenantOptions && !mfaChallengeActive && (
            <div className="mb-5 space-y-3">
              <p className="text-xs t-secondary">This email exists in multiple workspaces. Please select one:</p>
              <div className="space-y-2">
                {tenantOptions.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={async () => {
                      setSelectedTenant(t.slug);
                      setTenantOptions(null);
                      setLoading(true);
                      setError(null);
                      try {
                        const res = await api.auth.login(email, password, t.slug);
                        const mfaRequired = res.mfaRequired ?? res.mfa_required ?? false;
                        if (mfaRequired) {
                          setMfaChallengeActive(true);
                          setMfaChallengeToken(res.challengeToken ?? res.challenge_token ?? null);
                          setMfaError(null);
                          setLoading(false);
                          return;
                        }
                        handleAuthResult(res);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Authentication failed');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs font-medium t-secondary transition-[background-color,color,transform,box-shadow] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.98] hover:bg-[var(--bg-secondary)]"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}
                  >
                    <Building2 size={14} className="t-muted flex-shrink-0" />
                    <span className="t-primary">{t.name}</span>
                    <span className="t-muted ml-auto text-caption">{t.slug}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {selectedTenant && (
            <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-md text-xs" style={{ background: 'rgb(var(--accent-rgb) / 0.06)', border: '1px solid var(--border-card)' }}>
              <Building2 size={12} style={{ color: 'var(--accent)' }} />
              <span className="t-secondary">Workspace: <strong className="t-primary">{selectedTenant}</strong></span>
              <button type="button" onClick={() => setSelectedTenant(null)} className="ml-auto text-caption t-muted hover:t-primary">&times;</button>
            </div>
          )}
          {!tenantOptions && !mfaChallengeActive && <form onSubmit={handleLogin} className="space-y-4" data-testid="login-form">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="block uppercase tracking-[0.18em] text-caption t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>Full Name</label>
                <Input type="text" placeholder="Your name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} data-testid="name" />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="block uppercase tracking-[0.18em] text-caption t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>Email Address</label>
              <Input type="email" placeholder="you@company.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email" />
            </div>
            <div className="space-y-1.5">
              <label className="block uppercase tracking-[0.18em] text-caption t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>Password</label>
              <Input type="password" placeholder={mode === 'register' ? 'Min 10 characters' : '••••••••'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="password" />
            </div>
            {mode === 'login' && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-caption t-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border-card)' }}
                    checked={rememberMe}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setRememberMeState(next);
                      // Persist preference immediately so it applies when
                      // setToken() runs after sign-in.
                      setApiRememberMe(next);
                    }}
                    data-testid="remember-me"
                  />
                  Remember me
                </label>
              </div>
            )}
            <Button variant="primary" size="md" className="w-full mt-1" type="submit" disabled={loading} data-testid="login-button">
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {mode === 'register' ? <><UserPlus size={14} /> Create Account</> : <>Sign In <ArrowRight size={14} /></>}
            </Button>
          </form>}
          {/* SSO row — two pill chips below the primary action, matching the
              mockup's "SAML SSO / GOOGLE WORKSPACE" pair. */}
          {!tenantOptions && !mfaChallengeActive && mode === 'login' && (
            <div className="grid grid-cols-2 gap-2.5 mt-4">
              {/* Phase AY: SAML SSO. Enabled when the tenant has set a
                  WorkOS connection_id; backend returns 404 + a clear
                  message if not configured. Requires the email field
                  filled so we can route to the right WorkOS connection. */}
              <button
                onClick={() => void handleSamlSSO()}
                className="flex items-center justify-center gap-2 px-3 py-2.5 text-caption font-semibold uppercase tracking-[0.12em] t-secondary transition-[background-color,color,transform,box-shadow] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.98] hover:bg-[var(--bg-secondary)]"
                style={{ fontFamily: "'Space Mono', ui-monospace, monospace", background: 'var(--bg-input)', border: '1px solid var(--border-card)', borderRadius: '9999px', color: 'var(--accent)' }}
                title="Use your organisation's SAML identity provider (Okta, Azure AD, Ping, etc.)"
              >
                <ShieldCheck size={13} style={{ color: 'var(--accent)' }} />
                SAML SSO
              </button>
              <button
                onClick={() => handleSSO('azure')}
                className="flex items-center justify-center gap-2 px-3 py-2.5 text-caption font-semibold uppercase tracking-[0.12em] t-secondary transition-[background-color,color,transform,box-shadow] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.98] hover:bg-[var(--bg-secondary)]"
                style={{ fontFamily: "'Space Mono', ui-monospace, monospace", background: 'var(--bg-input)', border: '1px solid var(--border-card)', borderRadius: '9999px', color: 'var(--accent)' }}
              >
                <Building2 size={13} style={{ color: 'var(--accent)' }} />
                Azure AD
              </button>
            </div>
          )}
          {!tenantOptions && !mfaChallengeActive && mode === 'login' && (
            <div className="text-center mt-4">
              <button type="button" onClick={() => { setError(null); setShowForgotPw(true); }} className="text-caption font-medium" style={{ color: 'var(--accent)' }} data-testid="forgot-password">Forgot password?</button>
            </div>
          )}
          {/* Set-new-password modal — uses the canonical Modal primitive.
              `dismissible={!loading}` blocks ESC / backdrop / X while the
              reset POST is in flight so the user can't dismiss mid-submit. */}
          <Modal
            open={showResetPw}
            onClose={() => { setShowResetPw(false); setResetToken(null); setResetNewPassword(''); setError(null); navigate('/login', { replace: true }); }}
            size="sm"
            dismissible={!loading}
          >
            <Modal.Header title="Set a new password" />
            <Modal.Body>
              {/* Errors must render inside the modal — the page-level FormError
                  sits behind the overlay and is invisible while this is open. */}
              <FormError error={error} className="mb-3" />
              {resetDone ? (
                <p className="text-body-sm t-secondary">
                  Your password has been reset. You can now sign in with your new password.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-caption t-muted">Enter a new password for your account.</p>
                  <input
                    className="w-full px-3 py-2 rounded-md text-body"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Min 10 characters"
                    value={resetNewPassword}
                    onChange={e => setResetNewPassword(e.target.value)}
                  />
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              {resetDone ? (
                <Button variant="primary" size="sm" onClick={() => { setShowResetPw(false); setResetDone(false); setResetToken(null); setResetNewPassword(''); setError(null); navigate('/login', { replace: true }); }}>
                  Back to Login
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => { setShowResetPw(false); setResetToken(null); setResetNewPassword(''); setError(null); navigate('/login', { replace: true }); }}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={handleResetPassword} disabled={loading || resetNewPassword.length < 10}>
                    {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                    Reset Password
                  </Button>
                </>
              )}
            </Modal.Footer>
          </Modal>

          {/* Forgot-password modal — same Modal pattern. */}
          <Modal
            open={showForgotPw}
            onClose={() => { setShowForgotPw(false); setForgotEmail(''); setError(null); }}
            size="sm"
          >
            <Modal.Header title="Reset password" />
            <Modal.Body>
              <FormError error={error} className="mb-3" />
              {forgotSent ? (
                <p className="text-body-sm t-secondary">
                  If an account exists for <strong className="t-primary">{forgotEmail}</strong>, a reset link has been sent.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-caption t-muted">Enter your email and we will send you a reset link.</p>
                  <input
                    className="w-full px-3 py-2 rounded-md text-body"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                  />
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              {forgotSent ? (
                <Button variant="primary" size="sm" onClick={() => { setShowForgotPw(false); setForgotSent(false); setForgotEmail(''); }}>
                  Back to Login
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => { setShowForgotPw(false); setForgotEmail(''); setError(null); }}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={handleForgotPassword} disabled={loading || !forgotEmail.trim()}>
                    {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                    Send Reset Link
                  </Button>
                </>
              )}
            </Modal.Footer>
          </Modal>
          <div className="mt-8 pt-5" style={{ borderTop: '1px solid var(--divider)' }}>
            <p
              className="text-center uppercase tracking-[0.22em] text-caption t-muted"
              style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
            >
              POPIA-aligned · Encrypted · Tenant-isolated
            </p>
            <p className="text-caption t-muted text-center mt-3">
              {mode === 'login' ? <>Don&apos;t have an account? <button onClick={() => { setMode('register'); setError(null); }} className="font-medium" style={{ color: 'var(--accent)' }}>Create one</button></> : <>Already have an account? <button onClick={() => { setMode('login'); setError(null); }} className="font-medium" style={{ color: 'var(--accent)' }}>Sign in</button></>}
            </p>
            <p className="text-caption t-muted text-center mt-2">
              &copy; {new Date().getFullYear()} Atheon Technologies. All rights reserved.
            </p>
            <p className="text-caption t-muted text-center mt-2">
              <a href="/status" className="hover:t-primary">Status</a>
              <span className="mx-2">·</span>
              <a href="/legal/security" className="hover:t-primary">Security &amp; Privacy</a>
              <span className="mx-2">·</span>
              <a href="/legal/connectors" className="hover:t-primary">Connectors</a>
              <span className="mx-2">·</span>
              <a href="/legal/performance" className="hover:t-primary">Performance</a>
            </p>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
