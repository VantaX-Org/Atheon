# Control Tower — /x console form redesign

2026-07-17. The console keeps the river and every existing component; only the
*shape* changes: from a scrolling page to a fixed-viewport command center.

## Metaphor

An air-traffic control tower: one elevated vantage, everything visible and
controllable without leaving the seat. The river is the radar; it never
scrolls away.

## Layout (desktop ≥1100px wide, ≥620px tall)

```
┌──────────────────────── cab: Shell bar ────────────────────────┐
│ logo · Brief/Decisions/Ledger/Catalysts (deck selector) ·      │
│ breakouts · Jeff · theme · persona · avatar                    │
├─────────────┬──────────────────────────────────────────────────┤
│ MAST        │ ticker — live external signals                   │
│ recovered   │ ┌──────────────────────────────────────────────┐ │
│ (hero)      │ │ RADAR — the river, always visible            │ │
│ pulse strip │ └──────────────────────────────────────────────┘ │
│ leakage     │ legend note                                      │
│ ROI         │ ────────────── DECK ──────────────               │
│ at the gate │ active section only (Brief | Decisions |         │
│ Jeff brief  │ Ledger | Catalysts), internal scroll             │
└─────────────┴──────────────────────────────────────────────────┘
```

Below the breakpoint nothing changes: today's stacked scroll layout, scrollspy
and all, is the fallback. The tower is pure CSS + a small navigation shim.

## Behaviour changes

- Shell pills, hero figures, pulse strip, and river-drawer "Open …" buttons
  all route through one `goSection(anchor)`: set the active section, update
  the `#hash`, then `scrollIntoView` (scrolls the deck in tower mode, the page
  in fallback). Anchors that live inside a section map to their owner
  (`leaks → brief`).
- The active deck drives the reactor focus lens exactly as scrollspy did; the
  scrollspy still runs and only ever fires in the fallback layout (hidden
  sections never intersect).
- Persona switches that drop the active section snap to the persona's first
  section.

## Non-goals

- No data-layer changes; sections, Reactor, river, personas, Jeff untouched.
- /operations, /assurance, /console stay as gated breakouts in the cab.
- No new dependencies.

## Files

- `src/x/ConsolePage.tsx` — mast/tower-main/deck wrappers, `goSection`,
  `data-active` on the page grid, hash deep-link handling.
- `src/x/Shell.tsx` — pills call `onSection` instead of scrolling directly.
- `src/x/Reactor.tsx` — optional `onGoTo` so drawer buttons use `goSection`.
- `src/x/tokens.css` — `.rx.tower` media-query block; fallback untouched.
