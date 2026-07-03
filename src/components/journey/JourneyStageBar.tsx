/**
 * JourneyStageBar — one-line loop locator under a stage page's header:
 *   DATA → FINDINGS → [FIXES] → SAVINGS → REPORTS
 * Current stage in accent; every label links to its canonical page.
 */
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { STAGE_LABELS, STAGE_ROUTES, type StageKey } from '@/lib/journey';

const ORDER: StageKey[] = ['connect', 'detect', 'fix', 'recover', 'report'];
const MONO = "'Space Mono', ui-monospace, monospace";

export function JourneyStageBar({ current }: { current: StageKey }) {
  return (
    <nav aria-label="Journey stage" className="mb-6 -mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      {ORDER.map((key, i) => (
        <span key={key} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="t-muted text-[10px]">→</span>}
          <Link
            to={STAGE_ROUTES[key]}
            aria-current={key === current ? 'step' : undefined}
            className={cn(
              'text-[10px] tracking-[0.16em] uppercase',
              key === current ? 'font-bold text-accent' : 't-muted hover:t-secondary font-medium',
            )}
            style={{ fontFamily: MONO }}
          >
            {STAGE_LABELS[key]}
          </Link>
        </span>
      ))}
    </nav>
  );
}
