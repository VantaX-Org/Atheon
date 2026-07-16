// Bespoke icon set for the Recovery Console. Flow-curve motifs echo the
// river: 20px viewBox, 1.5px rounded strokes, currentColor throughout.
export type IconName =
  | 'brief' | 'decisions' | 'ledger' | 'catalysts'
  | 'world' | 'ops' | 'gate' | 'seal' | 'jeff'
  | 'company' | 'persona' | 'settings' | 'mfa' | 'support' | 'signout' | 'export';

const PATHS: Record<IconName, React.ReactNode> = {
  // page with a river line running through it
  brief: (
    <>
      <rect x="4" y="2.5" width="12" height="15" rx="2" />
      <path d="M7 7h6M7 13.5c1.5 0 1.5-2 3-2s1.5 2 3 2" />
    </>
  ),
  // flows converging on a gate, one released
  decisions: (
    <>
      <path d="M3 6c4 0 4 4 7 4M3 14c4 0 4-4 7-4" />
      <path d="M12.5 7v6" />
      <path d="M14.5 10h3m0 0-1.8-1.8M17.5 10l-1.8 1.8" />
    </>
  ),
  // ledger rows with a booked total
  ledger: (
    <>
      <path d="M4 4.5h12M4 8.5h12M4 12.5h7" />
      <path d="M13.5 14.5l1.6 1.6 3-3.2" />
    </>
  ),
  // spark riding a flow curve
  catalysts: (
    <>
      <path d="M3 13c5 0 5-6 10-6" />
      <path d="M13.5 3.5 11 9h3l-2.5 5.5" />
    </>
  ),
  // globe with flow meridians
  world: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M2.5 10h15M10 2.5c-2.5 2.5-2.5 12.5 0 15M10 2.5c2.5 2.5 2.5 12.5 0 15" />
    </>
  ),
  // three operations nodes feeding one stream
  ops: (
    <>
      <circle cx="5" cy="5" r="2" />
      <circle cx="5" cy="15" r="2" />
      <circle cx="15" cy="10" r="2.5" />
      <path d="M7 5.5c3 .5 3 4 5.6 4.3M7 14.5c3-.5 3-4 5.6-4.3" />
    </>
  ),
  // river pooling at a gate
  gate: (
    <>
      <path d="M3 7c4 0 4 3 6.5 3M3 13c4 0 4-3 6.5-3" />
      <path d="M12 5.5v9" />
      <circle cx="16" cy="10" r="1.5" />
    </>
  ),
  // sealed ribbon badge
  seal: (
    <>
      <circle cx="10" cy="8" r="5" />
      <path d="M8 15.5 7 18l3-1.5 3 1.5-1-2.5M8 8l1.6 1.6L13 6.5" />
    </>
  ),
  // Jeff: spark of four flow curves
  jeff: (
    <>
      <path d="M10 3c0 4 3 7 7 7-4 0-7 3-7 7 0-4-3-7-7-7 4 0 7-3 7-7Z" />
      <path d="M15.5 3.5v3M14 5h3" />
    </>
  ),
  // building with entrance
  company: (
    <>
      <rect x="4.5" y="3" width="11" height="14" rx="1" />
      <path d="M8 6.5h1M11 6.5h1M8 9.5h1M11 9.5h1M8 12.5h1M11 12.5h1M10 17v-2.5" />
    </>
  ),
  // person under a lens arc
  persona: (
    <>
      <circle cx="10" cy="7" r="3" />
      <path d="M4.5 16.5c1-3.5 4-4.5 5.5-4.5s4.5 1 5.5 4.5" />
    </>
  ),
  // two tuning sliders
  settings: (
    <>
      <path d="M4 6.5h12M4 13.5h12" />
      <circle cx="8" cy="6.5" r="1.8" />
      <circle cx="12.5" cy="13.5" r="1.8" />
    </>
  ),
  // shield with keyhole
  mfa: (
    <>
      <path d="M10 2.5 16 5v5c0 4-2.5 6.5-6 7.5-3.5-1-6-3.5-6-7.5V5l6-2.5Z" />
      <circle cx="10" cy="9" r="1.5" />
      <path d="M10 10.5V13" />
    </>
  ),
  // speech bubble with pulse
  support: (
    <>
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h9A2.5 2.5 0 0 1 17 5.5v6a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V5.5Z" />
      <path d="M6.5 8.5h2l1-1.8 1.5 3.2 1-1.4h1.5" />
    </>
  ),
  // door with outbound flow
  signout: (
    <>
      <path d="M8 3H5.5A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17H8" />
      <path d="M8 10h8.5m0 0-2.5-2.5M16.5 10 14 12.5" />
    </>
  ),
  // sealed page leaving the tray
  export: (
    <>
      <path d="M10 12.5v-9m0 0L7 6.5M10 3.5l3 3" />
      <path d="M3.5 13v2.5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5V13" />
    </>
  ),
};

export function XIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
