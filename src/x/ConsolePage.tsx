import './tokens.css';

// Recovery Console — one cohesive screen. Reactor on top, Brief · Decisions ·
// Ledger · Catalysts sections beneath. Built out task-by-task; this skeleton
// establishes the .rx scope, shell slot, and the four section anchors.

const SECTIONS = [
  { id: 'brief', label: 'Brief' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'catalysts', label: 'Catalysts' },
] as const;

export function ConsolePage() {
  return (
    <div className="rx">
      <div className="shell-wrap">
        <div className="shell">
          <span className="logo"><i>A</i>Atheon</span>
          <nav className="tabs" aria-label="Sections">
            {SECTIONS.map((s) => (
              <button key={s.id} onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })}>
                {s.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <main className="page">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id}>
            <div className="head">
              <h1>{s.label}</h1>
              <p className="why">—</p>
            </div>
          </section>
        ))}
        <p className="footnote">
          Recovery Console preview. Every figure on this screen traces to a booked
          API field; a dash means the source has not reported.
        </p>
      </main>
    </div>
  );
}
