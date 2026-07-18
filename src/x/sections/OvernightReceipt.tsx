// Overnight Recovery Receipt — the returning-user headline. While the operator
// was away, Atheon's scheduled sub-catalysts ran autonomously; this band is the
// sealed proof of what they did. Renders ONLY when runCount > 0 — silence means
// nothing ran (honest), never a fabricated "R 0 recovered". recoveredZar can be
// 0 while identifiedZar > 0 (found discrepancies, no verified write-back yet):
// each of those states gets its own honest sentence, no rounding-up.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { OvernightReceipt as Receipt } from '@/lib/api';
import { formatCompactCurrency } from '@/lib/format-currency';
import { useTenantCurrency } from '@/stores/appStore';

const LAST_SEEN_KEY = 'atheon.lastSeen';

function since(): string | undefined {
  try {
    const v = localStorage.getItem(LAST_SEEN_KEY);
    return v && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v : undefined;
  } catch { return undefined; }
}
// ponytail: bump lastSeen once per mount. Multi-tab races just mean one tab's
// window closes a little early — acceptable; a server-side last_login would be
// the upgrade if that ever matters.
function bumpLastSeen() {
  try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* private mode */ }
}

export function OvernightReceipt() {
  const currency = useTenantCurrency();
  const [r, setR] = useState<Receipt | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.roi.overnight(since());
        if (!cancelled) setR(res);
      } catch { /* stays null → band hidden */ }
      finally { bumpLastSeen(); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!r || r.runCount === 0) return null;

  const money = (v: number) => formatCompactCurrency(v, currency);
  const headline =
    r.recoveredZar > 0
      ? <>Atheon recovered <b>{money(r.recoveredZar)}</b> while you were away</>
      : r.identifiedZar > 0
        ? <>Atheon surfaced <b>{money(r.identifiedZar)}</b> to recover while you were away</>
        : <>Atheon ran <b>{r.runCount}</b> reconciliation{r.runCount === 1 ? '' : 's'} while you were away — all clean</>;

  const sub = [
    `${r.runCount} autonomous reconciliation${r.runCount === 1 ? '' : 's'}`,
    r.actionsCompleted > 0 ? `${r.actionsCompleted} write-back${r.actionsCompleted === 1 ? '' : 's'} verified` : null,
    r.actionsPending > 0 ? `${r.actionsPending} awaiting your sign-off` : null,
    r.recoveredZar > 0 && r.identifiedZar > r.recoveredZar ? `${money(r.identifiedZar)} identified` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="overnight-receipt in" role="status">
      <button className="or-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="or-seal" aria-hidden>◆</span>
        <span className="or-copy">
          <span className="or-kicker">Overnight recovery · sealed receipt</span>
          <span className="or-headline num">{headline}</span>
          <span className="or-sub num">{sub}</span>
        </span>
        <span className="or-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="or-runs">
          {r.runs.map((run) => (
            <div key={run.id} className="or-run">
              <span className="or-run-name">{run.name}</span>
              <span className="or-run-stats num">
                {run.matched} matched · {run.discrepancies} discrepanc{run.discrepancies === 1 ? 'y' : 'ies'}
                {run.exceptions > 0 ? ` · ${run.exceptions} exception${run.exceptions === 1 ? '' : 's'}` : ''}
              </span>
              <span className="or-run-val num">{run.identifiedZar != null ? money(run.identifiedZar) : '—'}</span>
            </div>
          ))}
          <Link className="or-proof" to="/x#ledger">View the sealed ledger & verify the chain →</Link>
        </div>
      )}
    </div>
  );
}
