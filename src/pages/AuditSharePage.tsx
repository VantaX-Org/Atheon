/**
 * /audit-share/:token — public, read-only SOC 2 evidence pack.
 *
 * No login. The token in the URL is the credential. Mounted outside the
 * AppLayout so it has its own header / footer and looks like a clean
 * auditor-facing report rather than a leaked operational page.
 *
 * Backed by GET /api/v1/audit-share/:token. The backend logs every access
 * (IP + timestamp + count) so the issuing admin can see who opened the
 * link, and revoke it from /compliance at any time.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import {
  ShieldCheck, KeyRound, ClipboardList, AlertTriangle,
  UserMinus, Lock, FileArchive, Clock,
} from 'lucide-react';

type EvidencePack = Awaited<ReturnType<typeof api.compliance.evidencePack>>;
interface SharePayload {
  label: string | null;
  expires_at: string;
  pack: EvidencePack;
}

const MONO = "'Space Mono', ui-monospace, monospace";

const TONE_COLOR: Record<string, string> = {
  good: 'var(--rag-healthy)',
  warn: 'var(--rag-watch)',
  bad: 'var(--rag-risk)',
};

function StatCell({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone ? TONE_COLOR[tone] : 'var(--text-primary)';
  return (
    <div style={{
      padding: '18px 20px',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-card-solid)',
    }}>
      <div style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--text-muted)',
      }}>{label}</div>
      <div style={{
        fontSize: 28,
        fontWeight: 700,
        color,
        fontVariantNumeric: 'tabular-nums',
        marginTop: 8,
        lineHeight: 1.1,
      }}>{value}</div>
    </div>
  );
}

function Section({ icon: Icon, title, code, children }: {
  icon: typeof ShieldCheck;
  title: string;
  code: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{
      padding: '28px 32px',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--border-card)',
      background: 'var(--bg-card-solid)',
      boxShadow: 'var(--shadow-card-light)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 'var(--radius-sm)',
          background: 'var(--accent-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon width={17} height={17} color="var(--accent)" aria-hidden="true" />
        </div>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{title}</h2>
        <span style={{
          marginLeft: 'auto',
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--accent)',
          padding: '5px 10px',
          background: 'var(--accent-subtle)',
          borderRadius: 999,
        }}>{code}</span>
      </div>
      {children}
    </section>
  );
}

export default function AuditSharePage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setError({ status: 404, message: 'No token in URL' });
      return;
    }
    api.auditShare.fetchPack(token)
      .then((r) => setData(r as SharePayload))
      .catch((err) => {
        const status = err instanceof ApiError ? err.status : 500;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError({ status, message });
      });
  }, [token]);

  const bgStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: 'var(--bg-primary)',
    backgroundImage: 'var(--bg-pattern)',
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    color: 'var(--text-primary)',
  };

  if (error) {
    return (
      <div style={bgStyle}>
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '140px 24px', textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 'var(--radius)', margin: '0 auto 20px',
            background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)',
            boxShadow: 'var(--shadow-card-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Lock size={28} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            {error.status === 410 ? 'This link is no longer valid.' :
             error.status === 404 ? 'Link not found.' :
             'Something went wrong.'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15, marginTop: 12, lineHeight: 1.6 }}>
            {error.status === 410
              ? 'It may have been revoked or have expired. Ask the issuer for a new one.'
              : error.status === 404
                ? 'The URL is incomplete or has been mistyped. Check that the token in the URL exactly matches the one you were sent.'
                : 'We could not load the evidence pack. The server reported: ' + error.message}
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={bgStyle}>
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '180px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <div style={{
            width: 20, height: 20, border: '2px solid var(--border-card)', borderTopColor: 'var(--accent)',
            borderRadius: '50%', margin: '0 auto 14px', animation: 'aspin 800ms linear infinite',
          }} />
          <style>{`@keyframes aspin { to { transform: rotate(360deg) } }`}</style>
          <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Loading evidence pack
          </span>
        </div>
      </div>
    );
  }

  const { pack, label, expires_at } = data;
  const mfaTone = pack.mfa.mfaCoveragePct >= 90 ? 'good' : pack.mfa.mfaCoveragePct >= 70 ? 'warn' : 'bad';
  const incidentTone = pack.incidentResponse.openCritical > 0 ? 'bad' : 'good';
  const plaintextTone = pack.encryption.erpPlaintext > 0 ? 'warn' : 'good';
  const expiresIn = Math.max(0, Math.round((new Date(expires_at).getTime() - Date.now()) / 86400000));

  function downloadJson() {
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atheon-soc2-evidence-${pack.generatedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div style={bgStyle}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '64px 24px 80px' }}>
        {/* Centered brand wordmark */}
        <header style={{ textAlign: 'center', marginBottom: 36 }}>
          <h1 style={{
            fontSize: 34, fontWeight: 700, color: 'var(--text-primary)', margin: 0,
            letterSpacing: '-0.03em',
          }}>
            Atheon
          </h1>
          <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-secondary)' }}>
            {label
              ? <>Shared as <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{label}</strong></>
              : 'SOC 2 Evidence — Auditor View'}
          </div>
        </header>

        {/* Frosted hero card */}
        <div style={{
          background: 'var(--glass-bg-strong)',
          backdropFilter: `blur(var(--glass-blur))`,
          WebkitBackdropFilter: `blur(var(--glass-blur))`,
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-glass)',
          padding: '44px 48px',
          marginBottom: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1,
              color: TONE_COLOR[mfaTone],
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
            }}>
              {pack.mfa.mfaCoveragePct}%
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShieldCheck size={26} color="var(--accent)" aria-hidden="true" />
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                Verified<br />MFA Coverage
              </div>
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: MONO, fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--text-muted)',
          }}>
            <Clock size={13} aria-hidden="true" />
            Expires in {expiresIn} day{expiresIn === 1 ? '' : 's'}
          </div>
        </div>

        {/* Generated meta line */}
        <div style={{
          textAlign: 'center', marginBottom: 28,
          fontFamily: MONO, fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          color: 'var(--text-muted)',
        }}>
          Generated {new Date(pack.generatedAt).toLocaleString()} · Read-only · Aggregated evidence
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
          <Section icon={ShieldCheck} title="Access reviews" code="SOC 2 CC6.1, CC6.2">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <StatCell label="Active admins" value={pack.accessReviews.activeAdminCount} />
              <StatCell label="Active users" value={pack.accessReviews.activeUserCount} />
              <StatCell label="Admins assigned (90d)" value={pack.accessReviews.adminsAssignedLast90d} />
              <StatCell label="Role changes (90d)" value={pack.accessReviews.roleChangesLast90d} />
            </div>
          </Section>

          <Section icon={KeyRound} title="MFA posture" code="SOC 2 CC6.6">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <StatCell label="MFA coverage" value={`${pack.mfa.mfaCoveragePct}%`} tone={mfaTone} />
              <StatCell label="MFA enabled" value={pack.mfa.mfaEnabled} />
              <StatCell label="Total users" value={pack.mfa.totalUsers} />
              <StatCell label="Admins in grace" value={pack.mfa.adminsInGracePeriod} />
              <StatCell label="Expired grace" value={pack.mfa.adminsExpiredGrace} tone={pack.mfa.adminsExpiredGrace > 0 ? 'bad' : 'good'} />
            </div>
          </Section>

          <Section icon={ClipboardList} title="Configuration changes" code="SOC 2 CC8.1">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <StatCell label="Changes (30d)" value={pack.configChanges.changesLast30d} />
              <StatCell label="Changes (90d)" value={pack.configChanges.changesLast90d} />
            </div>
            {pack.configChanges.topActions.length > 0 && (
              <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Top actions</span>
                {' '}{pack.configChanges.topActions.slice(0, 5).map(a => `${a.action} (${a.count})`).join(' · ')}
              </div>
            )}
          </Section>

          <Section icon={AlertTriangle} title="Incident response" code="SOC 2 CC7.3, CC7.4">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <StatCell label="Total critical (90d)" value={pack.incidentResponse.totalCriticalLast90d} />
              <StatCell label="Resolved critical (90d)" value={pack.incidentResponse.resolvedCriticalLast90d} />
              <StatCell label="Open critical" value={pack.incidentResponse.openCritical} tone={incidentTone} />
              <StatCell
                label="Median resolution"
                value={pack.incidentResponse.medianResolutionHours != null
                  ? `${pack.incidentResponse.medianResolutionHours}h`
                  : '—'}
              />
            </div>
          </Section>

          <Section icon={UserMinus} title="Deprovisioning" code="SOC 2 CC6.2">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <StatCell label="Deprovisioned (90d)" value={pack.deprovisioning.deprovisionedLast90d} />
              <StatCell label="Currently disabled" value={pack.deprovisioning.currentlyDisabled} />
              <StatCell label="Privileged disabled" value={pack.deprovisioning.privilegedDisabled} tone={pack.deprovisioning.privilegedDisabled > 0 ? 'warn' : 'good'} />
            </div>
          </Section>

          <Section icon={Lock} title="Encryption at rest" code="SOC 2 CC6.7">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <StatCell label="ERP encrypted" value={pack.encryption.erpEncrypted} tone="good" />
              <StatCell label="ERP plaintext" value={pack.encryption.erpPlaintext} tone={plaintextTone} />
              <StatCell label="Total connections" value={pack.encryption.totalConnections} />
            </div>
          </Section>

          <Section icon={FileArchive} title="Audit retention" code="SOC 2 CC4.1">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <StatCell label="Audit log rows" value={pack.auditRetention.totalRows.toLocaleString()} />
              <StatCell
                label="Oldest event"
                value={pack.auditRetention.oldestEventAt
                  ? new Date(pack.auditRetention.oldestEventAt).toLocaleDateString()
                  : '—'}
              />
              <StatCell label="Provenance chain" value={pack.auditRetention.provenanceChainLength.toLocaleString()} />
            </div>
            <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              The provenance chain is a separate immutable record (Merkle + HMAC) of every AI
              decision — auditable independently of the audit log.
            </div>
          </Section>
        </div>

        <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <button
            onClick={downloadJson}
            style={{
              padding: '12px 22px',
              borderRadius: 'var(--radius-control)',
              background: 'var(--accent)',
              color: 'var(--text-on-accent)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              boxShadow: 'var(--shadow-raised)',
              transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1), background 160ms ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-hover)'}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.97)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'var(--accent)'; }}
          >
            Download JSON snapshot
          </button>
          <div style={{
            fontFamily: MONO, fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--text-muted)', maxWidth: 360, textAlign: 'right', lineHeight: 1.6,
          }}>
            Access logged · Auto-expires {new Date(expires_at).toLocaleDateString()} · Revocable at any time
          </div>
        </div>

        {/* Verification footer */}
        <footer style={{
          marginTop: 48, paddingTop: 24,
          borderTop: '1px solid var(--border-subtle)',
          textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={14} color="var(--accent)" aria-hidden="true" />
            <span style={{
              fontFamily: MONO, fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)',
            }}>
              Atheon Assurance — Trusted Financial Proof
            </span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            Read-only · Aggregated over existing tables
          </div>
        </footer>
      </div>
    </div>
  );
}
