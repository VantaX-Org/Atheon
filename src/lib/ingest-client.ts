// src/lib/ingest-client.ts — browser-only helpers: template CSV download +
// papaparse file -> { header, rows }. Validation lives in ingest-validate.ts.
import Papa from 'papaparse';
import { INGEST_MANIFEST, templateHeader } from './ingest-manifest';

export function downloadTemplate(domain: string): void {
  const header = templateHeader(domain);
  const blob = new Blob([header + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `atheon-${domain}-template.csv`;
  a.click();
}

export function parseCsv(file: File): Promise<{ header: string[]; rows: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => resolve({
        header: (res.meta.fields ?? []) as string[],
        rows: res.data as Array<Record<string, unknown>>,
      }),
      error: reject,
    });
  });
}

export const INGEST_DOMAINS = INGEST_MANIFEST.map(d => ({ domain: d.domain, label: d.label }));
