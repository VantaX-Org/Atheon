import { Suspense, useEffect, useRef, useState } from "react";
import { MotionConfig, motion, useScroll, useSpring, useInView, animate, type Variants } from "motion/react";
import { MiniRiver } from "@/x/MiniRiver";
import { journeyRiver } from "@/x/flows";
import { lazyWithRetry } from "@/lib/lazy-with-retry";

// three.js stays out of the main bundle — loaded only when the hero mounts.
const MarketingHero3D = lazyWithRetry(() => import("./MarketingHero3D"));

// hero entrance — parent staggers, children spring up
const heroRise: Variants = {
  hide: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 170, damping: 26 } },
};

// stable graph — the brand river, labels only (module-level so the canvas mounts once)
const JOURNEY = journeyRiver();

/* The brand river on a 3D stage — pointer parallax tilts the card, idle float
   keeps it alive. Tilt is written to CSS custom properties so React never
   re-renders on mouse move. Reduced-motion drops the float via CSS. */
function RiverHero3D() {
  const tiltRef = useRef<HTMLDivElement | null>(null);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = tiltRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;   // 0..1
    const py = (e.clientY - r.top) / r.height;   // 0..1
    el.style.setProperty("--ry", `${(px - 0.5) * 16}deg`);
    el.style.setProperty("--rx", `${9 - (py - 0.5) * 14}deg`);
  }
  function onLeave() {
    const el = tiltRef.current;
    if (!el) return;
    el.style.setProperty("--ry", "-7deg");
    el.style.setProperty("--rx", "9deg");
  }

  return (
    <div className="mk5-river-stage" onMouseMove={onMove} onMouseLeave={onLeave}>
      <div className="mk5-river-3d" ref={tiltRef}>
        <div className="mk5-river-head">
          <span>The Atheon loop</span>
          <span className="dim">Connect &middot; Detect &middot; Fix &middot; Recover &middot; Report</span>
        </div>
        <MiniRiver
          graph={JOURNEY}
          className="flowpanel mid"
          label="The Atheon loop: connect, detect, fix, recover, report"
        />
        <div className="mk5-river-floor" aria-hidden />
      </div>
    </div>
  );
}

/* ============================================================
   ATHEON MARKETING PAGE — Luminous Editorial
   Warm white field. Royal-blue brand accent. Hairline grid.
   Inter + Space Mono. Light-only. Tokens ride the global brand.
   ============================================================ */

