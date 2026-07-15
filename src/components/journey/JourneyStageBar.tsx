/**
 * JourneyStageBar — one-line loop locator under a stage page's header:
 *   DATA → FINDINGS → [FIXES] → SAVINGS → REPORTS
 * Current stage in accent; every label links to its canonical page.
 */
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { STAGE_LABELS, STAGE_ROUTES, stageAccessible, type StageKey } from '@/lib/journey';

const ORDER: StageKey[] = ['connect', 'detect', 'fix', 'recover', 'report'];
const MONO = "'Space Mono', ui-monospace, monospace";

export function JourneyStageBar({ current }: { current: StageKey }) {
  const role = useAppStore((s) => s.user?.role);
  return (
    <nav aria-label="Journey stage" className="mb-6 -mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      {ORDER.map((key, i) => {
        const className = cn(
          'text-[10px] tracking-[0.16em] uppercase',
          key === current ? 'font-bold text-accent' : 't-muted font-medium',
        );
        return (
          <span key={key} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="t-muted text-[10px]">→</span>}
            {stageAccessible(key, role) ? (
              <Link
                to={STAGE_ROUTES[key]}
                aria-current={key === current ? 'step' : undefined}
                className={cn(className, key !== current && 'hover:t-secondary')}
                style={{ fontFamily: MONO }}
              >
                {STAGE_LABELS[key]}
              </Link>
            ) : (
              // Stage exists in the loop but this role's route gate blocks it — locator text, not a 403 link.
              <span className={className} style={{ fontFamily: MONO }}>
                {STAGE_LABELS[key]}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
