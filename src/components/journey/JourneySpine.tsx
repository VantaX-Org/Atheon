/**
 * JourneySpine — the five-stage value loop as a row of stage cards.
 * Home's centerpiece: one number, one RAG dot, one CTA per stage.
 * Current stage carries the 3px royal-blue left rule (existing active language).
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { stageAccessible, type JourneyStage } from '@/lib/journey';

function MaybeLink({
  clickable,
  route,
  current,
  children,
}: {
  clickable: boolean;
  route: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return clickable ? (
    <Link to={route} aria-current={current ? 'step' : undefined} className="block h-full group">
      {children}
    </Link>
  ) : (
    <div className="block h-full" aria-current={current ? 'step' : undefined}>
      {children}
    </div>
  );
}

const RAG_COLOR: Record<JourneyStage['rag'], string | null> = {
  green: 'var(--positive)',
  amber: 'var(--warning)',
  red: 'var(--neg)',
  none: null,
};

export function JourneySpine({ stages }: { stages: JourneyStage[] }) {
  const role = useAppStore((s) => s.user?.role);
  return (
    <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Your journey">
      {stages.map((s, i) => {
        const dot = RAG_COLOR[s.rag];
        const clickable = stageAccessible(s.key, role);
        return (
          <li key={s.key} className="relative">
            <MaybeLink clickable={clickable} route={s.route} current={s.current}>
              <Card
                className={cn('relative h-full p-4 transition-colors', s.current ? '' : 'opacity-90 hover:opacity-100')}
                style={s.current ? { background: 'var(--accent-subtle)' } : undefined}
              >
                {s.current && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
                <p className="flex items-center gap-2 text-label">
                  <span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  {s.label}
                  {dot && <span aria-hidden="true" className="ml-auto inline-block w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
                </p>
                <p className="mt-2 text-headline-xl t-primary tnum truncate">{s.headline ?? '—'}</p>
                {/* nbsp keeps the row height when a stage has no sub-line */}
                <p className="text-caption t-muted truncate">{s.sub ?? ' '}</p>
                <p className={cn('mt-3 text-caption inline-flex items-center gap-1 font-medium', s.current ? 'text-accent' : 't-secondary group-hover:text-accent')}>
                  {/* Role's route gate blocks this stage's page — show loop context, never a 403 link. */}
                  {clickable ? s.cta : 'Handled by your team'}
                  {clickable && <ArrowRight size={11} aria-hidden="true" />}
                </p>
              </Card>
            </MaybeLink>
          </li>
        );
      })}
    </ol>
  );
}