const marketingCSS = `
.mk5-body {
  /* Reskinned onto the product .rx design system (tokens.css).
     --ink is inherited from the .rx token set on this same element; the rest
     alias the product tokens so every .mk5-* rule follows the live theme
     (light default, navy dark via OS / data-theme). */
  --field: var(--bg);
  --field-2: var(--card2);
  --paper: var(--card);
  --paper-hover: var(--card2);
  --ink-2: var(--body);
  --ink-3: var(--mut);
  --rule: var(--line);
  --rule-strong: var(--ink);
  --accent-c: var(--brand);
  --accent-hover-c: var(--brand-dk);
  --accent-tint: var(--brand-soft);
  --bronze: var(--warn);
  --neg-c: var(--bad);
  font-family: 'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-feature-settings: "ss01", "ss02";
  background: var(--field);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-x: hidden;
}
.mk5-body ::selection { background: var(--accent-c); color: var(--text-on-accent, #fff); }
.mk5-body a { color: inherit; text-decoration: none; }
.mk5-body h1, .mk5-body h2, .mk5-body h3, .mk5-body h4 {
  font-family: 'Schibsted Grotesk', 'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.mk5-body em, .mk5-body i { font-style: italic; font-weight: 500; color: var(--accent-c); }
.mk5-body strong { font-weight: 600; color: var(--ink); }
.mk5-mono { font-family: 'Space Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-feature-settings: "tnum", "zero"; }

/* Section frame helper */
.mk5-frame { border-top: 1px solid var(--rule); }

/* Hairline horizontal rule */
.mk5-hr { height: 1px; background: var(--rule); border: 0; }

/* NAV */
.mk5-nav {
  position: sticky; top: 0; width: 100%; z-index: 60;
  display: flex; justify-content: space-between; align-items: center;
  padding: 1.25rem 3rem;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: saturate(140%) blur(8px);
  -webkit-backdrop-filter: saturate(140%) blur(8px);
  border-bottom: 1px solid var(--rule);
}
.mk5-nav-logo {
  display: flex; align-items: center; gap: .55rem;
  font-family: 'IBM Plex Sans', sans-serif; font-weight: 600;
  font-size: 1.0625rem; letter-spacing: -0.005em; color: var(--ink);
}
.mk5-nav-links { display: flex; gap: 2.25rem; align-items: center; }
.mk5-nav-links a {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; font-weight: 400;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-2);
  padding: .5rem 0; /* ≥24px hit area on an 11px label */
  transition: color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-nav-links a:hover { color: var(--ink); }
.mk5-nav-cta {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem !important; font-weight: 500 !important;
  letter-spacing: 0.16em !important; text-transform: uppercase;
  padding: .55rem 1.1rem !important;
  border: 1px solid var(--ink);
  color: var(--ink) !important;
  background: transparent;
  border-radius: 999px;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1), color 120ms cubic-bezier(0.23, 1, 0.32, 1), border-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-nav-cta:hover { background: var(--ink); color: var(--field) !important; }
.mk5-nav-cta span { position: relative; z-index: 1; }
/* Primary filled pill (mockup "Book Demo") */
.mk5-nav-cta.primary {
  border-color: var(--accent-c);
  background: var(--accent-c);
  color: var(--text-on-accent, #fff) !important;
}
.mk5-nav-cta.primary:hover { background: var(--accent-hover-c); border-color: var(--accent-hover-c); color: var(--text-on-accent, #fff) !important; }
.mk5-nav-cta.quiet {
  border-color: transparent;
  color: var(--ink-2) !important;
  padding-left: .5rem !important; padding-right: .5rem !important;
}
.mk5-nav-cta.quiet:hover { background: transparent; color: var(--ink) !important; }

/* MOBILE HAMBURGER */
.mk5-hamburger {
  display: none; background: none; border: 0; cursor: pointer; padding: .5rem;
  width: 36px; height: 36px;
}
.mk5-hamburger span {
  display: block; width: 18px; height: 1px; background: var(--ink); margin: 4px auto;
  transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-hamburger.open span:nth-child(1) { transform: translateY(5px) rotate(45deg); }
.mk5-hamburger.open span:nth-child(2) { opacity: 0; }
.mk5-hamburger.open span:nth-child(3) { transform: translateY(-5px) rotate(-45deg); }

/* MOBILE MENU OVERLAY */
.mk5-mobile-menu {
  position: fixed; top: 64px; left: 0; right: 0; bottom: 0;
  background: var(--field);
  border-top: 1px solid var(--rule);
  display: none; flex-direction: column; gap: 1rem;
  padding: 2rem; z-index: 55;
}
.mk5-mobile-menu.open { display: flex; }
.mk5-mobile-menu a {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink); padding: .75rem 0; border-bottom: 1px solid var(--rule);
}

/* HERO — headline over the business value chain flow (the centerpiece) */
.mk5-hero {
  position: relative;
  min-height: calc(100vh - 64px);
  display: flex; flex-direction: column; justify-content: center;
  gap: 3.25rem;
  padding: 5rem 3rem 6rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-hero-eyebrow {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-2);
  margin-bottom: 2rem;
  display: flex; align-items: center; gap: .75rem;
}
.mk5-hero-eyebrow::before {
  content: ""; display: inline-block; width: 24px; height: 1px; background: var(--ink-2);
}
.mk5-hero-left h1 {
  font-size: clamp(2.5rem, 5.6vw, 5rem);
  line-height: 0.98; letter-spacing: -0.035em;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--ink);
  margin-bottom: 1.75rem;
}
.mk5-hero-left h1 .thin { font-weight: 300; color: var(--ink-3); text-transform: none; }
.mk5-hero-left h1 i { font-style: italic; color: var(--accent-c); font-weight: 700; }
.mk5-hero-desc {
  font-size: 1.0625rem; line-height: 1.55;
  color: var(--ink-2);
  max-width: 34rem;
  margin-bottom: 2.25rem;
}
.mk5-hero-actions { display: flex; gap: 1.5rem; flex-wrap: wrap; align-items: center; }
/* text-link secondary action ("see how it works") */
.mk5-hero-textlink {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; font-weight: 500;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink);
  background: transparent; border: 0; padding: 0; cursor: pointer;
  display: inline-flex; align-items: center; gap: .5rem;
  border-bottom: 1px solid var(--ink);
  padding-top: .35rem; padding-bottom: .25rem; /* ≥24px hit area */
  transition: color 120ms cubic-bezier(0.23, 1, 0.32, 1), border-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-hero-textlink:hover { color: var(--accent-c); border-color: var(--accent-c); }

/* VALUE CHAIN FLOW — the spend cycle: where it leaks (warn/bad), what Atheon recovers (ok) */
.mk5-chain { width: 100%; --chain-warn: #9a6200; --chain-bad: #d33b4e; --chain-ok: #0f8a4d; }
.mk5-chain-head {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1.1rem;
}
.mk5-chain-head .t {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-chain-legend {
  display: flex; gap: 1.5rem; flex-wrap: wrap;
  font-family: 'Space Mono', monospace;
  font-size: .625rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-3);
}
.mk5-chain-legend span { display: inline-flex; align-items: center; gap: .45rem; }
.mk5-chain-dot { width: 7px; height: 7px; border-radius: 999px; display: inline-block; flex: none; }
.mk5-chain-dot.leak { background: var(--chain-warn); }
.mk5-chain-dot.ok { background: var(--chain-ok); }
.mk5-chain-row { display: flex; align-items: stretch; }
.mk5-chain-stage {
  position: relative;
  flex: 1 1 0; min-width: 0;
  border: 1px solid var(--rule); border-radius: 4px;
  background: var(--paper);
  padding: 1.2rem 1.1rem 1rem;
  display: flex; flex-direction: column; gap: .55rem;
  box-shadow: 0 2px 8px -4px rgba(15, 17, 21, 0.08);
}
/* Leak drip — value falling out of the stage, caught by the recovery rail below */
.mk5-chain-stage.sev-warn { --leak-c: var(--chain-warn); }
.mk5-chain-stage.sev-bad { --leak-c: var(--chain-bad); }
.mk5-chain-stage::after {
  content: ""; position: absolute; left: 50%; top: 100%;
  width: 2px; height: 26px; margin-left: -1px;
  background: repeating-linear-gradient(180deg, var(--leak-c) 0 5px, transparent 5px 9px);
  opacity: .55;
}
.mk5-chain-stage .num {
  font-size: .5625rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--ink-3);
}
.mk5-chain-stage .name {
  font-size: 1.125rem; font-weight: 600; letter-spacing: -0.012em;
  color: var(--ink);
}
.mk5-chain-leak {
  margin: 0;
  font-size: .8125rem; line-height: 1.45;
  display: flex; gap: .45rem; align-items: baseline;
}
.mk5-chain-leak .mark { font-family: 'Space Mono', monospace; font-size: .75rem; flex: none; }
.mk5-chain-leak.warn { color: var(--chain-warn); }
.mk5-chain-leak.bad { color: var(--chain-bad); }
.mk5-chain-fix {
  margin-top: auto; padding-top: .6rem;
  border-top: 1px solid var(--rule);
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.04em;
  color: var(--chain-ok);
  display: flex; gap: .45rem; align-items: baseline;
}
.mk5-chain-link {
  flex: 0 0 auto; align-self: center;
  padding: 0 .3rem;
  color: var(--ink-3);
  display: flex; align-items: center;
}
/* Recovery rail — catches the drips, flows recovered value back left to the P&L */
.mk5-recover-rail {
  margin-top: 26px; /* exactly the drip height, so drips land on the rail */
  border: 1px solid color-mix(in srgb, var(--chain-ok) 35%, transparent);
  background: color-mix(in srgb, var(--chain-ok) 6%, transparent);
  border-radius: 4px;
  padding: .7rem 1.1rem;
  display: flex; align-items: center; gap: 1rem;
  font-family: 'Space Mono', monospace;
  font-size: .65rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--chain-ok);
}
.mk5-recover-rail .rflow {
  flex: 1; height: 2px; min-width: 40px;
  background: repeating-linear-gradient(90deg, var(--chain-ok) 0 10px, transparent 10px 18px);
  opacity: .55;
}
@keyframes mk5-flow-back { from { background-position-x: 0; } to { background-position-x: -18px; } }
@keyframes mk5-drip { from { background-position-y: 0; } to { background-position-y: 9px; } }
@keyframes mk5-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: no-preference) {
  .mk5-chain-stage { animation: mk5-rise .55s cubic-bezier(0.23, 1, 0.32, 1) both; }
  .mk5-chain-stage::after { animation: mk5-drip 1s linear infinite; }
  .mk5-recover-rail { animation: mk5-rise .55s cubic-bezier(0.23, 1, 0.32, 1) .5s both; }
  .mk5-recover-rail .rflow { animation: mk5-flow-back 1.2s linear infinite; }
}

/* ---- Motion layer: scroll progress bar + three.js hero backdrop ---- */
.mk5-progress {
  position: fixed; top: 0; left: 0; right: 0; height: 2px;
  background: var(--accent-c); transform-origin: 0 50%; z-index: 70;
}
.mk5-hero-3d { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.mk5-hero-3d canvas { width: 100%; height: 100%; display: block; }
.mk5-hero-left, .mk5-hero-scroll { position: relative; z-index: 1; }
.mk5-river-stage { z-index: 1; }
@media (hover: hover) {
  .mk5-chain-stage { transition: opacity 250ms ease, transform 250ms ease, box-shadow 250ms ease; }
  .mk5-chain-row:has(.mk5-chain-stage:hover) .mk5-chain-stage:not(:hover) { opacity: .45; }
  .mk5-chain-stage:hover { transform: translateY(-3px); box-shadow: 0 10px 24px -12px rgba(15, 17, 21, 0.25); }
}

/* ---- 3D RIVER HERO — the brand river as the centrepiece, on a tilting stage ---- */
.mk5-river-stage {
  position: relative;
  width: 100%;
  perspective: 1500px;
  perspective-origin: 50% 32%;
}
.mk5-river-3d {
  position: relative;
  transform-style: preserve-3d;
  transform: rotateX(var(--rx, 9deg)) rotateY(var(--ry, -7deg));
  transition: transform 500ms cubic-bezier(0.23, 1, 0.32, 1);
  border: 1px solid var(--rule);
  border-radius: 16px;
  background: linear-gradient(158deg, color-mix(in srgb, var(--accent-c) 7%, var(--paper)) 0%, var(--paper) 58%);
  box-shadow:
    0 55px 95px -50px color-mix(in srgb, var(--accent-c) 55%, transparent),
    0 20px 44px -26px rgba(15, 17, 21, 0.20),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
  padding: 1.4rem 1.5rem 1.15rem;
  will-change: transform;
}
.mk5-river-head {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 1rem; flex-wrap: wrap; margin-bottom: .4rem;
  transform: translateZ(46px);
  font-family: 'Space Mono', monospace;
  font-size: .625rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-river-head .dim { color: var(--ink-3); letter-spacing: 0.13em; }
/* canvas panel floats a touch forward off the card face for real depth */
.mk5-river-3d .rx { transform: translateZ(30px); }
/* brand-lit floor reflection under the tilted card */
.mk5-river-floor {
  position: absolute; left: 8%; right: 8%; bottom: -7%; height: 46px;
  background: radial-gradient(ellipse at center, color-mix(in srgb, var(--accent-c) 32%, transparent), transparent 70%);
  filter: blur(15px); opacity: .5; z-index: -1;
}
@keyframes mk5-river-float {
  0%, 100% { transform: translateY(0) rotateZ(0deg); }
  50%      { transform: translateY(-11px) rotateZ(-0.28deg); }
}
@media (prefers-reduced-motion: no-preference) {
  .mk5-river-stage { animation: mk5-river-float 11s ease-in-out infinite; }
}

/* Value-chain band (moved out of the hero, below the river) */
.mk5-vchain { padding: 5rem 3rem; border-bottom: 1px solid var(--rule); }
.mk5-vchain-intro { max-width: 44rem; margin-bottom: 2.25rem; }
.mk5-vchain-intro h2 {
  font-size: clamp(1.75rem, 3.4vw, 2.75rem); line-height: 1.02;
  letter-spacing: -0.025em; font-weight: 300; color: var(--ink); margin-bottom: 1rem;
}
.mk5-vchain-intro p { font-size: 1.0625rem; line-height: 1.55; color: var(--ink-2); }

.mk5-hero-scroll {
  position: absolute; left: 3rem; bottom: 1.75rem;
  display: flex; align-items: center; gap: .75rem;
  font-family: 'Space Mono', monospace; font-size: .6875rem;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-3);
}
.mk5-scroll-line { width: 36px; height: 1px; background: var(--ink-3); }

/* BUTTONS */
.mk5-btn-main {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; font-weight: 500;
  letter-spacing: 0.14em; text-transform: uppercase;
  padding: .85rem 1.6rem;
  background: var(--accent-c);
  color: var(--text-on-accent, #fff) !important;
  border: 1px solid var(--accent-c);
  border-radius: 2px;
  cursor: pointer;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
  display: inline-block;
}
.mk5-btn-main:hover { background: var(--accent-hover-c); border-color: var(--accent-hover-c); }
.mk5-btn-main:disabled { opacity: 0.5; cursor: not-allowed; }
.mk5-btn-line {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; font-weight: 500;
  letter-spacing: 0.14em; text-transform: uppercase;
  padding: .85rem 1.6rem;
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--ink);
  border-radius: 2px;
  cursor: pointer;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1), color 120ms cubic-bezier(0.23, 1, 0.32, 1);
  display: inline-block;
}
.mk5-btn-line:hover { background: var(--ink); color: var(--field); }

/* TICKER (kept as a single hairline marquee strip) */
.mk5-ticker {
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--field);
  overflow: hidden; padding: 1.1rem 0;
}
.mk5-ticker-track {
  display: flex; gap: 3rem; white-space: nowrap;
  animation: mk5-marquee 60s linear infinite;
  font-family: 'Space Mono', monospace;
  font-size: .75rem; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-ticker-item { display: inline-flex; align-items: center; gap: 3rem; }
.mk5-ticker-dot {
  display: inline-block; width: 4px; height: 4px;
  background: var(--accent-c); border-radius: 999px;
}
@keyframes mk5-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

/* SHARED-SAVINGS STRIP (new — persistent CFO ledger) */
.mk5-ss {
  display: grid; grid-template-columns: auto 1fr auto auto auto;
  gap: 2.5rem; align-items: end;
  padding: 2.5rem 3rem;
  border-bottom: 1px solid var(--rule);
  background: var(--field);
}
.mk5-ss-label {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-ss-meta {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; color: var(--ink-3);
  letter-spacing: 0.04em;
}
.mk5-ss-figure {
  display: flex; flex-direction: column; gap: .25rem;
  min-width: 9rem; padding-left: 2rem; border-left: 1px solid var(--rule);
}
.mk5-ss-amount {
  font-family: 'Space Mono', monospace; font-feature-settings: "tnum";
  font-size: 1.625rem; font-weight: 500; letter-spacing: -0.01em;
  color: var(--ink);
}
.mk5-ss-amount.accent { color: var(--accent-c); }
.mk5-ss-tag {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--ink-2);
}

/* MANIFESTO */
.mk5-product {
  padding: 7rem 3rem 8rem;
  max-width: 84rem; margin: 0 auto;
  border-bottom: 1px solid var(--rule);
}
.mk5-product-intro { max-width: 46rem; }
.mk5-product-eyebrow {
  font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-3); display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1.5rem;
}
.mk5-product-eyebrow::before { content: ""; width: 2rem; height: 1px; background: var(--rule-strong); }
.mk5-product-intro h2 {
  font-size: clamp(2rem, 4vw, 3.1rem); line-height: 1.05; letter-spacing: -0.02em;
  font-weight: 400; color: var(--ink); margin-bottom: 1.25rem;
}
.mk5-product-intro p { font-size: 1.05rem; line-height: 1.6; color: var(--ink-2); max-width: 34rem; }
.mk5-product figure { margin: 0; }
.mk5-product figure img {
  display: block; width: 100%; height: auto; border-radius: 10px;
  border: 1px solid var(--rule); box-shadow: 0 24px 60px -28px rgba(15, 17, 21, 0.28);
  background: var(--paper);
}
.mk5-product figcaption {
  margin-top: 0.85rem; font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ink-3);
}
.mk5-product-hero { margin-top: 3rem; }
.mk5-product-grid {
  margin-top: 1.75rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1.75rem;
}
@media (max-width: 820px) {
  .mk5-product { padding: 4.5rem 1.5rem 5rem; }
  .mk5-product-grid { grid-template-columns: 1fr; }
}

.mk5-manifesto {
  padding: 9rem 3rem;
  max-width: 80rem; margin: 0 auto;
  border-bottom: 1px solid var(--rule);
}
.mk5-manifesto-text {
  font-size: clamp(1.5rem, 3vw, 2.5rem);
  line-height: 1.32; letter-spacing: -0.012em;
  color: var(--ink);
  font-weight: 400;
  max-width: 56rem;
}
.mk5-manifesto-text em { color: var(--accent-c); font-style: italic; }
.mk5-manifesto-text strong { color: var(--ink); font-weight: 600; }

/* EVOLUTION STRIP */
.mk5-evo {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-bottom: 1px solid var(--rule);
}
.mk5-evo-item {
  padding: 3rem 2.5rem;
  border-right: 1px solid var(--rule);
  display: flex; flex-direction: column; gap: 1rem;
  position: relative;
  background: var(--field);
}
.mk5-evo-item:last-child { border-right: 0; }
.mk5-evo-item.future { background: var(--accent-tint); }
.mk5-evo-era {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-3);
}
.mk5-evo-era.future { color: var(--accent-c); }
.mk5-evo-name {
  font-size: 2rem; font-weight: 500; letter-spacing: -0.015em;
  color: var(--ink);
}
.mk5-evo-desc {
  font-size: .9375rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-evo-arrow { display: none; }

/* LAYERS SECTION */
.mk5-layers, .mk5-ethos {
  padding: 7rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-layers-intro {
  display: grid; grid-template-columns: 1fr 2fr;
  gap: 4rem; margin-bottom: 5rem;
}
.mk5-layers-intro-left {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-2);
  position: sticky; top: 5rem; align-self: start;
}
.mk5-layers-intro-right h2 {
  font-size: clamp(2rem, 4vw, 3.5rem);
  line-height: 1.05; letter-spacing: -0.022em; margin-bottom: 1.5rem;
}
.mk5-layers-intro-right p {
  font-size: 1.0625rem; line-height: 1.55; color: var(--ink-2);
  max-width: 42rem;
}
.mk5-layer-block {
  display: grid; grid-template-columns: 80px 1fr 280px;
  gap: 3rem; align-items: start;
  padding: 3.5rem 0;
  border-top: 1px solid var(--rule);
}
.mk5-layer-block:last-child { border-bottom: 1px solid var(--rule); }
.mk5-layer-num {
  font-family: 'Space Mono', monospace; font-feature-settings: "tnum";
  font-size: 2.5rem; font-weight: 400; color: var(--ink-3);
  letter-spacing: -0.01em;
}
.mk5-layer-name {
  font-size: 1.75rem; font-weight: 500; letter-spacing: -0.015em;
  color: var(--ink); margin-bottom: .25rem;
}
.mk5-layer-role {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--ink-2); margin-bottom: 1.25rem;
}
.mk5-layer-role.bronze { color: var(--bronze); }
.mk5-layer-role.sky, .mk5-layer-role.sage { color: var(--accent-c); }
.mk5-layer-desc {
  font-size: .9375rem; line-height: 1.6; color: var(--ink-2);
  margin-bottom: 1.5rem; max-width: 36rem;
}
.mk5-layer-tags { display: flex; flex-wrap: wrap; gap: .5rem; }
.mk5-layer-tag {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.1em;
  padding: .35rem .75rem;
  border: 1px solid var(--rule);
  color: var(--ink-2);
  background: var(--paper);
  border-radius: 2px;
}
.mk5-layer-visual {
  width: 100%; aspect-ratio: 4/3;
  border: 1px solid var(--rule);
  background: var(--paper);
  display: flex; align-items: center; justify-content: center;
}

/* BIG STATEMENT */
.mk5-big-stmt {
  padding: 9rem 3rem; text-align: left;
  border-bottom: 1px solid var(--rule);
  max-width: 80rem; margin: 0 auto;
}
.mk5-big-stmt h2 {
  font-size: clamp(3rem, 8vw, 7rem);
  line-height: 0.95; letter-spacing: -0.035em;
  font-weight: 400;
}
.mk5-big-stmt h2 .stroke {
  color: var(--ink-3); font-weight: 300;
}
.mk5-big-stmt h2 .glow {
  color: var(--accent-c); font-style: italic; font-weight: 500;
}

/* STATS */
.mk5-stats {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border-bottom: 1px solid var(--rule);
}
.mk5-stat-item {
  padding: 3rem 2.5rem;
  border-right: 1px solid var(--rule);
  display: flex; flex-direction: column; gap: .75rem;
  background: var(--field);
}
.mk5-stat-item:last-child { border-right: 0; }
.mk5-stat-num {
  font-family: 'Space Mono', monospace; font-feature-settings: "tnum";
  font-size: 3rem; font-weight: 500; letter-spacing: -0.02em;
  color: var(--ink);
}
.mk5-stat-num .accent { color: var(--accent-c); }
.mk5-stat-label {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-2);
}

/* PERSONAS (new — auditor + board roles surfaced) */
.mk5-personas {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-personas-header {
  display: grid; grid-template-columns: 1fr 2fr;
  gap: 4rem; margin-bottom: 3rem;
}
.mk5-personas-header .left {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-personas-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em; margin-bottom: 1.25rem;
}
.mk5-personas-header p {
  font-size: 1rem; line-height: 1.55; color: var(--ink-2); max-width: 42rem;
}
.mk5-personas-grid {
  display: grid; grid-template-columns: repeat(5, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
}
.mk5-persona {
  padding: 2.25rem 1.75rem;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--field);
  display: flex; flex-direction: column; gap: .75rem;
}
.mk5-persona:last-child { border-right: 0; }
.mk5-persona-role {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-persona-name {
  font-size: 1.25rem; font-weight: 500; letter-spacing: -0.012em;
  color: var(--ink);
}
.mk5-persona-desc {
  font-size: .8125rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-persona-want {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.04em;
  color: var(--accent-c);
  padding-top: .75rem;
  border-top: 1px solid var(--rule);
}

/* COMPARISON */
.mk5-comp {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-comp-header {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 4rem; margin-bottom: 3rem;
}
.mk5-comp-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em;
}
.mk5-comp-header p {
  font-size: 1rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-cg {
  display: grid; grid-template-columns: 1.7fr 1fr 1fr 1fr 1fr;
  border: 1px solid var(--rule);
  background: var(--paper);
}
.mk5-ch {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.18em; text-transform: uppercase;
  padding: 1rem; color: var(--ink-2);
  border-bottom: 1px solid var(--rule);
  border-right: 1px solid var(--rule);
  background: var(--field-2);
}
.mk5-ch:last-child { border-right: 0; }
.mk5-ch.rl { text-align: left; }
.mk5-ch.ath { color: var(--accent-c); }
.mk5-cc {
  font-size: .8125rem;
  padding: .9rem 1rem;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  border-right: 1px solid var(--rule);
  background: var(--paper);
  display: flex; align-items: center;
}
.mk5-cc:last-child { border-right: 0; }
.mk5-cc.rl { font-weight: 500; color: var(--ink); }
.mk5-cc.cy { color: var(--ink-2); font-family: 'Space Mono', monospace; font-size: .875rem; }
.mk5-cc.cp { color: var(--bronze); font-family: 'Space Mono', monospace; font-size: .75rem; }
.mk5-cc.cn { color: var(--ink-3); font-family: 'Space Mono', monospace; font-size: .875rem; }
.mk5-cc.ca { color: var(--accent-c); font-family: 'Space Mono', monospace; font-size: .875rem; font-weight: 500; background: var(--accent-tint); }

/* PROOF LEDGER (new — evidenced shared-savings rows) */
.mk5-proof {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-proof-header {
  display: grid; grid-template-columns: 1fr 2fr;
  gap: 4rem; margin-bottom: 2.5rem;
}
.mk5-proof-header .left {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-proof-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em; margin-bottom: 1.25rem;
}
.mk5-proof-header p {
  font-size: 1rem; line-height: 1.55; color: var(--ink-2); max-width: 42rem;
}
.mk5-pl {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1.2fr .9fr .7fr;
  border: 1px solid var(--rule);
  background: var(--paper);
}
.mk5-plh {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.18em; text-transform: uppercase;
  padding: 1rem; color: var(--ink-2);
  border-bottom: 1px solid var(--rule);
  border-right: 1px solid var(--rule);
  background: var(--field-2);
}
.mk5-plh:last-child { border-right: 0; }
.mk5-plc {
  font-size: .8125rem; line-height: 1.5;
  padding: 1rem; color: var(--ink);
  border-bottom: 1px solid var(--rule);
  border-right: 1px solid var(--rule);
  display: flex; flex-direction: column; gap: .25rem;
}
.mk5-plc:last-child { border-right: 0; }
.mk5-plc .title { font-weight: 500; color: var(--ink); }
.mk5-plc .sub {
  font-family: 'Space Mono', monospace; font-size: .6875rem;
  letter-spacing: 0.04em; color: var(--ink-3);
}
.mk5-plc .amount {
  font-family: 'Space Mono', monospace; font-feature-settings: "tnum";
  font-weight: 500; color: var(--accent-c); font-size: .9375rem;
}
.mk5-plc.muted { color: var(--ink-2); }

/* INTEGRATIONS */
.mk5-int {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-int-header {
  margin-bottom: 3rem;
}
.mk5-int-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em;
}
.mk5-int-grid {
  display: grid; grid-template-columns: repeat(5, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
}
.mk5-int-item {
  padding: 1.75rem 1.25rem;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
  display: flex; flex-direction: column; gap: .5rem;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-int-item:hover { background: var(--paper-hover); }
.mk5-int-icon {
  font-family: 'Space Mono', monospace;
  font-size: 1.25rem; color: var(--accent-c);
  line-height: 1;
}
.mk5-int-name {
  font-size: .9375rem; font-weight: 500; color: var(--ink);
  letter-spacing: -0.005em;
}
.mk5-int-type {
  font-family: 'Space Mono', monospace;
  font-size: .625rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-3);
}

/* COVERAGE (INDUSTRIES) */
.mk5-ind {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-ind-header {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 4rem; margin-bottom: 3rem;
}
.mk5-ind-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em;
}
.mk5-ind-header p {
  font-size: 1rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-ind-featured {
  display: grid; grid-template-columns: 1.6fr 1fr;
  gap: 0;
  border: 1px solid var(--rule);
  background: var(--paper);
  margin-bottom: 3rem;
}
.mk5-ind-featured-main {
  padding: 2.5rem;
  border-right: 1px solid var(--rule);
}
.mk5-ind-featured-badge {
  display: inline-block;
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.16em; text-transform: uppercase;
  padding: .35rem .75rem;
  border: 1px solid var(--accent-c);
  color: var(--accent-c);
  background: var(--accent-tint);
  border-radius: 2px;
  margin-bottom: 1.25rem;
}
.mk5-ind-featured-title {
  font-size: clamp(1.75rem, 3vw, 2.5rem);
  line-height: 1.08; letter-spacing: -0.02em;
  font-weight: 500; margin-bottom: 1rem;
}
.mk5-ind-featured-desc {
  font-size: .9375rem; line-height: 1.6;
  color: var(--ink-2); margin-bottom: 1.5rem;
  max-width: 38rem;
}
.mk5-ind-featured-caps {
  display: flex; flex-wrap: wrap; gap: .5rem;
}
.mk5-ind-featured-cap {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.08em;
  padding: .35rem .75rem;
  border: 1px solid var(--rule);
  color: var(--ink-2);
  background: var(--field);
  border-radius: 2px;
}
.mk5-ind-featured-stats {
  padding: 2.5rem;
  display: flex; flex-direction: column; gap: 1.75rem;
  background: var(--field-2);
}
.mk5-ind-stat-row {
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-ind-stat-row:last-child { border-bottom: 0; padding-bottom: 0; }
.mk5-ind-stat-num {
  font-family: 'Space Mono', monospace; font-feature-settings: "tnum";
  font-size: 2.5rem; font-weight: 500; letter-spacing: -0.02em;
  color: var(--accent-c); margin-bottom: .25rem;
}
.mk5-ind-stat-label {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-2); line-height: 1.5;
}

.mk5-ind-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
}
.mk5-ind-card {
  padding: 2rem 1.75rem;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
  display: flex; flex-direction: column; gap: .85rem;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-ind-card:hover { background: var(--paper-hover); }
.mk5-ind-card-icon {
  font-family: 'Space Mono', monospace;
  font-size: 1.25rem; color: var(--accent-c); line-height: 1;
}
.mk5-ind-card-name {
  font-size: 1.125rem; font-weight: 500; letter-spacing: -0.01em;
  color: var(--ink);
}
.mk5-ind-card-desc {
  font-size: .875rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-ind-card-cats {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.04em;
  color: var(--ink-3);
  padding-top: .75rem;
  border-top: 1px solid var(--rule);
}

/* FEATURES DEEP-DIVE */
.mk5-feat {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-feat-header { margin-bottom: 3rem; max-width: 56rem; }
.mk5-feat-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em; margin-bottom: 1rem;
}
.mk5-feat-header p {
  font-size: 1rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-feat-grid {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
}
.mk5-feat-item {
  padding: 2.25rem 2rem;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
}
.mk5-feat-item-label {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--accent-c); margin-bottom: .75rem;
}
.mk5-feat-item-title {
  font-size: 1.25rem; font-weight: 500; letter-spacing: -0.012em;
  color: var(--ink); margin-bottom: .85rem; line-height: 1.25;
}
.mk5-feat-item-desc {
  font-size: .875rem; line-height: 1.6; color: var(--ink-2);
  margin-bottom: 1.25rem;
}
.mk5-feat-item-bullets {
  list-style: none; padding: 0; margin: 0;
  border-top: 1px solid var(--rule);
}
.mk5-feat-item-bullets li {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; letter-spacing: 0.02em;
  color: var(--ink-2);
  padding: .55rem 0;
  border-bottom: 1px solid var(--rule);
  padding-left: 1rem; position: relative;
}
.mk5-feat-item-bullets li::before {
  content: ""; position: absolute; left: 0; top: 50%;
  width: 6px; height: 1px; background: var(--accent-c);
}
.mk5-feat-item-bullets li:last-child { border-bottom: 0; }

/* ETHOS */
.mk5-ethos-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
}
.mk5-ethos-card {
  padding: 2.5rem 2rem;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
  position: relative;
}
.mk5-ethos-num {
  font-family: 'Space Mono', monospace; font-feature-settings: "tnum";
  font-size: 1rem; letter-spacing: 0.06em;
  color: var(--ink-3); margin-bottom: 1.5rem;
}
.mk5-ethos-title {
  font-size: 1.5rem; font-weight: 500; letter-spacing: -0.015em;
  color: var(--ink); margin-bottom: .85rem;
}
.mk5-ethos-desc {
  font-size: .9375rem; line-height: 1.6; color: var(--ink-2);
}
.mk5-ethos-accent {
  position: absolute; top: 0; left: 0;
  width: 32px; height: 1px;
  background: var(--accent-c);
}

/* CTA */
.mk5-cta {
  padding: 7rem 3rem 9rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-cta-content {
  max-width: 56rem; margin: 0 auto; text-align: center;
}
.mk5-cta-ey {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-2); margin-bottom: 2rem;
  display: inline-flex; align-items: center; gap: .75rem;
}
.mk5-cta-ey::before, .mk5-cta-ey::after {
  content: ""; display: inline-block; width: 24px; height: 1px; background: var(--ink-2);
}
.mk5-cta h2 {
  font-size: clamp(2.5rem, 6vw, 5rem);
  line-height: 0.98; letter-spacing: -0.03em;
  font-weight: 500; margin-bottom: 1.5rem;
}
.mk5-cta h2 i { color: var(--accent-c); font-style: italic; }
.mk5-cta-sub {
  font-size: 1.0625rem; line-height: 1.55;
  color: var(--ink-2);
  max-width: 38rem; margin: 0 auto 2.5rem;
}
.mk5-cta-actions {
  display: flex; gap: 1rem; justify-content: center;
  margin-bottom: 4rem; flex-wrap: wrap;
}

/* CONTACT FORM */
.mk5-contact {
  max-width: 36rem; margin: 0 auto; text-align: left;
  display: flex; flex-direction: column; gap: 1rem;
  border-top: 1px solid var(--rule);
  padding-top: 2.5rem;
}
.mk5-contact-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
}
.mk5-contact-field { display: flex; flex-direction: column; gap: .35rem; }
.mk5-contact-field span {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-contact-field input,
.mk5-contact-field textarea {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: .9375rem; color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: .75rem .85rem;
  resize: vertical;
  transition: border-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-contact-field input:focus,
.mk5-contact-field textarea:focus {
  outline: none; border-color: var(--accent-c);
}
.mk5-contact-error {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; color: var(--neg-c);
  padding: .75rem; border: 1px solid var(--neg-c);
  background: var(--bad-soft);
  border-radius: 2px;
}
.mk5-contact-success {
  max-width: 36rem; margin: 0 auto;
  padding: 2rem;
  border: 1px solid var(--accent-c);
  background: var(--accent-tint);
  text-align: left;
  border-radius: 2px;
}
.mk5-contact-success-title {
  font-size: 1.25rem; font-weight: 500; color: var(--accent-c);
  margin-bottom: .5rem;
}
.mk5-contact-success p {
  font-size: .9375rem; line-height: 1.55; color: var(--ink-2);
}

/* FOOTER */
.mk5-footer {
  padding: 3rem; max-width: 80rem; margin: 0 auto;
  display: grid; grid-template-columns: 1fr 2fr 1fr;
  gap: 2rem; align-items: end;
}
.mk5-fl {
  font-family: 'IBM Plex Sans', sans-serif;
  font-weight: 600; font-size: 1rem; color: var(--ink);
  letter-spacing: -0.005em;
}
.mk5-fc {
  font-family: 'Space Mono', monospace;
  font-size: .75rem; letter-spacing: 0.06em;
  color: var(--ink-2); line-height: 1.6;
}
.mk5-fc a { color: var(--ink-2); display: inline-block; padding: .35rem 0; } /* ≥24px hit area */
.mk5-fc a:hover { color: var(--ink); }
.mk5-fr {
  font-family: 'Space Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-3); text-align: right;
}

/* ANIMATIONS — restrained */
.mk5-reveal { opacity: 0; transform: translateY(18px) scale(.985); transition: opacity 600ms cubic-bezier(0.23, 1, 0.32, 1), transform 600ms cubic-bezier(0.22, 1.15, 0.36, 1); }
.mk5-reveal.visible { opacity: 1; transform: translateY(0); }
@media (prefers-reduced-motion: reduce) { .mk5-reveal { opacity: 1; transform: none; transition: none; } }
.mk5-rd1 { transition-delay: 80ms; }
.mk5-rd2 { transition-delay: 160ms; }
.mk5-rd3 { transition-delay: 240ms; }

/* RESPONSIVE */
@media(max-width: 1100px) {
  .mk5-hero { gap: 2.5rem; padding: 4rem 2rem 3rem; min-height: 0; }
  .mk5-hero-scroll { display: none; }
  .mk5-vchain { padding: 3.5rem 2rem; }
  /* flatten the 3D card on narrow screens — tilt clips and reads noisy on touch */
  .mk5-river-stage { perspective: none; animation: none; }
  .mk5-river-3d { transform: none !important; }
  .mk5-river-head, .mk5-river-3d .rx { transform: none; }
  .mk5-chain-row { flex-direction: column; }
  .mk5-chain-link { align-self: flex-start; padding: .35rem 0 .35rem 1.1rem; }
  .mk5-chain-link svg { transform: rotate(90deg); }
  /* Stacked cards: drips would hit the next card — drop them, tighten the rail */
  .mk5-chain-stage::after { display: none; }
  .mk5-recover-rail { margin-top: 1rem; }
  .mk5-ss { grid-template-columns: 1fr; gap: 1rem; padding: 2rem; }
  .mk5-ss-figure { padding-left: 0; border-left: 0; border-top: 1px solid var(--rule); padding-top: 1rem; }
  .mk5-evo { grid-template-columns: 1fr; }
  .mk5-evo-item { border-right: 0; border-bottom: 1px solid var(--rule); }
  .mk5-layers-intro { grid-template-columns: 1fr; gap: 1.5rem; }
  .mk5-layer-block { grid-template-columns: 1fr; gap: 1.25rem; padding: 2.5rem 0; }
  .mk5-layer-num { font-size: 1.75rem; }
  .mk5-stats { grid-template-columns: 1fr 1fr; }
  .mk5-stat-item:nth-child(2n) { border-right: 0; }
  .mk5-personas-header { grid-template-columns: 1fr; gap: 1.5rem; }
  .mk5-personas-grid { grid-template-columns: 1fr 1fr; }
  .mk5-persona:nth-child(2n) { border-right: 0; }
  .mk5-comp-header { grid-template-columns: 1fr; gap: 1.5rem; }
  .mk5-cg { grid-template-columns: 1.4fr 1fr 1fr 1fr 1fr; min-width: 720px; }
  .mk5-comp { overflow-x: auto; }
  .mk5-proof-header { grid-template-columns: 1fr; gap: 1.5rem; }
  .mk5-pl { min-width: 720px; }
  .mk5-proof { overflow-x: auto; }
  .mk5-int-grid { grid-template-columns: repeat(3, 1fr); }
  .mk5-ind-header { grid-template-columns: 1fr; gap: 1.5rem; }
  .mk5-ind-featured { grid-template-columns: 1fr; }
  .mk5-ind-featured-main { border-right: 0; border-bottom: 1px solid var(--rule); }
  .mk5-ind-grid { grid-template-columns: repeat(2, 1fr); }
  .mk5-ind-card:nth-child(2n) { border-right: 0; }
  .mk5-feat-grid { grid-template-columns: 1fr; }
  .mk5-feat-item { border-right: 0; }
  .mk5-ethos-grid { grid-template-columns: 1fr; }
  .mk5-ethos-card { border-right: 0; }
}
@media(max-width: 768px) {
  .mk5-nav { padding: 1rem 1.25rem; }
  .mk5-hero { padding-left: 1.25rem; padding-right: 1.25rem; }
  .mk5-nav-links { display: none; }
  .mk5-hamburger { display: flex; flex-direction: column; justify-content: center; }
  .mk5-ss, .mk5-manifesto, .mk5-layers, .mk5-comp, .mk5-int, .mk5-ind, .mk5-feat, .mk5-ethos, .mk5-personas, .mk5-proof { padding-left: 1.25rem; padding-right: 1.25rem; }
  .mk5-personas-grid { grid-template-columns: 1fr; }
  .mk5-persona { border-right: 0; }
  .mk5-int-grid { grid-template-columns: repeat(2, 1fr); }
  .mk5-int-item:nth-child(2n) { border-right: 0; }
  .mk5-ind-grid { grid-template-columns: 1fr; }
  .mk5-ind-card { border-right: 0; }
  .mk5-stats { grid-template-columns: 1fr; }
  .mk5-stat-item { border-right: 0; border-bottom: 1px solid var(--rule); }
  .mk5-contact-row { grid-template-columns: 1fr; }
  .mk5-footer { grid-template-columns: 1fr; gap: 1.5rem; text-align: left; padding: 2rem 1.25rem; }
  .mk5-fr { text-align: left; }
  .mk5-big-stmt { padding: 6rem 1.25rem; }
}

/* FAQ */
.mk5-faq { padding: 7rem 3rem; border-top: 1px solid var(--rule); }
.mk5-faq-inner { max-width: 56rem; margin: 0 auto; }
.mk5-faq h2 { font-size: clamp(1.8rem, 3.5vw, 2.6rem); line-height: 1.1; margin-bottom: 2.5rem; color: var(--ink); }
.mk5-faq-item { border-bottom: 1px solid var(--rule); }
.mk5-faq-item summary { cursor: pointer; padding: 1.15rem 0; font-weight: 600; font-size: 1rem; color: var(--ink); list-style: none; display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
.mk5-faq-item summary::-webkit-details-marker { display: none; }
.mk5-faq-item summary::after { content: "+"; color: var(--accent-c); font-weight: 400; flex-shrink: 0; }
.mk5-faq-item[open] summary::after { content: "\\2013"; }
.mk5-faq-item p { color: var(--ink-2); font-size: 0.9rem; line-height: 1.65; padding: 0 0 1.3rem; max-width: 44rem; }
@media(max-width: 768px) {
  .mk5-faq { padding: 4rem 1.25rem; }
}
`;

