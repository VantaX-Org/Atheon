/**
 * SPEC-023: Chart & Data Visualization Consistency
 * Unified chart configuration, color palettes, and formatting utilities.
 * Ensures all Recharts visualizations share consistent styling.
 */

/** Unified color palette for charts */
export const CHART_COLORS = {
  primary: ['#4A6B5A', '#6B9B7D', '#8FB39D', '#B8CFC0', '#D9E4DC'],
  accent: ['#C4956A', '#D4A574', '#E0BB91', '#ECD3B5', '#F5E8D8'],
  status: {
    healthy: '#10B981',
    warning: '#F59E0B',
    critical: '#EF4444',
    info: '#3B82F6',
    neutral: '#6B7280',
  },
  categorical: [
    '#4A6B5A', '#C4956A', '#5BA3CF', '#9B59B6', '#F39C12',
    '#1ABC9C', '#E74C3C', '#3498DB', '#2ECC71', '#E67E22',
  ],
  sequential: {
    sage: ['#F0F4F1', '#D9E4DC', '#B8CFC0', '#8FB39D', '#6B9B7D', '#4A6B5A', '#3D5A4B', '#2F4739'],
    bronze: ['#F5E8D8', '#ECD3B5', '#E0BB91', '#D4A574', '#C4956A', '#A67B52', '#8B6543', '#704F35'],
    sky: ['#DBEAFE', '#BFDBFE', '#93C5FD', '#60A5FA', '#3B82F6', '#2563EB', '#1D4ED8', '#1E40AF'],
  },
  diverging: ['#EF4444', '#F87171', '#FCA5A5', '#FEE2E2', '#F0F4F1', '#D9E4DC', '#6B9B7D', '#4A6B5A'],
};

/** Default Recharts theme configuration */
export const RECHARTS_THEME = {
  /** Default chart margins */
  margin: { top: 5, right: 20, bottom: 5, left: 0 },

  /** Axis styling */
  axis: {
    stroke: 'var(--text-muted, #6B7280)',
    fontSize: 11,
    fontFamily: 'Outfit, system-ui, sans-serif',
    tickLine: false,
    axisLine: { stroke: 'var(--border-card, #E5E7EB)' },
  },

  /** Grid styling */
  grid: {
    strokeDasharray: '3 3',
    stroke: 'var(--border-divider, rgba(255,255,255,0.06))',
    vertical: false,
  },

  /** Tooltip styling */
  tooltip: {
    contentStyle: {
      background: 'var(--bg-tooltip, #1F2937)',
      border: 'none',
      borderRadius: '8px',
      padding: '8px 12px',
      fontSize: '12px',
      fontFamily: 'Outfit, system-ui, sans-serif',
      color: 'var(--text-inverse, #FFF)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    },
    cursor: { fill: 'var(--bg-hover, rgba(255,255,255,0.05))' },
    itemStyle: { color: 'var(--text-inverse, #FFF)', fontSize: '11px' },
    labelStyle: { color: 'var(--text-inverse, #FFF)', fontSize: '12px', fontWeight: 600 },
  },

  /** Legend styling */
  legend: {
    iconSize: 8,
    iconType: 'circle' as const,
    wrapperStyle: {
      fontSize: '11px',
      fontFamily: 'Outfit, system-ui, sans-serif',
      color: 'var(--text-muted, #6B7280)',
    },
  },

  /** Animation defaults */
  animation: {
    duration: 800,
    easing: 'ease-out',
  },
};

/** Format numbers for chart labels */
export function formatChartValue(value: number, type: 'number' | 'currency' | 'percent' | 'compact' = 'number'): string {
  switch (type) {
    case 'currency':
      if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
      if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
      return `$${value.toFixed(0)}`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'compact':
      if (value >= 1000000000) return `${(value / 1000000000).toFixed(1)}B`;
      if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
      if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
      return value.toFixed(0);
    default:
      return value.toLocaleString();
  }
}

/** Format dates for chart axes */
export function formatChartDate(dateStr: string, format: 'short' | 'medium' | 'long' = 'short'): string {
  const date = new Date(dateStr);
  switch (format) {
    case 'short':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'medium':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    case 'long':
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
}

/** Get color for a value based on thresholds */
export function getThresholdColor(value: number, thresholds: { warning: number; critical: number }): string {
  if (value >= thresholds.warning) return CHART_COLORS.status.healthy;
  if (value >= thresholds.critical) return CHART_COLORS.status.warning;
  return CHART_COLORS.status.critical;
}

/** Generate gradient definition for area charts */
export function getGradientId(color: string): string {
  return `gradient-${color.replace('#', '')}`;
}

/** Custom tick formatter for Recharts axes */
export function createTickFormatter(type: 'number' | 'currency' | 'percent' | 'compact' | 'date'): (value: number | string) => string {
  if (type === 'date') {
    return (value: number | string) => formatChartDate(String(value));
  }
  return (value: number | string) => formatChartValue(Number(value), type as 'number' | 'currency' | 'percent' | 'compact');
}

/** Responsive chart height based on container width */
export function getResponsiveChartHeight(containerWidth: number): number {
  if (containerWidth < 400) return 200;
  if (containerWidth < 600) return 250;
  if (containerWidth < 900) return 300;
  return 350;
}
