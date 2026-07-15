/**
 * JourneyStageBar — one-line loop locator under a stage page's header:
 *   DATA → FINDINGS → [FIXES] → SAVINGS → REPORTS
 * Current stage in accent; every label links to its canonical page.
 */
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { STAGE_LABELS, STAGE_ROUTES, stageAccessible, type StageKey } from '@/lib/journey';

const ORDER: StageKey[] = ['connect', 'detect', 'fix', 'recover', 'report'];
const MONO = "'Space Mono', ui-monospace, monospace";

/** Reverse of STAGE_ROUTES — route prefix to stage, for route-derived current. */
const ROUTE_TO_STAGE: [string, StageKey][] = (Object.entries(STAGE_ROUTES) as [StageKey, string][])
  .map(([key, route]) => [route, key]);

function stageForPath(pathname: string): StageKey | undefined {
  const hit = ROUTE_TO_STAGE.find(([route]) => pathname === route || pathname.startsWith(route + '/'));
  return hit?.[1];
}

/**
 * The value-loop locator, on every screen (rendered globally in AppLayout).
 * `current` may be passed explicitly; otherwise it's derived from the route so
 * non-loop pages (settings, admin) still show the bar as a pure locator with no
 * active highlight.
 */
export function JourneyStageBar({ current }: { current?: StageKey }) {
  const role = useAppStore((s) => s.user?.role);
  const { pathname } = useLocation();
  const active = current ?? stageForPath(pathname);
  return (
    <nav aria-label="Journey stage" className="mb-6 -mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      {ORDER.map((key, i) => {
        const className = cn(
          'text-[10px] tracking-[0.16em] uppercase',
          key === active ? 'font-bold text-accent' : 't-muted font-medium',
        );
        return (
          <span key={key} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="t-muted text-[10px]">→</span>}
            {stageAccessible(key, role) ? (
              <Link
                to={STAGE_ROUTES[key]}
                aria-current={key === active ? 'step' : undefined}
                className={cn(className, key !== active && 'hover:t-secondary')}
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
