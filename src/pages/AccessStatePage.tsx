/**
 * AccessStatePage — Stitch-styled "System — Access Denied (403)" + 404.
 *
 * One component, two surfaces. Centred card on the page-pattern radial
 * gradient (the Stitch body background). Lucide icon, sage
 * accent tile, headline-xl title, body copy, primary CTA back to the
 * dashboard.
 *
 * Used by:
 *   - ProtectedRoute when a role check fails ({kind: '403'})
 *   - The catch-all `<Route path="*">` at the bottom of App.tsx ({kind: '404'})
 */
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ShieldX, Compass, type LucideIcon } from 'lucide-react';

interface AccessStatePageProps {
  kind: '403' | '404';
  /** Optional list of roles that *would* satisfy this route (403 only). */
  requiredRoles?: string[];
}

const COPY: Record<'403' | '404', { Icon: LucideIcon; title: string; code: string; body: string; cta: string }> = {
  '403': {
    Icon: ShieldX,
    title: 'Access Denied',
    code: '403',
    body: "You don't have permission to access this page. If you think this is wrong, ask your tenant admin to grant your role the required permissions.",
    cta: 'Back to Dashboard',
  },
  '404': {
    Icon: Compass,
    title: 'Page not found',
    code: '404',
    body: "The page you're looking for doesn't exist, or has been moved. Check the URL or head back to the dashboard.",
    cta: 'Back to Dashboard',
  },
};

export function AccessStatePage({ kind, requiredRoles }: AccessStatePageProps): JSX.Element {
  const c = COPY[kind];
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-12"
      style={{
        background: 'var(--bg-primary)',
        backgroundImage:
          'radial-gradient(48rem 32rem at 50% -8%, var(--accent-subtle) 0%, transparent 70%)',
        backgroundAttachment: 'fixed',
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden"
        style={{
          background: 'var(--bg-card-solid)',
          border: '1px solid var(--border-card)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {/* Hero band — mono eyebrow + giant error code, mirroring the dashboard metric voice */}
        <div
          className="flex items-stretch gap-5 px-7 sm:px-9 pt-8 pb-7"
          style={{
            borderBottom: '1px solid var(--border-card)',
            background: 'var(--accent-subtle)',
          }}
        >
          <div
            className="shrink-0 w-14 h-14 rounded-lg flex items-center justify-center border"
            style={{
              background: 'var(--bg-card-solid)',
              borderColor: 'rgb(var(--accent-rgb) / 0.20)',
            }}
            aria-hidden="true"
          >
            <c.Icon size={28} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />

          </div>
          <div className="flex flex-col justify-center min-w-0">
            <p
              className="text-label mb-1"
              style={{
                fontFamily: "'Space Mono', ui-monospace, monospace",
                color: 'var(--accent)',
              }}
            >
              Access State
            </p>
            <div className="flex items-baseline gap-3 leading-none">
              <span
                className="font-bold tracking-tight"
                style={{
                  fontFamily: "'Space Mono', ui-monospace, monospace",
                  fontSize: '3rem',
                  color: 'var(--accent)',
                  lineHeight: 1,
                }}
              >
                {c.code}
              </span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-7 sm:px-9 py-8">
          <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight mb-3">
            {c.title}
          </h1>
          <p className="text-body-sm t-muted max-w-md leading-relaxed">{c.body}</p>

          {kind === '403' && requiredRoles && requiredRoles.length > 0 && (
            <div
              className="mt-5 rounded-lg px-4 py-3"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-card)',
              }}
            >
              <p className="text-label mb-2">
                Required role{requiredRoles.length === 1 ? '' : 's'}
              </p>
              <div className="flex flex-wrap gap-2">
                {requiredRoles.map((role) => (
                  <span
                    key={role}
                    className="inline-flex items-center rounded-md px-2.5 py-1"
                    style={{
                      fontFamily: "'Space Mono', ui-monospace, monospace",
                      fontSize: '11px',
                      letterSpacing: '0.04em',
                      background: 'var(--accent-subtle)',
                      color: 'var(--accent)',
                      border: '1px solid rgb(var(--accent-rgb) / 0.20)',
                    }}
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>
          )}

          <Link to="/dashboard" className="block mt-7 w-full">
            <Button variant="primary" size="md" className="w-full">
              {c.cta}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default AccessStatePage;
