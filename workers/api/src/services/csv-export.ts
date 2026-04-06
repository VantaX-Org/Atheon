/**
 * CSV Export Helper — Spec §9.4
 * Shared utility for converting JSON rows to CSV format.
 */

export interface CSVColumn {
  key: string;
  label: string;
}

/**
 * Convert an array of objects to CSV string.
 * Handles quoting, escaping, and null values.
 */
export function toCSV(rows: Record<string, unknown>[], columns: CSVColumn[]): string {
  const header = columns.map(c => `"${c.label}"`).join(',');
  const body = rows.map(row => columns.map(c => {
    const val = row[c.key];
    if (val === null || val === undefined) return '';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }).join(',')).join('\n');
  return `${header}\n${body}`;
}

/**
 * Create a CSV Response with proper headers for browser download.
 */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    },
  });
}
