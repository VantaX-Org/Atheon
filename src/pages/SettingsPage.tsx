import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/appStore";
import { api, ApiError } from "@/lib/api";
import type { LlmConfigResponse } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { PERSONA_LABELS } from "@/components/journey/PersonaRail";
import type { Persona } from "@/types";
import { FormError } from "@/components/ui/state";
import {
 User, Bell, Cpu, Loader2, Check, Shield, Key, Copy, Download, Trash2, Brain, ArrowRight, AlertTriangle, HelpCircle, RefreshCw
} from "lucide-react";

interface NotificationPref {
 key: string;
 label: string;
 desc: string;
 enabled: boolean;
}

// Default toggle state — mirrors backend DEFAULT_NOTIFICATION_PREFS; overridden
// by the user's saved prefs from /api/auth/me on mount.
const NOTIFICATION_DEFS: NotificationPref[] = [
 { key: 'risk_critical', label: 'Risk alerts (critical)', desc: 'Immediate notification for critical risk alerts', enabled: true },
 { key: 'catalyst_approvals', label: 'Catalyst approvals', desc: 'When a catalyst action requires approval', enabled: true },
 { key: 'exec_briefings', label: 'Executive briefings', desc: 'Daily morning briefing notification', enabled: true },
 { key: 'anomaly_detection', label: 'Anomaly detection', desc: 'When Pulse detects process anomalies', enabled: false },
 { key: 'system_health', label: 'System health', desc: 'Uptime and performance degradation alerts', enabled: true },
];

const applyPrefs = (prefs?: Record<string, boolean>): NotificationPref[] =>
 NOTIFICATION_DEFS.map(d => ({ ...d, enabled: prefs && d.key in prefs ? prefs[d.key] : d.enabled }));

