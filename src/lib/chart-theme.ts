/**
 * SPEC-006: Atheon Chart Theme — Single source of truth for Recharts styling
 * All chart components should use these values for consistent visualization.
 */

export const CHART_COLORS = {
  light: {
    primary: '#4A6B5A',
    secondary: '#7AACB5',
    tertiary: '#c9a059',
    quaternary: '#6366f1',
    quinary: '#f43f5e',
    senary: '#8b5cf6',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#3b82f6',
    series: ['#4A6B5A', '#7AACB5', '#c9a059', '#6366f1', '#f43f5e', '#8b5cf6', '#14b8a6', '#f97316'],
  },
  dark: {
    primary: '#5d8a6f',
    secondary: '#7AACB5',
    tertiary: '#c9a059',
    quaternary: '#818cf8',
    quinary: '#fb7185',
    senary: '#a78bfa',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f87171',
    info: '#60a5fa',
    series: ['#5d8a6f', '#7AACB5', '#c9a059', '#818cf8', '#fb7185', '#a78bfa', '#2dd4bf', '#fb923c'],
  },
};

export const CHART_AXIS = {
  light: {
    stroke: '#94a3b8',
    fontSize: 12,
    fontFamily: 'Outfit, sans-serif',
    tickLine: false,
    axisLine: { stroke: '#e2e8f0' },
  },
  dark: {
    stroke: '#586573',
    fontSize: 12,
    fontFamily: 'Outfit, sans-serif',
    tickLine: false,
    axisLine: { stroke: 'rgba(74, 107, 90, 0.2)' },
  },
};

export const CHART_GRID = {
  light: {
    strokeDasharray: '3 3',
    stroke: '#e2e8f0',
    opacity: 0.6,
  },
  dark: {
    strokeDasharray: '3 3',
    stroke: 'rgba(74, 107, 90, 0.15)',
    opacity: 0.6,
  },
};

export const CHART_TOOLTIP = {
  light: {
    contentStyle: {
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
      fontSize: '13px',
      fontFamily: 'Outfit, sans-serif',
      padding: '8px 12px',
    },
    labelStyle: { color: '#1a1f36', fontWeight: 600, marginBottom: '4px' },
    itemStyle: { color: '#4a5578', fontSize: '12px' },
  },
  dark: {
    contentStyle: {
      background: 'rgba(14, 21, 28, 0.95)',
      border: '1px solid rgba(74, 107, 90, 0.2)',
      borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      fontSize: '13px',
      fontFamily: 'Outfit, sans-serif',
      padding: '8px 12px',
    },
    labelStyle: { color: '#e8e4dc', fontWeight: 600, marginBottom: '4px' },
    itemStyle: { color: '#c4bfb4', fontSize: '12px' },
  },
};

export const CHART_ANIMATION = {
  duration: 800,
  easing: 'ease-out' as const,
};

export const CHART_LEGEND = {
  wrapperStyle: {
    fontSize: '12px',
    fontFamily: 'Outfit, sans-serif',
    paddingTop: '8px',
  },
  iconSize: 10,
  iconType: 'circle' as const,
};

/** Format large numbers with abbreviations (1.2M, 340K) */
export function formatChartNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toFixed(0);
}

/** Get theme-aware chart config based on current mode */
export function getChartTheme(isDark: boolean) {
  const mode = isDark ? 'dark' : 'light';
  return {
    colors: CHART_COLORS[mode],
    axis: CHART_AXIS[mode],
    grid: CHART_GRID[mode],
    tooltip: CHART_TOOLTIP[mode],
    animation: CHART_ANIMATION,
    legend: CHART_LEGEND,
  };
}
