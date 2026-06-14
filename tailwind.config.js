/** @type {import('tailwindcss').Config} */
// Design tokens — Luminous Editorial. Source of truth is CSS variables in
// src/index.css. Never inline a hex that has a CSS-var equivalent. Blue accent
// is brand/active ONLY; RAG (rag-healthy/watch/risk) is status & health ONLY.
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      borderRadius: {
        DEFAULT: '4px',
        sm: '4px',
        md: '6px',
        lg: 'var(--radius)',
        xl: '14px',
        full: '9999px',
      },
      colors: {
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',

        // ── Luminous surfaces / rules (CSS-var references) ─────
        paper:           'var(--bg-primary)',
        ink:             'var(--text-primary)',
        line:            'var(--border-card)',
        'line-strong':   'var(--line-strong)',

        // ── Foreground ─────────────────────────────────────────
        'text-primary':    'var(--text-primary)',
        'text-secondary':  'var(--text-secondary)',
        'text-muted':      'var(--text-muted)',

        // ── Border ─────────────────────────────────────────────
        'border-card':     'var(--border-card)',

        // ── Reserved negative (= RAG risk) ─────────────────────
        neg: 'rgb(var(--neg-rgb) / <alpha-value>)',

        // ── Restrained chart/data neutrals ─────────────────────
        info:   'var(--info)',
        bronze: 'var(--bronze)',

        // ── RAG status semantics (status & health ONLY) ────────
        'rag-healthy': 'rgb(var(--rag-healthy-rgb) / <alpha-value>)',
        'rag-watch':   'rgb(var(--rag-watch-rgb) / <alpha-value>)',
        'rag-risk':    'rgb(var(--rag-risk-rgb) / <alpha-value>)',

        // ── Semantic — status only (success === RAG healthy) ───
        success: 'rgb(var(--rag-healthy-rgb) / <alpha-value>)',
        warning: 'rgb(var(--rag-watch-rgb) / <alpha-value>)',
        danger:  'rgb(var(--rag-risk-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans:        ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        body:        ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display:     ['Inter', 'system-ui', 'sans-serif'],
        headline:    ['Inter', 'system-ui', 'sans-serif'],
        mono:        ['Space Mono', 'ui-monospace', 'monospace'],
        'mono-data': ['Space Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Swiss grotesk scale — heavy display, restrained body.
        'hero':        ['72px', { lineHeight: '0.92', letterSpacing: '-0.03em', fontWeight: '900' }],
        'display':     ['40px', { lineHeight: '1.0',  letterSpacing: '-0.02em', fontWeight: '900' }],
        'figure-lg':   ['46px', { lineHeight: '1.0',  letterSpacing: '-0.02em', fontWeight: '800' }],
        'figure':      ['34px', { lineHeight: '1.0',  letterSpacing: '-0.02em', fontWeight: '800' }],
        'headline-xl': ['25px', { lineHeight: '1.12', letterSpacing: '-0.015em', fontWeight: '700' }],
        'headline-lg': ['20px', { lineHeight: '1.3',  letterSpacing: '-0.01em', fontWeight: '700' }],
        'headline-md': ['18px', { lineHeight: '1.4',  fontWeight: '600' }],
        'body-base':   ['13.5px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-sm':     ['12px', { lineHeight: '1.5',  fontWeight: '400' }],
        'mono-data':   ['13px', { lineHeight: '1.4',  fontWeight: '500' }],
        'eyebrow':     ['9.5px', { lineHeight: '1',   letterSpacing: '0.2em', fontWeight: '600' }],
        'caption':     ['11px', { lineHeight: '1',    letterSpacing: '0.05em', fontWeight: '500' }],
      },
      spacing: {
        unit:               '4px',
        xs:                 '4px',
        sm:                 '8px',
        md:                 '16px',
        lg:                 '24px',
        xl:                 '32px',
        gutter:             '24px',
        'margin-page':      '32px',
        'header-height':    '48px',
        'sidebar-collapsed':'56px',
        'sidebar-expanded': '240px',
      },
    }
  },
  plugins: [import("tailwindcss-animate")],
}