export function SettingsPage() {
 const toast = useToast();
 const { user, setUser } = useAppStore();
 // Role gating — hide (not disable) sections a role cannot use:
 //  - auditor/board_member: read-oriented roles → minimal profile + MFA only.
 //  - Data & Privacy triggers TENANT-WIDE export/erasure server-side → admin roles only.
 const isMinimalRole = user?.role === 'auditor' || user?.role === 'board_member';
 const isTenantAdmin = user?.role === 'superadmin' || user?.role === 'support_admin' || user?.role === 'admin';
 const [displayName, setDisplayName] = useState(user?.name || '');
 const [email, setEmail] = useState(user?.email || '');
 const [persona, setPersona] = useState<Persona | ''>(user?.persona ?? '');
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);
 const [saveError, setSaveError] = useState<string | null>(null);

 const [notifications, setNotifications] = useState<NotificationPref[]>(() => applyPrefs(user?.notificationPrefs));
 const [notifsDirty, setNotifsDirty] = useState(false);
 const [savingNotifs, setSavingNotifs] = useState(false);
 // 'ready' = toggles reflect real saved prefs (server copy, or store copy from login).
 // 'error' = no trustworthy copy — show retry, never defaults dressed up as saved values.
 const [notifsState, setNotifsState] = useState<'loading' | 'ready' | 'error'>(user?.notificationPrefs ? 'ready' : 'loading');

 // Hydrate from the authoritative server copy (store may predate this field).
 const hydrateNotifs = useCallback(async () => {
 setNotifsState(prev => prev === 'ready' ? 'ready' : 'loading');
 try {
 const me = await api.auth.me();
 if (me.notificationPrefs) setNotifications(applyPrefs(me.notificationPrefs));
 // No prefs on the server = backend defaults apply, which NOTIFICATION_DEFS mirrors.
 setNotifsState('ready');
 } catch {
 setNotifsState(prev => prev === 'ready' ? 'ready' : 'error');
 }
 }, []);

 useEffect(() => { hydrateNotifs(); }, [hydrateNotifs]);

 const toggleNotification = (index: number) => {
 setNotifications(prev => prev.map((n, i) => i === index ? { ...n, enabled: !n.enabled } : n));
 setNotifsDirty(true);
 };

 const handleSaveNotifications = async () => {
 setSavingNotifs(true);
 try {
 const prefs = Object.fromEntries(notifications.map(n => [n.key, n.enabled]));
 const updated = await api.auth.updateMe({ notificationPrefs: prefs });
 if (user) setUser({ ...user, notificationPrefs: updated.notificationPrefs });
 setNotifsDirty(false);
 toast.success('Notification preferences saved');
 } catch (err) {
 toast.error(err instanceof Error ? err.message : 'Failed to save preferences');
 }
 setSavingNotifs(false);
 };

 const handleSaveProfile = async () => {
 setSaving(true);
 setSaved(false);
 setSaveError(null);
 try {
 const updated = await api.auth.updateMe({ name: displayName, email });
 // Persona has its own endpoint (spec 2026-07-14 §3.1); '' means role default.
 if ((user?.persona ?? '') !== persona) {
 await api.auth.setPersona(persona || null);
 }
 if (user) {
 setUser({ ...user, name: updated.name, email: updated.email, persona: persona || null });
 }
 setSaved(true);
 setTimeout(() => setSaved(false), 3000);
 } catch (err) {
 setSaveError(err instanceof Error ? err.message : 'Failed to save profile');
 }
 setSaving(false);
 };

 const [changingPw, setChangingPw] = useState(false);
 const [currentPw, setCurrentPw] = useState('');
 const [newPw, setNewPw] = useState('');
 const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

 const handleChangePassword = async () => {
 if (newPw.length < 8) {
 setPwMsg({ type: 'error', text: 'Password must be at least 8 characters' });
 return;
 }
 setChangingPw(true);
 setPwMsg(null);
 try {
 await api.auth.changePassword(newPw, currentPw || undefined);
 setPwMsg({ type: 'success', text: 'Password changed successfully' });
 setCurrentPw('');
 setNewPw('');
 } catch (err) {
 const text = err instanceof Error ? err.message : 'Failed to change password';
 setPwMsg({ type: 'error', text });
 toast.error('Failed to change password', {
  message: text,
  requestId: err instanceof ApiError ? err.requestId : null,
 });
 }
 setChangingPw(false);
 };

 // MFA status — full enrollment/management UX lives on /settings/mfa.
 const mfaEnforcementWarning = useAppStore((s) => s.mfaEnforcementWarning);
 const [mfaStatus, setMfaStatus] = useState<{ enabled: boolean; backupCodesRemaining?: number } | null>(null);
 const [mfaStatusError, setMfaStatusError] = useState(false);

 const loadMfaStatus = useCallback(async () => {
   setMfaStatusError(false);
   try {
     const res = await api.auth.mfaStatus();
     setMfaStatus({ enabled: !!res.enabled, backupCodesRemaining: res.backupCodesRemaining });
   } catch {
     // Unknown ≠ disabled — surface the failure rather than claiming "not enabled".
     setMfaStatus(null);
     setMfaStatusError(true);
   }
 }, []);

 useEffect(() => { loadMfaStatus(); }, [loadMfaStatus]);

 // Phase 4.4: API key — server-side generation
 const [apiKeyVisible, setApiKeyVisible] = useState(false);
 const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
 const [apiKeyMeta, setApiKeyMeta] = useState<{ id: string; name: string; prefix: string; createdAt: string } | null>(null);
 const [apiKeyLoading, setApiKeyLoading] = useState(false);
 const [apiKeyError, setApiKeyError] = useState<string | null>(null);
 const [apiKeyListError, setApiKeyListError] = useState(false);

 const loadApiKeys = useCallback(async () => {
   setApiKeyListError(false);
   try {
     const res = await api.auth.listApiKeys();
     if (res.keys.length > 0) {
       const k = res.keys[0];
       setApiKeyMeta({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt });
     }
   } catch (err) {
     console.error('Failed to load API keys', err);
     // Don't show the "Generate" CTA on a failed list — the user may already
     // have a key, and generating another would silently leave it active.
     setApiKeyListError(true);
   }
 }, []);

 useEffect(() => { loadApiKeys(); }, [loadApiKeys]);

 const handleGenerateApiKey = async () => {
   // Regeneration is destructive: revoke the existing key first so the
   // "revokes existing" promise in the UI is actually true server-side.
   if (apiKeyMeta && !confirm(`Regenerate API key? Your existing key (${apiKeyMeta.prefix}…) will be revoked immediately and any integrations using it will stop working.`)) return;
   setApiKeyLoading(true);
   setApiKeyError(null);
   try {
     if (apiKeyMeta) {
       await api.auth.revokeApiKey(apiKeyMeta.id);
       setApiKeyMeta(null);
     }
     const res = await api.auth.generateApiKey();
     setGeneratedApiKey(res.key);
     setApiKeyMeta({ id: res.id, name: res.name, prefix: res.prefix, createdAt: new Date().toISOString() });
     setApiKeyVisible(true);
   } catch (err) {
     const message = err instanceof Error ? err.message : 'Failed to generate API key';
     setApiKeyError(message);
     toast.error('Failed to generate API key', {
       message,
       requestId: err instanceof ApiError ? err.requestId : null,
     });
   }
   setApiKeyLoading(false);
 };

 // LLM Configuration state (superadmin only)
 const isSuperadmin = user?.role === 'superadmin';
 const [llmConfig, setLlmConfig] = useState<LlmConfigResponse | null>(null);
 const [llmProvider, setLlmProvider] = useState('workers_ai');
 const [llmModel, setLlmModel] = useState('');
 const [llmApiKey, setLlmApiKey] = useState('');
 const [llmBaseUrl, setLlmBaseUrl] = useState('');
 const [llmTemperature, setLlmTemperature] = useState(0.3);
 const [llmMaxTokens, setLlmMaxTokens] = useState(1024);
 const [llmSaving, setLlmSaving] = useState(false);
 const [llmSaved, setLlmSaved] = useState(false);
 const [llmError, setLlmError] = useState<string | null>(null);
 const [llmLoadError, setLlmLoadError] = useState(false);

 const loadLlmConfig = useCallback(async () => {
  if (!isSuperadmin) return;
  setLlmLoadError(false);
  try {
   const config = await api.admin.getLlmConfig();
   setLlmConfig(config);
   setLlmProvider(config.provider);
   setLlmModel(config.model || '');
   setLlmBaseUrl(config.baseUrl || '');
   setLlmTemperature(config.temperature);
   setLlmMaxTokens(config.maxTokens);
  } catch (err) {
   console.error('Failed to load LLM config', err);
   // Don't render the form with hardcoded defaults posing as the saved config.
   setLlmLoadError(true);
  }
 }, [isSuperadmin]);

 useEffect(() => { loadLlmConfig(); }, [loadLlmConfig]);

 const handleSaveLlmConfig = async () => {
  setLlmSaving(true);
  setLlmError(null);
  try {
   await api.admin.saveLlmConfig({
    provider: llmProvider,
    model: llmModel || undefined,
    apiKey: llmApiKey || undefined,
    baseUrl: llmBaseUrl || undefined,
    temperature: llmTemperature,
    maxTokens: llmMaxTokens,
   });
   setLlmSaved(true);
   setLlmApiKey('');
   await loadLlmConfig();
   setTimeout(() => setLlmSaved(false), 3000);
  } catch (err) {
   const message = err instanceof Error ? err.message : 'Failed to save LLM configuration';
   setLlmError(message);
   toast.error('Failed to save LLM configuration', {
    message,
    requestId: err instanceof ApiError ? err.requestId : null,
   });
  }
  setLlmSaving(false);
 };

 // Section rail mirrors exactly the cards this role can see — no dead anchors.
 const sections = [
  { id: 'profile',       label: 'Profile' },
  ...(!isMinimalRole ? [{ id: 'notifications', label: 'Notifications' }] : []),
  { id: 'security',      label: 'Two-Factor' },
  ...(!isMinimalRole ? [{ id: 'api', label: 'API Key' }] : []),
  ...(isTenantAdmin ? [{ id: 'privacy', label: 'Data & Privacy' }] : []),
  ...(!isMinimalRole ? [{ id: 'platform', label: 'Platform' }] : []),
 ];

 return (
 <div className="space-y-6 animate-fadeIn">
 <PageHeader
  eyebrow="Account · Settings"
  title="Settings"
  dek="Your profile, security & preferences"
 />

 {/* Editorial three-column scaffold (matches v4-49 mockup):
     left = sticky section index rail · centre = settings cards ·
     right = frosted help-tip + live system-status aside. */}
 <div className="grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)_236px] gap-6 items-start">

 {/* ── Section index rail ─────────────────────────────────────── */}
 <nav
  aria-label="Settings sections"
  className="lg:sticky lg:self-start rounded-[var(--radius)] p-2 flex flex-row lg:flex-col flex-wrap gap-1"
  style={{
   top: 'calc(var(--header-height, 48px) + 16px)',
   background: 'var(--bg-card-solid)',
   border: '1px solid var(--border-card)',
   boxShadow: 'var(--shadow-card)',
  }}
 >
  {sections.map((s) => (
   <a
    key={s.id}
    href={`#${s.id}`}
    className="text-label !text-[10px] px-3 py-2 rounded-md transition-colors"
    style={{ color: 'var(--text-muted)' }}
   >
    {s.label}
   </a>
  ))}
 </nav>

 {/* ── Settings cards ─────────────────────────────────────────── */}
 <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 scroll-mt-24">
 {/* Profile */}
 <Card><span id="profile" className="sr-only">Profile</span>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <User className="w-4 h-4 text-accent" /> Profile
 </h3>
 <div className="space-y-4">
 <div className="flex items-center gap-4">
 <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold" style={{ background: 'rgb(var(--accent-rgb) / 0.15)', color: 'var(--accent)' }}>
 {displayName?.charAt(0) || 'A'}
 </div>
 <div>
 <p className="text-lg font-semibold t-primary">{displayName || 'Admin'}</p>
 <p className="text-sm t-muted">{email}</p>
 <Badge variant="info" size="sm" className="mt-1">{user?.role}</Badge>
 </div>
 </div>
 <Input label="Display Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
 <div>
 <Input label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
 <p className="text-caption t-muted mt-1">This is your sign-in email — changes take effect immediately after saving.</p>
 </div>
 <div>
 <label className="block text-xs font-medium t-secondary mb-1" htmlFor="settings-persona">Your view</label>
 <select
   id="settings-persona"
   value={persona}
   onChange={(e) => setPersona(e.target.value as Persona | '')}
   className="w-full px-3 py-2 rounded-md border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
 >
   <option value="">Default for my role</option>
   {(Object.keys(PERSONA_LABELS) as Persona[]).map((p) => (
     <option key={p} value={p}>{PERSONA_LABELS[p]}</option>
   ))}
 </select>
 <p className="text-caption t-muted mt-1">Which lens your home insights use.</p>
 </div>
 <div className="flex items-center gap-3">
 <Button variant="primary" size="sm" onClick={handleSaveProfile} disabled={saving} title="Save profile changes">
 {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
 {saved ? 'Saved' : 'Save Changes'}
 </Button>
 {saved && <span className="text-xs text-accent">Profile updated</span>}
 {saveError && <span className="text-xs text-neg">{saveError}</span>}
 </div>

 {/* Password Change */}
 <div className="pt-4 mt-4" style={{ borderTop: '1px solid var(--divider)' }}>
 <h4 className="text-sm font-medium t-secondary mb-3">Change Password</h4>
 <div className="space-y-3">
 <Input label="Current Password" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Current password" />
 <Input label="New Password" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min 8 characters" />
 {pwMsg && (
 <div
   className="text-xs p-2 rounded-md"
   style={{
     background: pwMsg.type === 'success' ? 'rgb(var(--accent-rgb) / 0.08)' : 'rgb(var(--neg-rgb) / 0.08)',
     color: pwMsg.type === 'success' ? 'var(--accent)' : 'var(--neg)',
   }}
 >
 {pwMsg.text}
 </div>
 )}
 <Button variant="secondary" size="sm" onClick={handleChangePassword} disabled={changingPw} title="Update your account password">
 {changingPw ? <Loader2 size={14} className="animate-spin" /> : null}
 Change Password
 </Button>
 </div>
 </div>
 </div>
 </Card>

 {/* Notifications — personal prefs, hidden for read-only oversight roles */}
 {!isMinimalRole && (
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Bell className="w-4 h-4 text-accent" /> <span id="notifications">Notifications</span>
 </h3>
 {notifsState === 'loading' ? (
 <div className="flex items-center gap-2 text-xs t-muted py-4"><Loader2 size={14} className="animate-spin" /> Loading your saved preferences…</div>
 ) : notifsState === 'error' ? (
 <div className="py-4 space-y-3">
 <p className="text-sm t-muted">Preferences — <span className="tnum">couldn't load your saved settings.</span></p>
 <Button variant="secondary" size="sm" onClick={hydrateNotifs} title="Retry loading notification preferences">
 <RefreshCw size={14} /> Retry
 </Button>
 </div>
 ) : (
 <>
 <div className="space-y-3">
 {notifications.map((notif, index) => (
 <div
 key={notif.label}
 className="flex items-center justify-between py-3 last:border-0"
 style={{ borderBottom: '1px solid var(--divider)' }}
 >
 <div className="pr-4">
 <span className="text-sm font-medium t-primary">{notif.label}</span>
 <p className="text-caption t-muted mt-0.5">{notif.desc}</p>
 </div>
 <button
 onClick={() => toggleNotification(index)}
 className={`w-10 h-5 rounded-full transition-colors relative`}
 style={{ background: notif.enabled ? 'var(--accent)' : 'var(--toggle-bg)' }}
 aria-label={`Toggle ${notif.label}`}
 title={notif.enabled ? `Disable ${notif.label}` : `Enable ${notif.label}`}
 >
 <div
 className={`absolute top-0.5 w-4 h-4 rounded-full transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${notif.enabled ? 'left-5' : 'left-0.5'}`}
 style={{ background: 'var(--bg-primary)' }}
 />
 </button>
 </div>
 ))}
 </div>
 <p className="text-caption t-muted mt-3">Changes apply to alerts sent to your account after saving.</p>
 <div className="flex justify-end mt-4">
 <Button
  variant="secondary"
  size="sm"
  onClick={handleSaveNotifications}
  disabled={savingNotifs || !notifsDirty}
  title="Save notification preferences"
 >
 {savingNotifs ? <Loader2 size={14} className="animate-spin" /> : null}
 {notifsDirty ? 'Save Preferences' : 'Saved'}
 </Button>
 </div>
 </>
 )}
 </Card>
 )}

 {/* Phase 4.4: MFA / Two-Factor Authentication — summary card; full UX at /settings/mfa */}
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Shield className="w-4 h-4 text-accent" /> <span id="security">Two-Factor Authentication</span>
 </h3>
 {mfaEnforcementWarning && !mfaStatus?.enabled && (
   <div
     role="alert"
     className="flex items-start gap-2 p-3 rounded-md mb-3"
     style={{
       background: mfaEnforcementWarning.daysRemaining <= 0 ? 'rgb(var(--neg-rgb) / 0.08)' : 'rgb(var(--warning-rgb, 180 120 60) / 0.08)',
       border: mfaEnforcementWarning.daysRemaining <= 0 ? '1px solid rgb(var(--neg-rgb) / 0.30)' : '1px solid rgb(var(--warning-rgb, 180 120 60) / 0.30)',
     }}
   >
     <AlertTriangle size={14} className={`flex-shrink-0 mt-0.5 ${mfaEnforcementWarning.daysRemaining <= 0 ? 'text-neg' : ''}`} style={mfaEnforcementWarning.daysRemaining > 0 ? { color: 'var(--warning)' } : undefined} />
     <p className={`text-caption ${mfaEnforcementWarning.daysRemaining <= 0 ? 'text-neg' : ''}`} style={mfaEnforcementWarning.daysRemaining > 0 ? { color: 'var(--warning)' } : undefined}>
       {mfaEnforcementWarning.daysRemaining <= 0
         ? 'MFA is required for your role — enable it now to retain access.'
         : `MFA required for your role — enable within ${mfaEnforcementWarning.daysRemaining} day${mfaEnforcementWarning.daysRemaining === 1 ? '' : 's'} to keep access.`}
     </p>
   </div>
 )}
 {mfaStatusError ? (
   <div className="space-y-3">
     <p className="text-sm t-muted">Status: — <span className="text-xs">(couldn't load MFA status)</span></p>
     <div className="flex items-center gap-3">
       <Button variant="secondary" size="sm" onClick={loadMfaStatus} title="Retry loading MFA status">
         <RefreshCw size={14} /> Retry
       </Button>
       <Link to="/settings/mfa" className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--accent)' }}>
         Open MFA settings <ArrowRight size={12} />
       </Link>
     </div>
   </div>
 ) : !mfaStatus ? (
   <div className="flex items-center gap-2 text-xs t-muted py-2"><Loader2 size={14} className="animate-spin" /> Loading status…</div>
 ) : mfaStatus.enabled ? (
   <div className="space-y-3">
     <div className="flex items-center gap-3 p-3 rounded-md" style={{ background: 'rgb(var(--accent-rgb) / 0.08)', border: '1px solid rgb(var(--accent-rgb) / 0.20)' }}>
       <Shield className="w-5 h-5 text-accent" />
       <div className="flex-1">
         <p className="text-sm font-medium text-accent">MFA enabled</p>
         <p className="text-xs t-muted">
           {typeof mfaStatus.backupCodesRemaining === 'number'
             ? `${mfaStatus.backupCodesRemaining} of 8 recovery codes remaining`
             : 'Your account is protected with TOTP two-factor authentication'}
         </p>
       </div>
     </div>
     <Link
       to="/settings/mfa"
       className="inline-flex items-center gap-1.5 text-xs font-medium"
       style={{ color: 'var(--accent)' }}
     >
       Manage MFA <ArrowRight size={12} />
     </Link>
   </div>
 ) : (
   <div className="space-y-3">
     <p className="text-xs t-muted">Add an extra layer of security with a TOTP authenticator app plus 8 single-use recovery codes.</p>
     <Link to="/settings/mfa">
       <Button variant="primary" size="sm" title="Open MFA setup">
         <Shield size={14} /> Enable MFA
       </Button>
     </Link>
   </div>
 )}
 </Card>

 {/* Phase 4.4: API Key — personal integration credential, hidden for read-only oversight roles */}
 {!isMinimalRole && (
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Key className="w-4 h-4 text-accent" /> <span id="api">API Key</span>
 </h3>
 <div className="space-y-3">
   <p className="text-xs t-muted">Use this key to authenticate API requests programmatically. It acts with your permissions.</p>
   {generatedApiKey ? (
     <>
       <div className="flex items-center gap-2">
         <div className="flex-1 p-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)] font-mono text-xs t-primary">
           {apiKeyVisible ? generatedApiKey : '•'.repeat(20)}
         </div>
         <Button variant="secondary" size="sm" onClick={() => setApiKeyVisible(!apiKeyVisible)} title={apiKeyVisible ? 'Hide API key' : 'Reveal API key'}>
           {apiKeyVisible ? 'Hide' : 'Show'}
         </Button>
         <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(generatedApiKey)} title="Copy API key to clipboard">
           <Copy size={14} />
         </Button>
       </div>
       <p className="text-caption" style={{ color: 'var(--warning)' }}>Save this key now. It will not be shown again after you leave this page.</p>
     </>
   ) : apiKeyMeta ? (
     <div className="space-y-2">
       <div className="flex items-center gap-2 p-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
         <span className="font-mono text-xs t-primary tnum">{apiKeyMeta.prefix}••••••••</span>
         <span className="text-caption t-muted ml-auto">Created {new Date(apiKeyMeta.createdAt).toLocaleDateString()}</span>
       </div>
       <Button variant="secondary" size="sm" onClick={handleGenerateApiKey} disabled={apiKeyLoading} title="Revoke this key and generate a new one">
         {apiKeyLoading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />} Regenerate Key
       </Button>
       <p className="text-caption t-muted">Regenerating revokes this key immediately — integrations using it will stop working.</p>
     </div>
   ) : apiKeyListError ? (
     <div className="space-y-2">
       <p className="text-sm t-muted">Existing keys: — <span className="text-xs">(couldn't load)</span></p>
       <Button variant="secondary" size="sm" onClick={loadApiKeys} title="Retry loading API keys">
         <RefreshCw size={14} /> Retry
       </Button>
     </div>
   ) : (
     <Button variant="primary" size="sm" onClick={handleGenerateApiKey} disabled={apiKeyLoading} title="Generate a new API key">
       {apiKeyLoading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />} Generate API Key
     </Button>
   )}
   <FormError error={apiKeyError} />
   <p className="text-caption t-muted">Include as <code className="text-accent">X-API-Key</code> header in your requests.</p>
 </div>
 </Card>
 )}

 {/* Spec 7 POPIA-3: Data & Privacy — these endpoints act on the WHOLE TENANT
     (all users, customers, employees), so they're shown to admin roles only. */}
 {isTenantAdmin && (
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Shield className="w-4 h-4 text-accent" /> <span id="privacy">Data &amp; Privacy (POPIA)</span>
 </h3>
 <div className="space-y-4">
   <div className="p-3 rounded-md" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}>
     <p className="text-xs t-muted">POPIA (Protection of Personal Information Act) data-subject tools for your organisation. Both actions apply to <strong className="t-primary">all personal data in your organisation</strong> — every user, customer and employee record — not only your own account.</p>
   </div>
   <div className="flex gap-3">
     <Button variant="secondary" size="sm" title="Download all personal data held for your organisation (JSON)" onClick={async () => {
       try {
         const res = await api.tenants.dataExport();
         const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
         const url = URL.createObjectURL(blob);
         const a = document.createElement('a');
         a.href = url; a.download = `atheon-data-export-${new Date().toISOString().slice(0,10)}.json`;
         a.click(); URL.revokeObjectURL(url);
         toast.success('Data export ready', `${res.totalRecords} records across ${res.tableCount} tables downloaded`);
       } catch (err) {
         toast.error('Data export failed', {
           message: err instanceof Error ? err.message : 'Unable to generate export',
           requestId: err instanceof ApiError ? err.requestId : null,
         });
       }
     }}>
       <Download size={14} /> Export Organisation Data
     </Button>
     <Button variant="danger" size="sm" title="Permanently erase or anonymise all personal data in your organisation" onClick={async () => {
       if (!confirm('This erases or anonymises personal data for your ENTIRE organisation: all users, customers and employees are deleted or anonymised, and invoice/audit identities are redacted. This cannot be undone. Continue?')) return;
       if (!confirm('Final confirmation: every user in your organisation (including you) will lose their profile data immediately. Proceed with organisation-wide erasure?')) return;
       try {
         await api.tenants.dataErasure();
         toast.success('Organisation data erased', 'Redirecting to login…');
         setTimeout(() => { window.location.href = '/login'; }, 1500);
       } catch (err) {
         toast.error('Data erasure failed', {
           message: err instanceof Error ? err.message : 'Unable to erase data',
           requestId: err instanceof ApiError ? err.requestId : null,
         });
       }
     }}>
       <Trash2 size={14} /> Erase Organisation Data
     </Button>
   </div>
 </div>
 </Card>
 )}

 {/* LLM Configuration — Superadmin Only */}
 {isSuperadmin && (
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Brain className="w-4 h-4 text-accent" /> AI Engine Configuration
 <Badge variant="warning" size="sm">Superadmin</Badge>
 </h3>
 <p className="text-xs t-muted mb-4">Configure the AI provider powering Atheon Intelligence insights across Pulse, Apex, and Dashboard. Changes apply to new AI requests immediately after saving.</p>
 {llmLoadError ? (
 <div className="space-y-3">
 <p className="text-sm t-muted">Current configuration: — <span className="text-xs">(couldn't load)</span></p>
 <Button variant="secondary" size="sm" onClick={loadLlmConfig} title="Retry loading LLM configuration">
  <RefreshCw size={14} /> Retry
 </Button>
 </div>
 ) : !llmConfig ? (
 <div className="flex items-center gap-2 text-xs t-muted py-2"><Loader2 size={14} className="animate-spin" /> Loading current configuration…</div>
 ) : (
 <div className="space-y-4">
 <div>
 <label className="text-xs font-medium t-secondary mb-1 block">Provider</label>
 <select
  value={llmProvider}
  onChange={(e) => setLlmProvider(e.target.value)}
  className="w-full px-3 py-2 rounded-md text-sm bg-[var(--bg-secondary)] border border-[var(--border-card)] t-primary"
 >
  <option value="workers_ai">Cloudflare Workers AI (Default)</option>
  <option value="claude">Anthropic Claude</option>
  <option value="openai">OpenAI ChatGPT</option>
  <option value="ollama">Ollama Cloud</option>
  <option value="internal">Internal Hosted</option>
 </select>
 </div>
 <Input label="Model Name" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="e.g. claude-3-sonnet, gpt-4o, llama3.1" />
 <Input label="API Key" type="password" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} placeholder={llmConfig?.apiKeySet ? `Current: ${llmConfig.apiKeyMasked}` : 'Enter API key'} />
 {(llmProvider === 'ollama' || llmProvider === 'internal') && (
  <Input label="Base URL" value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} placeholder="https://your-server.com/v1" />
 )}
 <div className="grid grid-cols-2 gap-4">
  <div>
   <label className="text-xs font-medium t-secondary mb-1 block">Temperature ({llmTemperature})</label>
   <input type="range" aria-label="LLM temperature" min="0" max="1" step="0.1" value={llmTemperature} onChange={(e) => setLlmTemperature(parseFloat(e.target.value))} className="w-full" />
  </div>
  <div>
   <label className="text-xs font-medium t-secondary mb-1 block">Max Tokens</label>
   <input type="number" aria-label="LLM max tokens" value={llmMaxTokens} onChange={(e) => setLlmMaxTokens(parseInt(e.target.value) || 1024)} className="w-full px-3 py-2 rounded-md text-sm bg-[var(--bg-secondary)] border border-[var(--border-card)] t-primary" />
  </div>
 </div>
 <div className="flex items-center gap-3">
  <Button variant="primary" size="sm" onClick={handleSaveLlmConfig} disabled={llmSaving} title="Save AI configuration">
   {llmSaving ? <Loader2 size={14} className="animate-spin" /> : llmSaved ? <Check size={14} /> : null}
   {llmSaved ? 'Saved' : 'Save Configuration'}
  </Button>
  {llmSaved && <span className="text-xs text-accent">Configuration updated</span>}
  {llmError && <span className="text-xs text-neg">{llmError}</span>}
 </div>
 </div>
 )}
 </Card>
 )}

 {/* Platform Info — static deployment facts */}
 {!isMinimalRole && (
 <Card>
 <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
 <Cpu className="w-4 h-4 text-accent" /> <span id="platform">Platform</span>
 </h3>
 <div className="space-y-3">
 {[
 { label: 'Platform', value: 'Atheon™ Enterprise Intelligence' },
 { label: 'Version', value: '1.0.0' },
 { label: 'Deployment', value: 'Cloudflare Pages + Workers' },
 { label: 'Region', value: 'af-south-1 (South Africa)' },
 { label: 'Database', value: 'Cloudflare D1' },
 { label: 'Vector DB', value: 'Cloudflare Vectorize' },
 { label: 'AI Engine', value: 'Atheon Intelligence' },
 ].map(item => (
 <div key={item.label} className="flex items-center justify-between py-2 last:border-0" style={{ borderBottom: '1px solid var(--divider)' }}>
 <span className="text-label !text-[10px]">{item.label}</span>
 <span className="text-sm t-primary font-medium">{item.value}</span>
 </div>
 ))}
 </div>
 </Card>
 )}
 </div>

 {/* ── Help-tip + live system-status aside ────────────────────── */}
 <aside
  className="lg:sticky lg:self-start glass-card p-4 space-y-4"
  style={{ top: 'calc(var(--header-height, 48px) + 16px)' }}
  aria-label="Help and system status"
 >
  <div className="flex items-start gap-2">
   <div
    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
    style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
   >
    <HelpCircle size={15} aria-hidden />
   </div>
   <p className="text-label !text-[10px] mt-1.5 t-accent">Help Tip</p>
  </div>
  <p className="text-body-sm t-muted">
   Manage your profile and preferences. Ensure your contact details and security settings are up-to-date for optimal assurance and compliance.
  </p>
 </aside>
 </div>
 </div>
 );
}