/* ---- SVG Components ---- */

const AtheonLogo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
    <path d="M16 4L27 27H5L16 4Z" fill="none" stroke="var(--accent, #2456d6)" strokeWidth="1.5" />
    <line x1="9" y1="20" x2="23" y2="20" stroke="var(--accent, #2456d6)" strokeWidth=".8" opacity=".6" />
    <line x1="11.5" y1="14.5" x2="20.5" y2="14.5" stroke="var(--accent, #2456d6)" strokeWidth=".8" opacity=".45" />
    <circle cx="16" cy="9" r="1.5" fill="var(--accent, #2456d6)" />
  </svg>
);

const ChainArrow = () => (
  <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden>
    <line x1="0" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="1" />
    <path d="M13 2l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>
);

/* The business value chain — where the spend cycle leaks, what Atheon recovers.
   No figures here on purpose: the concept carries it, and this is a public page. */
const chainStages: { name: string; leak: string; sev: "warn" | "bad"; fix: string }[] = [
  { name: "Procure", leak: "Prices creep above contract; off-contract buying goes unnoticed.", sev: "warn", fix: "Re-rated to contract" },
  { name: "Receive", leak: "Short deliveries get billed — and paid — in full.", sev: "warn", fix: "Claimed back from supplier" },
  { name: "Invoice", leak: "Duplicate invoices and billing errors slip through matching.", sev: "bad", fix: "Blocked before payment" },
  { name: "Pay", leak: "Duplicate or erroneous payments go out; credit notes go unclaimed.", sev: "bad", fix: "Recovered & credited" },
  { name: "Tax & Recover", leak: "VAT errors and unclaimed input credits sit with the revenue authority.", sev: "warn", fix: "Input VAT reclaimed" },
];

