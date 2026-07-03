/**
 * JourneySpine — the five-stage value loop as a row of stage cards.
 * Home's centerpiece: one number, one RAG dot, one CTA per stage.
 * Current stage carries the 3px royal-blue left rule (existing active language).
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { JourneyStage } from '@/lib/journey';

const MONO = "'Space Mono', ui-monospace, monospace";

const RAG_COLOR: Record<JourneyStage['rag'], string | null> = {
  green: 'var(--positive)',
  amber: 'var(--warning)',
  red: 'var(--neg)',
  none: null,
};

export function JourneySpine({ stages }: { stages: JourneyStage[] }) {
  return (
    <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Your journey">
      {stages.map((s, i) => {
        const dot = RAG_COLOR[s.rag];
        return (
          <li key={s.key} className="relative">
            <Link to={s.route} aria-current={s.current ? 'step' : undefined} className="block h-full group">
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
                <p className="flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase font-bold t-muted" style={{ fontFamily: MONO }}>
                  <span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  {s.label}
                  {dot && <span aria-hidden="true" className="ml-auto inline-block w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
                </p>
                <p className="mt-2 text-xl font-bold t-primary tabular-nums truncate">{s.headline ?? '—'}</p>
                <p className="text-caption t-muted truncate">{s.sub ?? ' '}</p>
                <p className={cn('mt-3 text-caption inline-flex items-center gap-1 font-medium', s.current ? 'text-accent' : 't-secondary group-hover:text-accent')}>
                  {s.cta} <ArrowRight size={11} aria-hidden="true" />
                </p>
              </Card>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
