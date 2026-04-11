/**
 * SPEC-006: Atheon Design System — Single source of truth for tokens
 * Typography, spacing, color, card variants, and motion tokens.
 */

// ─── Typography ─────────────────────────────────────────────
export const TYPOGRAPHY = {
  fontFamily: {
    display: '"Instrument Serif", serif',
    body: '"Outfit", sans-serif',
    mono: '"JetBrains Mono", monospace',
  },
  fontSize: {
    'xs': '0.75rem',    // 12px
    'sm': '0.8125rem',  // 13px
    'base': '0.875rem', // 14px
    'md': '1rem',       // 16px
    'lg': '1.125rem',   // 18px
    'xl': '1.25rem',    // 20px
    '2xl': '1.5rem',    // 24px
    '3xl': '1.875rem',  // 30px
    '4xl': '2.25rem',   // 36px
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

// ─── Spacing Scale ──────────────────────────────────────────
export const SPACING = {
  '0': '0',
  '0.5': '0.125rem',  // 2px
  '1': '0.25rem',     // 4px
  '1.5': '0.375rem',  // 6px
  '2': '0.5rem',      // 8px
  '3': '0.75rem',     // 12px
  '4': '1rem',        // 16px
  '5': '1.25rem',     // 20px
  '6': '1.5rem',      // 24px
  '8': '2rem',        // 32px
  '10': '2.5rem',     // 40px
  '12': '3rem',       // 48px
  '16': '4rem',       // 64px
  '20': '5rem',       // 80px
  '24': '6rem',       // 96px
} as const;

// ─── Color Palette ──────────────────────────────────────────
export const COLORS = {
  sage: {
    50: '#f0f5f2',
    100: '#dce8e0',
    200: '#b8d1be',
    300: '#8fb89d',
    400: '#6a9f7c',
    500: '#4A6B5A', // primary brand
    600: '#3d5a4b',
    700: '#30483c',
    800: '#24362d',
    900: '#18241e',
  },
  bronze: {
    50: '#faf5ef',
    100: '#f3e8d6',
    200: '#e8d1ad',
    300: '#dbb884',
    400: '#c9a059', // accent gold
    500: '#b8893c',
    600: '#9a7232',
    700: '#7c5c28',
    800: '#5e461e',
    900: '#403014',
  },
  sky: {
    50: '#f0f7fa',
    100: '#d9edf5',
    200: '#b3dbed',
    300: '#7AACB5', // secondary blue
    400: '#5a98a5',
    500: '#3e8495',
    600: '#326d7c',
    700: '#275763',
    800: '#1c404a',
    900: '#122a31',
  },
  neutral: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },
} as const;

// ─── Card Variants ──────────────────────────────────────────
export const CARD_VARIANTS = {
  default: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-card)',
    borderRadius: 'var(--radius)',
    padding: SPACING['6'],
  },
  glass: {
    background: 'rgba(var(--bg-card-rgb, 255, 255, 255), 0.6)',
    backdropFilter: 'blur(12px)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius)',
    padding: SPACING['6'],
  },
  elevated: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
    padding: SPACING['6'],
  },
  metric: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-card)',
    borderRadius: 'var(--radius)',
    padding: SPACING['5'],
    minHeight: '120px',
  },
  interactive: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-card)',
    borderRadius: 'var(--radius)',
    padding: SPACING['6'],
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
} as const;

// ─── Motion / Animation ─────────────────────────────────────
export const MOTION = {
  duration: {
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
    xslow: '500ms',
  },
  easing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;

// ─── Breakpoints ────────────────────────────────────────────
export const BREAKPOINTS = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// ─── Z-Index Scale ──────────────────────────────────────────
export const Z_INDEX = {
  dropdown: 50,
  sticky: 100,
  fixed: 200,
  modalBackdrop: 300,
  modal: 400,
  popover: 500,
  tooltip: 600,
  toast: 700,
  max: 9999,
} as const;

// ─── Border Radius ──────────────────────────────────────────
export const RADIUS = {
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  full: '9999px',
} as const;

// ─── Shadows ────────────────────────────────────────────────
export const SHADOWS = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
  glow: '0 0 20px rgba(var(--accent-rgb), 0.15)',
} as const;
