import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Loader2, CheckCircle, XCircle, Link2 } from "lucide-react";

/**
 * Phase 4.7: ERP OAuth Callback Page
 * Handles OAuth2 authorization code callback from ERP providers (Xero, Sage, Pastel, etc.)
 * URL: /erp/oauth/callback?code=...&state=...&provider=...
 */
export function ERPOAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing ERP authorization...');
  const [provider, setProvider] = useState<string>('');
  // OAuth codes are single-use: guard against the exchange firing twice
  // (React StrictMode re-runs effects in dev; the second call would fail
  // and overwrite a real success with an error).
  const exchangedRef = useRef(false);

  useEffect(() => {
    if (exchangedRef.current) return;
    exchangedRef.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const providerParam = searchParams.get('provider') || searchParams.get('erp') || '';

    setProvider(providerParam);

    // Providers report denial/failure via error params — surface them honestly.
    const oauthError = searchParams.get('error');
    if (oauthError) {
      setStatus('error');
      setMessage(searchParams.get('error_description') || `Authorization was not granted (${oauthError}).`);
      return;
    }

    if (!code) {
      setStatus('error');
      setMessage('Missing authorization code. The OAuth flow may have been cancelled.');
      return;
    }

    // Exchange the authorization code for an access token
    async function exchangeCode() {
      try {
        await api.erp.createConnection({
          oauth_code: code,
          oauth_state: state,
          provider: providerParam,
          type: 'oauth',
        });
        setStatus('success');
        setMessage(`Successfully connected to ${providerParam || 'ERP provider'}. You can now sync data.`);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to complete OAuth authorization. Please try again.');
      }
    }

    exchangeCode();
  }, [searchParams]);

  const heading =
    status === 'loading' ? 'Connecting…' :
    status === 'success' ? `Connected${provider ? ` to ${provider}` : ''}` :
    'Connection Failed';

  return (
    <div
      className="min-h-screen flex flex-col items-center px-6 py-10"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Wordmark header */}
      <header className="w-full max-w-3xl mx-auto">
        <h2 className="text-center text-2xl font-semibold tracking-tight t-primary">Atheon</h2>
        <div
          className="mt-5 h-px w-full"
          style={{ background: 'var(--border-card)' }}
        />
      </header>

      {/* Centered status card */}
      <main className="flex-1 w-full flex items-center justify-center">
        <Card
          variant="default"
          size="hero"
          className="max-w-md w-full rounded-2xl text-center"
          style={{
            background: 'var(--glass-bg-strong)',
            backdropFilter: 'blur(var(--glass-blur))',
            WebkitBackdropFilter: 'blur(var(--glass-blur))',
            border: '1px solid var(--glass-border)',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          {/* Status glyph */}
          <div className="flex justify-center">
            {status === 'loading' && (
              <Loader2 className="w-12 h-12 text-accent animate-spin" aria-hidden="true" />
            )}
            {status === 'success' && (
              <CheckCircle className="w-12 h-12 text-accent" strokeWidth={2.5} aria-hidden="true" />
            )}
            {status === 'error' && (
              <XCircle className="w-12 h-12 text-neg" strokeWidth={2.5} aria-hidden="true" />
            )}
          </div>

          {/* Editorial heading */}
          <h1 className="mt-6 text-2xl font-semibold tracking-tight t-primary">
            {heading}
          </h1>

          {/* Mono data-voice rows */}
          <dl
            className="mt-7 rounded-xl overflow-hidden text-left"
            style={{ border: '1px solid var(--border-card)' }}
          >
            {provider && (
              <div
                className="flex items-center gap-4 px-4 py-3"
                style={{ borderBottom: '1px solid var(--border-card)' }}
              >
                <dt className="font-mono text-mono-data uppercase t-muted w-24 shrink-0 flex items-center gap-1.5">
                  <Link2 size={12} className="text-accent" aria-hidden="true" />
                  Provider
                </dt>
                <dd className="font-mono text-mono-data t-primary capitalize">{provider}</dd>
              </div>
            )}
            <div className="flex items-start gap-4 px-4 py-3">
              <dt className="font-mono text-mono-data uppercase t-muted w-24 shrink-0">Status</dt>
              <dd className="font-mono text-mono-data t-secondary leading-relaxed">{message}</dd>
            </div>
          </dl>

          {/* Actions */}
          <div className="mt-7 flex flex-col gap-2.5">
            {status === 'success' && (
              <Button
                variant="primary"
                size="lg"
                className="w-full font-mono uppercase tracking-wide"
                onClick={() => navigate('/integrations')}
                title="Go to ERP connections page"
              >
                View Connections
              </Button>
            )}
            {status === 'error' && (
              // Authorization codes are single-use — reloading this page would
              // replay a consumed code and fail every time. The honest retry
              // is to restart the connect flow from Integrations.
              <Button
                variant="primary"
                size="lg"
                className="w-full font-mono uppercase tracking-wide"
                onClick={() => navigate('/integrations')}
                title="Restart the connection from the Integrations page"
              >
                Try Again from Integrations
              </Button>
            )}
            {status !== 'loading' && (
              <Button
                variant={status === 'success' ? 'secondary' : 'ghost'}
                size="lg"
                className="w-full"
                onClick={() => navigate('/dashboard')}
                title="Return to dashboard"
              >
                Dashboard
              </Button>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
