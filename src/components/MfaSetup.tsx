// TASK-008: MFA QR Code setup component for Settings page
import { useState } from "react";
import { Shield, Copy, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface MfaSetupProps {
  isEnabled: boolean;
  onComplete: () => void;
}

export function MfaSetup({ isEnabled, onComplete }: MfaSetupProps) {
  const [step, setStep] = useState<'idle' | 'setup' | 'verify' | 'complete'>('idle');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.auth.mfaSetup() as { qr_data_url?: string; secret?: string; qr_uri?: string };
      setQrDataUrl(result.qr_data_url || result.qr_uri || '');
      setSecret(result.secret || '');
      setStep('setup');
    } catch (err) {
      setError('Failed to initialize MFA setup. Please try again.');
      console.error('MFA setup error:', err);
    }
    setLoading(false);
  };

  const handleVerify = async () => {
    if (verifyCode.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.auth.mfaVerify(verifyCode);
      setStep('complete');
      onComplete();
    } catch (err) {
      setError('Invalid code. Please check your authenticator app and try again.');
      console.error('MFA verify error:', err);
    }
    setLoading(false);
  };

  const handleDisable = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.auth.mfaVerify('disable');
      setStep('idle');
      onComplete();
    } catch (err) {
      setError('Failed to disable MFA. Please try again.');
      console.error('MFA disable error:', err);
    }
    setLoading(false);
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isEnabled && step === 'idle') {
    return (
      <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
        <div className="flex items-center gap-3 mb-3">
          <Shield size={20} className="text-emerald-500" />
          <div>
            <h3 className="text-sm font-semibold t-primary">MFA Enabled</h3>
            <p className="text-xs t-secondary">Your account is protected with two-factor authentication.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleDisable} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
          Disable MFA
        </Button>
      </div>
    );
  }

  if (step === 'complete') {
    return (
      <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-center">
        <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-2" />
        <h3 className="text-sm font-semibold t-primary mb-1">MFA Enabled Successfully</h3>
        <p className="text-xs t-secondary">Your account is now protected with two-factor authentication.</p>
      </div>
    );
  }

  if (step === 'setup') {
    return (
      <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] space-y-4">
        <h3 className="text-sm font-semibold t-primary flex items-center gap-2">
          <Shield size={16} className="text-accent" /> Set Up Two-Factor Authentication
        </h3>
        
        <div className="text-center">
          {qrDataUrl ? (
            <div className="inline-block p-4 bg-white rounded-xl">
              <img src={qrDataUrl} alt="MFA QR Code" className="w-48 h-48" />
            </div>
          ) : (
            <p className="text-sm t-muted">Scan the QR code with your authenticator app</p>
          )}
        </div>

        {secret && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-secondary)]">
            <code className="text-xs font-mono t-primary flex-1 select-all">{secret}</code>
            <button onClick={copySecret} className="p-1 rounded hover:bg-[var(--bg-card)]" title="Copy secret">
              {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} className="t-muted" />}
            </button>
          </div>
        )}

        <div>
          <label className="text-xs font-medium t-primary block mb-1">Verification Code</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="flex-1 px-3 py-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border-card)] rounded-lg t-primary outline-none focus:border-accent"
              maxLength={6}
              autoComplete="one-time-code"
              aria-label="Enter 6-digit verification code"
            />
            <Button onClick={handleVerify} disabled={loading || verifyCode.length !== 6}>
              {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Verify
            </Button>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  // Idle state - not enabled
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
      <div className="flex items-center gap-3 mb-3">
        <Shield size={20} className="t-muted" />
        <div>
          <h3 className="text-sm font-semibold t-primary">Two-Factor Authentication</h3>
          <p className="text-xs t-secondary">Add an extra layer of security to your account.</p>
        </div>
      </div>
      <Button onClick={handleSetup} disabled={loading}>
        {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Shield size={14} className="mr-1" />}
        Enable MFA
      </Button>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}
