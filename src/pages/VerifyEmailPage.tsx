import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { API_URL } from '@/lib/api';
import { CheckCircle, XCircle, Loader2, Mail } from 'lucide-react';

type VerifyState = 'loading' | 'success' | 'error' | 'expired' | 'already_verified';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<VerifyState>('loading');
  const [message, setMessage] = useState('');
  const [resending, setResending] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resendSuccess, setResendSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('No verification token provided.');
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await res.json() as { success?: boolean; error?: string; message?: string; already_verified?: boolean };

        if (res.ok && data.success) {
          setState('success');
          setMessage(data.message || 'Your email has been verified successfully.');
        } else if (data.already_verified) {
          setState('already_verified');
          setMessage('Your email is already verified. You can log in.');
        } else if (res.status === 410 || (data.error && data.error.toLowerCase().includes('expired'))) {
          setState('expired');
          setMessage(data.error || 'This verification link has expired.');
        } else {
          setState('error');
          setMessage(data.error || 'Verification failed. The link may be invalid.');
        }
      } catch {
        setState('error');
        setMessage('Unable to reach the server. Please try again later.');
      }
    };

    verify();
  }, [token]);

  const handleResend = async () => {
    if (!resendEmail) return;
    setResending(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail }),
      });
      if (res.ok) {
        setResendSuccess(true);
      } else {
        const data = await res.json() as { error?: string };
        setMessage(data.error || 'Failed to resend verification email.');
      }
    } catch {
      setMessage('Unable to reach the server.');
    } finally {
      setResending(false);
    }
  };

  const badge = (() => {
    switch (state) {
      case 'loading':
        return { Icon: Loader2, bg: 'var(--accent)', fg: 'var(--text-on-accent)', spin: true };
      case 'success':
      case 'already_verified':
        return { Icon: CheckCircle, bg: 'var(--accent)', fg: 'var(--text-on-accent)', spin: false };
      case 'expired':
        return { Icon: Mail, bg: 'rgb(var(--warning-rgb) / 0.12)', fg: 'var(--warning)', spin: false };
      case 'error':
      default:
        return { Icon: XCircle, bg: 'rgb(var(--neg-rgb) / 0.12)', fg: 'var(--neg)', spin: false };
    }
  })();

  const heading = (() => {
    switch (state) {
      case 'loading': return 'Verifying your email…';
      case 'success': return 'Email verified';
      case 'already_verified': return 'Already verified';
      case 'error': return 'Verification failed';
      case 'expired': return 'Link expired';
    }
  })();

  return (
    <div className="min-h-screen flex items-center justify-center bg-theme-primary px-4">
      <div className="w-full max-w-md card-glass px-10 py-12 text-center flex flex-col items-center">
        <div
          className="flex items-center justify-center rounded-full"
          style={{ width: 76, height: 76, background: badge.bg }}
        >
          <badge.Icon
            className={`w-9 h-9 ${badge.spin ? 'animate-spin' : ''}`}
            style={{ color: badge.fg }}
            strokeWidth={2.25}
          />
        </div>

        <h1 className="mt-7 text-headline-xl font-bold t-primary tracking-tight leading-tight">
          {heading}
        </h1>

        <p
          className="mt-3 text-sm t-secondary"
          style={{ fontFamily: "'Space Mono', ui-monospace, monospace", letterSpacing: '0.06em' }}
        >
          {message}
        </p>

        {(state === 'success' || state === 'already_verified') && (
          <Link
            to="/login"
            className="mt-8 inline-flex items-center justify-center px-8 py-3 rounded-full text-sm font-semibold text-[var(--text-on-accent)] transition-colors"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Go to login
          </Link>
        )}

        {state === 'expired' && !resendSuccess && (
          <div className="mt-7 w-full space-y-3">
            <p className="text-label">Enter your email to receive a new link</p>
            <input
              type="email"
              placeholder="your@email.com"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border text-sm text-center"
              style={{ borderColor: 'var(--border-card)', background: 'var(--bg-input)' }}
              aria-label="Email address for resend"
            />
            <button
              onClick={handleResend}
              disabled={resending || !resendEmail}
              className="w-full inline-flex items-center justify-center px-6 py-3 rounded-full text-sm font-semibold text-[var(--text-on-accent)] transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {resending ? 'Sending…' : 'Resend verification email'}
            </button>
          </div>
        )}

        {resendSuccess && (
          <p
            className="mt-6 text-sm"
            style={{ color: 'var(--accent)', fontFamily: "'Space Mono', ui-monospace, monospace", letterSpacing: '0.04em' }}
          >
            A new verification email has been sent. Check your inbox.
          </p>
        )}

        {state === 'error' && (
          <Link
            to="/login"
            className="mt-8 inline-block text-label hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Back to login
          </Link>
        )}

        <div className="mt-8 pt-6 w-full border-t" style={{ borderColor: 'var(--border-card)' }}>
          <p className="text-label">Need help? Contact our support team.</p>
        </div>
      </div>
    </div>
  );
}