/* ---- Scroll Reveal Hook ---- */

function useReveal(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) en.target.classList.add("visible"); }),
      { threshold: 0.1, rootMargin: "0px 0px -80px 0px" }
    );
    el.querySelectorAll(".mk5-reveal, .mk5-layer-block").forEach((child) => obs.observe(child));
    return () => obs.disconnect();
  }, [ref]);
}

/* ---- Count-up stat — animates to the real (verified) number on scroll into view ---- */

function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  useEffect(() => {
    const el = ref.current;
    if (!inView || !el) return;
    const ctrl = animate(0, to, {
      duration: 1.4,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (v) => { el.textContent = String(Math.round(v)); },
    });
    return () => ctrl.stop();
  }, [inView, to]);
  return <span ref={ref}>{to}</span>;
}

/* ---- Contact Form (wired to POST /api/contact) ---- */

function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      setStatus("error");
      setErrorMsg("Name, email and message are required.");
      return;
    }
    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Could not send message.");
      }
      setStatus("success");
      setName(""); setEmail(""); setCompany(""); setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Could not send message.");
    }
  }

  if (status === "success") {
    return (
      <div className="mk5-contact-success mk5-reveal">
        <div className="mk5-contact-success-title">Message received.</div>
        <p>Thank you. A member of the Atheon team will be in touch shortly.</p>
      </div>
    );
  }

  return (
    <form className="mk5-contact mk5-reveal" onSubmit={onSubmit} noValidate>
      <div className="mk5-contact-row">
        <label className="mk5-contact-field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            autoComplete="name" required maxLength={120} />
        </label>
        <label className="mk5-contact-field">
          <span>Work email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" required maxLength={200} />
        </label>
      </div>
      <label className="mk5-contact-field">
        <span>Company</span>
        <input type="text" value={company} onChange={(e) => setCompany(e.target.value)}
          autoComplete="organization" maxLength={160} />
      </label>
      <label className="mk5-contact-field">
        <span>How can we help?</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)}
          required maxLength={2000} rows={4} />
      </label>
      {status === "error" && errorMsg && (
        <div className="mk5-contact-error" role="alert">{errorMsg}</div>
      )}
      <button type="submit" className="mk5-btn-main" disabled={status === "sending"}>
        {status === "sending" ? "Sending..." : "Send message"}
      </button>
    </form>
  );
}

