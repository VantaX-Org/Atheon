import './tokens.css';

// Embeddable river panel for surfaces outside /x. Two divs on purpose:
// tokens.css styles descendants of .rx, so the outer div carries the token
// scope (page-level min-height/background neutralised inline) and the inner
// div is the mount. Theme follows :root[data-theme] like the rest of the app.
// Callers must memoize `graph` (and `opts` if passed) or the canvas remounts
// every render.
import { useEffect, useRef } from 'react';
import { mountRiver, type RiverOpts } from './river';
import type { RiverGraph } from './flows';

export function MiniRiver({
  graph,
  label,
  className = 'flowpanel short',
  opts,
}: {
  graph: RiverGraph;
  label: string;
  className?: string;
  opts?: RiverOpts;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return mountRiver(ref.current, graph.nodes, graph.edges, opts ?? {});
  }, [graph, opts]);
  return (
    <div className="rx" style={{ minHeight: 'auto', background: 'transparent' }}>
      <div ref={ref} className={className} style={{ minWidth: 0 }} role="img" aria-label={label}>
        <canvas />
      </div>
    </div>
  );
}
