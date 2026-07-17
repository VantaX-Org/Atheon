import './tokens.css';

// SubPage — the console's deep-surface shell. One frontend: the same rx shell
// tops every deep surface (operations, assurance, fixes, runs, pulse, findings,
// settings); the legacy page component renders inside a scrolling body. Section
// pills navigate back to /x#anchor instead of scrolling in place.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { Shell } from './Shell';
import { activePersona, type PersonaKey } from './persona';

export function SubPage({ title, children }: { title: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTenantName = useAppStore((s) => s.activeTenantName ?? s.user?.tenantName ?? null);
  const persona = useMemo(
    () => activePersona(searchParams.toString(), activeTenantName),
    [searchParams, activeTenantName],
  );
  const onPersona = (k: PersonaKey) => {
    const next = new URLSearchParams(searchParams);
    next.set('as', k);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="rx sub">
      <Shell
        persona={persona}
        onPersona={onPersona}
        onSection={(id) => navigate(`/x#${id}`)}
        decisionsCount={null}
      />
      <main className="subpage">
        <div className="sub-head">
          <button className="sub-back" onClick={() => navigate('/x')}>← Console</button>
          <h1>{title}</h1>
        </div>
        {/* ponytail: legacy pages keep their own Tailwind styling; wrapper only bounds width */}
        <div className="xlegacy">{children}</div>
      </main>
    </div>
  );
}