/* ============================================================
   MARKETING PAGE COMPONENT
   ============================================================ */

export function MarketingPage() {
  const mainRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [reducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useReveal(mainRef);

  // page scroll progress — springy bar pinned above the nav
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.3 });

  useEffect(() => {
    if (!document.getElementById("mk5-css")) {
      const s = document.createElement("style");
      s.id = "mk5-css";
      s.textContent = marketingCSS;
      document.head.appendChild(s);
    }
  }, []);

  // Marketing is a brand surface: always the navy river look, regardless of
  // the visitor's stored in-app theme preference. Restored on unmount so the
  // app keeps honouring their choice after login/navigation.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "dark");
    return () => {
      if (prev) root.setAttribute("data-theme", prev);
      else root.removeAttribute("data-theme");
    };
  }, []);

  const tickerItems = ["Duplicate invoices", "Price creep", "Short deliveries", "Unclaimed VAT", "Erroneous payments", "Recovered"];

  const integrations = [
    { icon: "◆", name: "SAP S/4HANA", type: "ERP" },
    { icon: "◆", name: "SAP Business One", type: "ERP" },
    { icon: "◇", name: "Dynamics 365", type: "ERP + CRM" },
    { icon: "◆", name: "Sage 300", type: "ERP" },
    { icon: "◆", name: "SYSPRO", type: "ERP" },
    { icon: "◇", name: "Odoo 18", type: "ERP" },
    { icon: "◆", name: "Oracle Fusion", type: "ERP" },
    { icon: "◆", name: "NetSuite", type: "ERP" },
    { icon: "◆", name: "QuickBooks", type: "Accounting" },
    { icon: "○", name: "SuccessFactors", type: "HCM" },
    { icon: "○", name: "Salesforce", type: "CRM" },
    { icon: "○", name: "Xero", type: "Accounting" },
    { icon: "○", name: "Workday", type: "HCM" },
    { icon: "❐", name: "REST APIs", type: "Custom" },
    { icon: "❐", name: "Webhooks", type: "Custom" },
  ];

  // The ten roles Atheon ships a live console for — each is a real persona in the
  // product (src/x/persona.ts), switchable in the demo tenant via ?as=<role>.
  const personas = [
    { role: "Oversight", name: "Board member", desc: "Independent oversight of health, recovered-to-date, and what is stuck at the gate.", want: "Health vs benchmark" },
    { role: "Executive", name: "Chief Executive", desc: "The whole business on one screen — external pressure, internal health, what the engine returned.", want: "One-screen health" },
    { role: "Executive", name: "Chief Financial Officer", desc: "Owns the shared-savings ledger — confirmed leakage, decisions awaiting sign-off, cash recovered to the P&L.", want: "Recovered to P&L" },
    { role: "Executive", name: "Chief Operating Officer", desc: "Operations end to end — where value leaks and which catalysts are running on it.", want: "Run health, by domain" },
    { role: "Executive", name: "Chief Procurement Officer", desc: "Supplier-side leakage first — procurement and supply-chain findings, recovered from your suppliers.", want: "Recovered from suppliers" },
    { role: "Finance", name: "Financial Controller", desc: "Every entry reconciled — findings by category, evidence per action, a receipt for every recovery.", want: "Receipt per recovery" },
    { role: "Finance", name: "Finance Manager", desc: "The approval queue, with evidence attached. Approve the fix or send it back.", want: "Decisions, with evidence" },
    { role: "Finance", name: "Accounts Payable", desc: "Duplicate and mispriced supplier payments caught before — and after — they leave.", want: "Duplicates caught" },
    { role: "Compliance", name: "Tax & Compliance", desc: "Compliance findings, regulatory deadlines, and VAT recovery runs.", want: "VAT recovered, on time" },
    { role: "Operations", name: "Operations Manager", desc: "Service and supply findings, and the catalysts working through them day to day.", want: "Day-to-day running" },
  ];

  const proofRows = [
    { area: "Standard cost variance", source: "SAP S/4HANA · CKMLCR / ACDOCA", field: "vprs_cogm × menge", amount: "R1,820,400", confidence: "High" },
    { area: "Duplicate remittances", source: "Oracle Fusion AP · ap_invoices_all", field: "invoice_num + supplier + amount", amount: "R412,180", confidence: "High" },
    { area: "Trade promotion leakage", source: "NetSuite + Salesforce", field: "promo_lift vs baseline_units", amount: "R268,540", confidence: "Medium" },
    { area: "Payroll overtime drift", source: "Workday · hours / rate / cost_center", field: "ot_hours × burdened_rate", amount: "R134,260", confidence: "Medium" },
  ];

  return (
    <MotionConfig reducedMotion="user">
    <div ref={mainRef} className="rx mk5-body">
      <motion.div className="mk5-progress" style={{ scaleX: progress }} aria-hidden />

      {/* NAV */}
      <nav className="mk5-nav">
        <a href="/" className="mk5-nav-logo" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <AtheonLogo size={26} />
          Atheon
        </a>
        <div className="mk5-nav-links">
          <a href="#how">How it works</a>
          <a href="#valuechain">Where it leaks</a>
          <a href="#product">Product</a>
          <a href="#pricing">Pricing</a>
          <a href="#security">Security</a>
          <a href="#faq">FAQ</a>
          <a href="/login" className="mk5-nav-cta quiet" style={{ marginRight: '0.25rem' }}>
            <span>Login</span>
          </a>
          <a href="#cta-s" className="mk5-nav-cta primary" onClick={(e) => { e.preventDefault(); document.getElementById("cta-s")?.scrollIntoView({ behavior: "smooth" }); }}>
            <span>Get started</span>
          </a>
        </div>
        <button className={`mk5-hamburger ${mobileMenuOpen ? 'open' : ''}`} onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Menu">
          <span /><span /><span />
        </button>
      </nav>

      {/* MOBILE MENU */}
      <div className={`mk5-mobile-menu ${mobileMenuOpen ? 'open' : ''}`}>
        <a href="#how" onClick={() => setMobileMenuOpen(false)}>How it works</a>
        <a href="#valuechain" onClick={() => setMobileMenuOpen(false)}>Where it leaks</a>
        <a href="#product" onClick={() => setMobileMenuOpen(false)}>Product</a>
        <a href="#pricing" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
        <a href="#security" onClick={() => setMobileMenuOpen(false)}>Security</a>
        <a href="#faq" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
        <a href="/login" className="mk5-nav-cta" onClick={() => setMobileMenuOpen(false)}>
          <span>Login</span>
        </a>
        <a href="#cta-s" className="mk5-nav-cta" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false); document.getElementById("cta-s")?.scrollIntoView({ behavior: "smooth" }); }}>
          <span>Get started</span>
        </a>
      </div>

      {/* HERO — the business value chain: where money leaks, what Atheon recovers */}
      <section className="mk5-hero">
        {!reducedMotion && (
          <Suspense fallback={null}>
            <MarketingHero3D />
          </Suspense>
        )}
        <motion.div className="mk5-hero-left" initial="hide" animate="show"
          variants={{ show: { transition: { staggerChildren: 0.12 } } }}>
          <motion.div variants={heroRise} className="mk5-hero-eyebrow">Money recovery, on autopilot</motion.div>
          <motion.h1 variants={heroRise}>
            <span className="thin">Your business is</span><br />
            <span className="thin">leaking money.</span> <i>We bring it back.</i>
          </motion.h1>
          <motion.p variants={heroRise} className="mk5-hero-desc">
            Duplicate invoices. Price creep. Short deliveries. Unclaimed VAT. Atheon connects
            to the systems you already run, finds every Rand that slipped out, and gets it
            back&nbsp;&mdash; with a receipt. Nothing upfront: we only earn a share of what
            you actually recover.
          </motion.p>
          <motion.div variants={heroRise} className="mk5-hero-actions">
            <button className="mk5-btn-main" onClick={() => document.getElementById("cta-s")?.scrollIntoView({ behavior: "smooth" })}>
              Find my leaks
            </button>
            <button className="mk5-hero-textlink" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>
              See how it works &#8599;
            </button>
          </motion.div>
        </motion.div>

        {/* THE RIVER — the brand flow as the hero centrepiece, on a 3D stage */}
        <RiverHero3D />

        <div className="mk5-hero-scroll">
          <div className="mk5-scroll-line" />
          <span>Scroll</span>
        </div>
      </section>

      {/* VALUE CHAIN — where money leaks along the spend cycle, what Atheon recovers */}
      <section className="mk5-vchain" id="valuechain">
        <div className="mk5-vchain-intro">
          <div className="mk5-hero-eyebrow">02 &mdash; The Business Value Chain</div>
          <h2>Money leaks at every step. Atheon catches it and sends it back.</h2>
          <p>From purchase order to VAT return &mdash; price creep, short deliveries, duplicate
          invoices, erroneous payments, unclaimed credits. Each stage is a place value slips out.</p>
        </div>
        <div className="mk5-chain" aria-label="Business value chain: where money leaks and what Atheon recovers">
          <div className="mk5-chain-head">
            <span className="t">Procure &rarr; Receive &rarr; Invoice &rarr; Pay &rarr; Tax</span>
            <div className="mk5-chain-legend">
              <span><span className="mk5-chain-dot leak" />Where it leaks</span>
              <span><span className="mk5-chain-dot ok" />What Atheon recovers</span>
            </div>
          </div>
          <div className="mk5-chain-row">
            {chainStages.map((s, i) => (
              <span key={s.name} style={{ display: "contents" }}>
                <div className={`mk5-chain-stage sev-${s.sev}`} style={{ animationDelay: `${i * 90}ms` }}>
                  <span className="num mk5-mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className="name">{s.name}</span>
                  <p className={`mk5-chain-leak ${s.sev}`}>
                    <span className="mark">&#9662;</span>{s.leak}
                  </p>
                  <div className="mk5-chain-fix"><span>&#10003;</span>{s.fix}</div>
                </div>
                {i < chainStages.length - 1 && (
                  <div className="mk5-chain-link"><ChainArrow /></div>
                )}
              </span>
            ))}
          </div>
          <div className="mk5-recover-rail" aria-label="Atheon catches the leaks and recovers the value back to your P&L">
            <span>Leaks caught</span>
            <span className="rflow" aria-hidden />
            <span>&larr; Recovered back to your P&amp;L</span>
          </div>
        </div>
      </section>

      {/* SHARED-SAVINGS STRIP — persistent CFO ledger */}
      <div className="mk5-ss" aria-label="Shared-savings ledger">
        <div>
          <div className="mk5-ss-label">Shared-Savings Ledger</div>
          <div className="mk5-ss-meta mk5-mono">Illustrative example &middot; trailing 90 days</div>
        </div>
        <div className="mk5-ss-meta mk5-mono" style={{ alignSelf: "end" }}>
          Every claimed Rand traces to ERP record &middot; field &middot; confidence band.
        </div>
        <div className="mk5-ss-figure">
          <div className="mk5-ss-amount mk5-mono">R12.4m</div>
          <div className="mk5-ss-tag">Identified</div>
        </div>
        <div className="mk5-ss-figure">
          <div className="mk5-ss-amount mk5-mono">R8.6m</div>
          <div className="mk5-ss-tag">Approved</div>
        </div>
        <div className="mk5-ss-figure">
          <div className="mk5-ss-amount mk5-mono accent">R6.1m</div>
          <div className="mk5-ss-tag">Realised</div>
        </div>
      </div>

      {/* TICKER */}
      <div className="mk5-ticker">
        <div className="mk5-ticker-track">
          {[0, 1].map((rep) => (
            <span key={rep} style={{ display: "contents" }}>
              {tickerItems.map((t) => (
                <span key={rep + "-" + t} className="mk5-ticker-item">
                  {t}<span className="mk5-ticker-dot" />
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* PRODUCT — real screenshots of the shipped app */}
      <section className="mk5-product" id="product">
        <div className="mk5-product-intro">
          <div className="mk5-product-eyebrow mk5-mono">02 &mdash; The product</div>
          <h2 className="mk5-reveal">One screen shows you<br />where the money is.</h2>
          <p className="mk5-reveal">
            The home screen is the loop&nbsp;&mdash; sources connected, exposure detected, fixes
            awaiting approval, value recovered, reports ready. Every number links to the record
            behind it.
          </p>
        </div>
        <figure className="mk5-product-hero mk5-reveal">
          <img src="/marketing/home.png" alt="Atheon home — the connect, detect, fix, recover, report journey with live figures in Rand" loading="lazy" />
          <figcaption className="mk5-mono">Home &middot; the value loop at a glance</figcaption>
        </figure>
        <div className="mk5-product-grid">
          <figure className="mk5-reveal">
            <img src="/marketing/findings.png" alt="Findings — detected exposure, every Rand drillable to its ERP record" loading="lazy" />
            <figcaption className="mk5-mono">Findings &middot; confidence-gated exposure</figcaption>
          </figure>
          <figure className="mk5-reveal mk5-rd1">
            <img src="/marketing/fixes.png" alt="Fixes — approve the automated remediations that recover the money" loading="lazy" />
            <figcaption className="mk5-mono">Fixes &middot; approve &amp; recover</figcaption>
          </figure>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mk5-ethos" id="how">
        <div className="mk5-layers-intro">
          <div className="mk5-layers-intro-left">How it works</div>
          <div className="mk5-layers-intro-right mk5-reveal">
            <h2>Three steps between<br />you and your money.</h2>
            <p>
              No consultants, no six-month project, nothing installed on your side. A read-only
              connection, a priced list of leaks, and a fix queue you approve.
            </p>
          </div>
        </div>
      </section>
      <div className="mk5-evo">
        <div className="mk5-evo-item past mk5-reveal">
          <div className="mk5-evo-era past">Step 01</div>
          <div className="mk5-evo-name">Connect</div>
          <div className="mk5-evo-desc">
            Plug in the systems you already run with read-only credentials&nbsp;&mdash; SAP, Oracle,
            Dynamics, NetSuite, Odoo, Sage, Xero, QuickBooks and more. Your data stays where it is.
          </div>
        </div>
        <div className="mk5-evo-item present mk5-reveal mk5-rd1">
          <div className="mk5-evo-era present">Step 02</div>
          <div className="mk5-evo-name">See every leak</div>
          <div className="mk5-evo-desc">
            445+ automated checks sweep your invoices, payments, deliveries, payroll and tax.
            Every leak is priced in Rand, with the exact record behind it attached as evidence.
          </div>
        </div>
        <div className="mk5-evo-item future mk5-reveal mk5-rd2">
          <div className="mk5-evo-era future">Step 03</div>
          <div className="mk5-evo-name">Approve &amp; recover</div>
          <div className="mk5-evo-desc">
            Nothing moves without your sign-off. You approve each fix, the money comes back to
            your P&amp;L, and every recovered Rand carries a receipt you can hand to your auditor.
          </div>
        </div>
      </div>

      {/* STATS */}
      <div className="mk5-stats">
        <div className="mk5-stat-item mk5-reveal">
          <div className="mk5-stat-num mk5-mono"><CountUp to={445} /><span className="accent">+</span></div>
          <div className="mk5-stat-label">Checks running against your books</div>
        </div>
        <div className="mk5-stat-item mk5-reveal mk5-rd1">
          <div className="mk5-stat-num mk5-mono"><CountUp to={75} /><span className="accent">+</span></div>
          <div className="mk5-stat-label">Business areas covered</div>
        </div>
        <div className="mk5-stat-item mk5-reveal mk5-rd2">
          <div className="mk5-stat-num mk5-mono"><CountUp to={50} /><span className="accent">+</span></div>
          <div className="mk5-stat-label">Checks wired straight into your ERP</div>
        </div>
        <div className="mk5-stat-item mk5-reveal mk5-rd3">
          <div className="mk5-stat-num mk5-mono">R<span className="accent">0</span></div>
          <div className="mk5-stat-label">Upfront cost</div>
        </div>
      </div>

      {/* PERSONAS — auditor + board surfaced */}
      <section className="mk5-personas" id="personas">
        <div className="mk5-personas-header">
          <div className="left">Built for your team</div>
          <div className="mk5-reveal">
            <h2>One recovery. Everyone&rsquo;s view.</h2>
            <p>
              Your board sees health. Your CFO sees the ledger. Your AP team sees the duplicate
              invoice before it gets paid. Ten roles, ten live consoles&nbsp;&mdash; all working
              from the same recovered Rand, framed for the decision each person owns.
            </p>
          </div>
        </div>
        <div className="mk5-personas-grid">
          {personas.map((p, i) => (
            <div key={p.name} className={`mk5-persona mk5-reveal mk5-rd${Math.min(i, 3)}`}>
              <div className="mk5-persona-role">{p.role}</div>
              <div className="mk5-persona-name">{p.name}</div>
              <div className="mk5-persona-desc">{p.desc}</div>
              <div className="mk5-persona-want">&rarr; {p.want}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section className="mk5-ind" id="pricing">
        <div className="mk5-ind-header">
          <h2 className="mk5-reveal">No recovery,<br />no fee.</h2>
          <p className="mk5-reveal">
            No licence, no per-seat pricing, nothing upfront. We take an agreed share of what
            is verifiably recovered&nbsp;&mdash; and if we find nothing, you pay nothing and
            keep the free audit of your spend cycle.
          </p>
        </div>
        <div className="mk5-ind-featured mk5-reveal">
          <div className="mk5-ind-featured-main">
            <div className="mk5-ind-featured-badge">Shared savings</div>
            <div className="mk5-ind-featured-title">You keep the bigger share.<br />We earn on results.</div>
            <p className="mk5-ind-featured-desc">
              Every recovery lands on a shared ledger with three columns: identified, approved
              by you, and realised back to your P&amp;L. Our invoice is calculated from the
              realised column only&nbsp;&mdash; money already back in your account. Every claimed
              Rand traces to the ERP record, the field calculation, and a confidence band.
            </p>
            <div className="mk5-ind-featured-caps">
              {["R0 upfront", "No licence fees", "No per-seat pricing", "Paid on realised recoveries only", "Cancel anytime"].map((c) => (
                <span key={c} className="mk5-ind-featured-cap">{c}</span>
              ))}
            </div>
          </div>
          <div className="mk5-ind-featured-stats">
            <div className="mk5-ind-stat-row">
              <div className="mk5-ind-stat-num mk5-mono">R0</div>
              <div className="mk5-ind-stat-label">To get started&nbsp;&mdash; no setup<br />or subscription fees</div>
            </div>
            <div className="mk5-ind-stat-row">
              <div className="mk5-ind-stat-num mk5-mono">100%</div>
              <div className="mk5-ind-stat-label">Of claims traceable to an<br />ERP record and calculation</div>
            </div>
            <div className="mk5-ind-stat-row">
              <div className="mk5-ind-stat-num mk5-mono">1</div>
              <div className="mk5-ind-stat-label">Invoice, from the realised<br />column of your ledger</div>
            </div>
          </div>
        </div>
      </section>

      {/* PROOF LEDGER — evidenced shared-savings rows */}
      <section className="mk5-proof" id="proof">
        <div className="mk5-proof-header">
          <div className="left">Proof Ledger</div>
          <div className="mk5-reveal">
            <h2>Every Rand has a receipt.</h2>
            <p>
              We get paid on what you keep&nbsp;&mdash; so every line traces to the ERP record it
              came from, the field calculation that produced it, and a confidence band. No black
              boxes, no estimates dressed up as findings.
            </p>
            <p className="mk5-mono" style={{ fontSize: ".6875rem", letterSpacing: "0.1em", color: "var(--ink-3)", marginTop: ".85rem", textTransform: "uppercase" }}>
              Illustrative example &middot; figures show the shape of the trace, not a client&rsquo;s numbers.
            </p>
          </div>
        </div>
        <div className="mk5-pl mk5-reveal">
          <div className="mk5-plh">Area</div>
          <div className="mk5-plh">ERP Source</div>
          <div className="mk5-plh">Field Mapping</div>
          <div className="mk5-plh">Amount</div>
          <div className="mk5-plh">Confidence</div>
          {proofRows.map((r) => (
            <span key={r.area} style={{ display: "contents" }}>
              <div className="mk5-plc">
                <span className="title">{r.area}</span>
              </div>
              <div className="mk5-plc muted">
                <span className="sub">{r.source}</span>
              </div>
              <div className="mk5-plc muted">
                <span className="sub">{r.field}</span>
              </div>
              <div className="mk5-plc">
                <span className="amount">{r.amount}</span>
              </div>
              <div className="mk5-plc muted">
                <span className="sub">{r.confidence}</span>
              </div>
            </span>
          ))}
        </div>
      </section>

      {/* INTEGRATIONS */}
      <section className="mk5-int">
        <div className="mk5-int-header">
          <h2 className="mk5-reveal">Works with what<br />you already run.</h2>
        </div>
        <div className="mk5-int-grid mk5-reveal">
          {integrations.map((item) => (
            <div key={item.name} className="mk5-int-item">
              <div className="mk5-int-icon">{item.icon}</div>
              <div className="mk5-int-name">{item.name}</div>
              <div className="mk5-int-type">{item.type}</div>
            </div>
          ))}
        </div>
      </section>

      {/* SECURITY POSTURE */}
      <section className="mk5-feat" id="security">
        <div className="mk5-feat-header mk5-reveal">
          <h2>Your data stays yours.</h2>
          <p>
            We read your books to find your money&nbsp;&mdash; so we protect them like they&rsquo;re
            ours. Everything below ships enabled on day one, for every customer.
          </p>
        </div>
        <div className="mk5-feat-grid">
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Identity</div>
            <div className="mk5-feat-item-title">Enforced MFA and short-TTL JWTs</div>
            <p className="mk5-feat-item-desc">
              TOTP-based multi-factor authentication is enforced for admin, superadmin, and support
              roles&nbsp;&mdash; no opt-out. Session tokens are short-lived JWTs with rotation on every
              privileged action, and all login events are streamed to the immutable audit log.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>TOTP MFA (enforced for privileged roles)</li>
              <li>Short-TTL access tokens, rotated on sensitive actions</li>
              <li>Azure AD / SAML 2.0 SSO for centralised identity</li>
              <li>Per-tenant session scoping and impersonation trail</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Data Protection</div>
            <div className="mk5-feat-item-title">AES-encrypted at rest, HMAC-signed in motion</div>
            <p className="mk5-feat-item-desc">
              ERP credentials, DSAR exports, and sensitive payloads are AES-encrypted per tenant.
              Outbound webhooks are HMAC-SHA256 signed with per-subscription secrets so downstream
              systems can verify authenticity. Encryption keys are rotatable without downtime.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>AES-GCM encryption for ERP credentials at rest</li>
              <li>Encrypted DSAR / data-subject exports</li>
              <li>HMAC-SHA256 signed webhooks with rotating secrets</li>
              <li>Key rotation without downtime</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">LLM Safety</div>
            <div className="mk5-feat-item-title">Per-tenant budgets, automatic PII redaction</div>
            <p className="mk5-feat-item-desc">
              Every LLM call runs under a per-tenant spend budget with hard cut-off. Prompts are
              scanned for personal data before leaving the platform, with emails, phone numbers,
              national IDs, and credit card numbers redacted or tokenised. No prompt, no response,
              no tenant data ever crosses tenant boundaries.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>Hard per-tenant LLM spend budgets with alerting</li>
              <li>Automatic PII redaction before egress</li>
              <li>Model-agnostic provider abstraction</li>
              <li>Full prompt/response audit with tenant attribution</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Governance</div>
            <div className="mk5-feat-item-title">Immutable audit, explicit autonomy tiers</div>
            <p className="mk5-feat-item-desc">
              Every catalyst action records inputs, outputs, handler, confidence, and the human
              who reviewed it. Autonomy tiers&nbsp;&mdash; read-only, assisted, transactional&nbsp;&mdash;
              are enforced at the engine layer, not the UI. Promotion between tiers is a governed
              event with its own approval trail.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>Append-only audit log across every layer</li>
              <li>Explicit autonomy-tier enforcement in the engine</li>
              <li>Governed tier promotion with approver record</li>
              <li>Tenant-scoped data, jobs, and quota isolation</li>
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mk5-faq" id="faq">
        <div className="mk5-faq-inner">
          <h2 className="mk5-reveal">Questions, answered.</h2>
          <details className="mk5-faq-item">
            <summary>What does it cost?</summary>
            <p>
              Nothing upfront. No licence, no per-seat fees, no setup cost. We take an agreed
              share of what is verifiably recovered, and we invoice only on recoveries that have
              actually been realised back to your P&amp;L.
            </p>
          </details>
          <details className="mk5-faq-item">
            <summary>Can Atheon change anything in my ERP?</summary>
            <p>
              Not without you. Atheon starts read-only. Nothing posts, reverses, or claims
              without explicit approval from someone on your team, and every action&nbsp;&mdash;
              approved or declined&nbsp;&mdash; is written to an immutable audit log.
            </p>
          </details>
          <details className="mk5-faq-item">
            <summary>Which systems does it work with?</summary>
            <p>
              SAP S/4HANA and Business One, Oracle Fusion, Microsoft Dynamics 365, NetSuite,
              Odoo, Sage, SYSPRO, QuickBooks, Xero, Workday, and Salesforce&nbsp;&mdash; plus
              REST APIs and webhooks for anything else.
            </p>
          </details>
          <details className="mk5-faq-item">
            <summary>What if you find nothing?</summary>
            <p>
              You pay nothing. You keep a free, evidenced audit of your spend cycle&nbsp;&mdash;
              which is its own answer: your controls are working.
            </p>
          </details>
          <details className="mk5-faq-item">
            <summary>How do I know the numbers are real?</summary>
            <p>
              Every claimed Rand traces to the ERP record it came from, the field calculation
              that produced it, and a confidence band. Where a source hasn&rsquo;t reported yet
              you see a dash&nbsp;&mdash; never a number we filled in with an estimate.
            </p>
          </details>
          <details className="mk5-faq-item">
            <summary>Is my data safe?</summary>
            <p>
              Credentials are AES-encrypted per tenant, MFA is enforced on privileged roles,
              every action lands in an immutable audit log, and personal data is redacted
              before any AI call leaves the platform. No data ever crosses tenant boundaries.
            </p>
          </details>
        </div>
      </section>

      {/* CTA */}
      <section className="mk5-cta" id="cta-s">
        <div className="mk5-cta-content">
          <div className="mk5-cta-ey mk5-reveal">Get started</div>
          <h2 className="mk5-reveal">Find out what<br /><i>you&rsquo;re owed.</i></h2>
          <p className="mk5-cta-sub mk5-reveal">
            Connect your ERP and see your leaks priced in Rand. Nothing upfront&nbsp;&mdash;
            we only earn when money comes back.
          </p>
          <div className="mk5-cta-actions mk5-reveal">
            <a href="/trial" className="mk5-btn-main">Start Trial</a>
            <a href="/login" className="mk5-btn-line">Customer Login</a>
          </div>
          <ContactForm />
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mk5-footer">
        <div className="mk5-fl">Atheon</div>
        <div className="mk5-fc">
          The World&rsquo;s First Catalyst Platform&nbsp;&mdash; A Vanta X Platform
          <div style={{ marginTop: '0.5rem', fontSize: '0.85em' }}>
            <a href="/status">Status</a>
            {' · '}
            <a href="/legal/security">Security &amp; Privacy</a>
            {' · '}
            <a href="/legal/connectors">Connectors</a>
            {' · '}
            <a href="/legal/performance">Performance</a>
            {' · '}
            <a href="/login">Sign in</a>
          </div>
        </div>
        <div className="mk5-fr">&copy; 2026 Atheon. All rights reserved.</div>
      </footer>
    </div>
    </MotionConfig>
  );
}
