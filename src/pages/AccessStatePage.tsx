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
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { ShieldX, Compass, type LucideIcon } from 'lucide-react';

interface AccessStatePageProps {
  kind: '403' | '404';
  /** Optional list of roles that *would* satisfy this route (403 only). */
  requiredRoles?: string[];
}

const COPY: Record<'403' | '404', { Icon: LucideIcon; title: string; code: string; body: string }> = {
  '403': {
    Icon: ShieldX,
    title: 'Access Denied',
    code: '403',
    body: "You don't have permission to access this page. If you think this is wrong, ask your tenant admin to grant your role the required permissions.",
  },
  '404': {
    Icon: Compass,
    title: 'Page not found',
    code: '404',
    body: "The page you're looking for doesn't exist, or has been moved. Check the URL or head back.",
  },
};

/**
 * A destination this user's role can actually reach (route buckets in
 * App.tsx): auditor → /compliance, board_member → /board-digest, other
 * authed roles → /dashboard. Logged out (404 renders outside AppLayout)
 * → public home.
 */
function homeFor(role: string | undefined): { to: string; label: string } {
  if (!role) return { to: '/', label: 'Back to home' };
  if (role === 'auditor') return { to: '/x/assurance', label: 'Back to Assurance' };
  if (role === 'board_member') return { to: '/board', label: 'Back to Board Digest' };
  return { to: '/dashboard', label: 'Back to Dashboard' };
}

export function AccessStatePage({ kind, requiredRoles }: AccessStatePageProps): JSX.Element {
  const c = COPY[kind];
  const user = useAppStore((s) => s.user);
  const location = useLocation();
  const home = homeFor(user?.role);

  // 403 → pre-filled access ticket so the user can request access in one click.
  const ticketBody =
    `I hit a 403 on ${location.pathname}.\n` +
    `My role: ${user?.role ?? 'unknown'}\n` +
    `Required role${(requiredRoles?.length ?? 0) === 1 ? '' : 's'}: ${requiredRoles?.join(', ') || 'unknown'}\n\n` +
    'What I was trying to do: ';
  const ticketLink =
    '/support-tickets?new=1&category=access' +
    `&subject=${encodeURIComponent(`Access request: ${location.pathname}`)}` +
    `&body=${encodeURIComponent(ticketBody)}`;
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

          <Link to={home.to} className="block mt-7 w-full">
            <Button variant="primary" size="md" className="w-full">
              {home.label}
            </Button>
          </Link>

          {kind === '403' && user && (
            <p className="text-center mt-4">
              <Link
                to={ticketLink}
                className="text-caption font-mono uppercase tracking-wide text-accent hover:underline"
              >
                Request access via support ticket
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default AccessStatePage;
