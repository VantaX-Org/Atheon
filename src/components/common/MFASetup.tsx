/**
 * SPEC-013: MFA QR Code Rendering component
 * Renders TOTP QR code for authenticator app setup with manual entry fallback.
 */
import { useState } from 'react';
import { Shield, Copy, CheckCircle, Eye, EyeOff } from 'lucide-react';

interface MFASetupProps {
  secret: string;
  otpauthUri: string;
  onVerify: (code: string) => Promise<boolean>;
  onCancel: () => void;
}

/**
 * Generate a simple QR code as an SVG using a basic module pattern.
 * For production, consider using a library like qrcode.react.
 * This implementation uses the Google Charts API as a fallback.
 */
function QRCodeImage({ uri }: { uri: string }) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`;

  return (
    <div className="flex justify-center">
      <div className="p-4 bg-white rounded-xl shadow-md">
        <img
          src={qrUrl}
          alt="MFA QR Code - Scan with your authenticator app"
          width={200}
          height={200}
          className="rounded"
          loading="eager"
        />
      </div>
    </div>
  );
}

export function MFASetup({ secret, otpauthUri, onVerify, onCancel }: MFASetupProps) {
  const [step, setStep] = useState<'scan' | 'verify'>('scan');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for clipboard API not available
      setShowSecret(true);
    }
  };

  const handleVerify = async () => {
    if (code.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const success = await onVerify(code);
      if (!success) {
        setError('Invalid code. Please try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6" style={{ color: 'var(--accent)' }} />
        <h3 className="text-lg font-semibold t-primary">Set Up Two-Factor Authentication</h3>
      </div>

      {step === 'scan' && (
        <>
          <div className="space-y-4">
            <p className="text-sm t-secondary">
              Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.):
            </p>

            <QRCodeImage uri={otpauthUri} />

            <div className="space-y-2">
              <p className="text-xs t-muted text-center">
                Can't scan? Enter this code manually:
              </p>
              <div className="flex items-center gap-2 justify-center">
                <code
                  className="px-3 py-1.5 rounded-lg text-sm font-mono"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                >
                  {showSecret ? secret : '••••••••••••••••'}
                </code>
                <button
                  onClick={() => setShowSecret(!showSecret)}
                  className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
                  aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                >
                  {showSecret ? <EyeOff className="w-4 h-4 t-muted" /> : <Eye className="w-4 h-4 t-muted" />}
                </button>
                <button
                  onClick={handleCopySecret}
                  className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
                  aria-label="Copy secret to clipboard"
                >
                  {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 t-muted" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors"
              style={{ borderColor: 'var(--border-primary)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => setStep('verify')}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Next: Verify Code
            </button>
          </div>
        </>
      )}

      {step === 'verify' && (
        <>
          <p className="text-sm t-secondary">
            Enter the 6-digit code from your authenticator app to complete setup:
          </p>

          <div className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '');
                setCode(val);
                if (error) setError(null);
              }}
              placeholder="000000"
              className="w-full px-4 py-3 rounded-lg border text-center text-2xl tracking-[0.5em] font-mono"
              style={{ borderColor: error ? '#ef4444' : 'var(--border-primary)', background: 'var(--bg-input)' }}
              autoFocus
              aria-label="6-digit verification code"
              aria-invalid={!!error}
              aria-describedby={error ? 'mfa-error' : undefined}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) handleVerify(); }}
            />
            {error && (
              <p id="mfa-error" className="text-sm text-red-500 text-center" role="alert">{error}</p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => { setStep('scan'); setCode(''); setError(null); }}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors"
              style={{ borderColor: 'var(--border-primary)' }}
            >
              Back
            </button>
            <button
              onClick={handleVerify}
              disabled={verifying || code.length !== 6}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {verifying ? 'Verifying...' : 'Enable MFA'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
