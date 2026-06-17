// Pure CSV-row validation against the ingest manifest. Strong-inference rule:
// unknown columns or any type-mismatched cell => the whole domain is rejected
// (rows: []). No silent coercion of a prospect column into a canonical field.
// MIRROR: workers/api/src/lib/ingest-validate.ts — keep identical.
import { domainDef, type ColType } from './ingest-manifest';

export interface CellError { row: number; column: string; message: string }
export interface ValidateResult { rows: Array<Record<string, unknown>>; errors: CellError[] }

function coerce(type: ColType, raw: unknown): { ok: boolean; value?: unknown } {
  const s = raw == null ? '' : String(raw).trim();
  if (s === '') return { ok: true, value: null };
  switch (type) {
    case 'string': return { ok: true, value: s };
    case 'number': {
      const n = Number(s.replace(/,/g, ''));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'integer': {
      const n = Number(s.replace(/,/g, ''));
      return Number.isInteger(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'date': {
      // Accept ISO-ish YYYY-MM-DD (the template format). Reject anything else.
      if (!/^\d{4}-\d{2}-\d{2}([ T].*)?$/.test(s)) return { ok: false };
      return { ok: true, value: s.slice(0, 10) };
    }
    case 'boolean': {
      if (/^(true|1|yes|y)$/i.test(s)) return { ok: true, value: 1 };
      if (/^(false|0|no|n)$/i.test(s)) return { ok: true, value: 0 };
      return { ok: false };
    }
  }
}

export function validateDomainRows(
  domain: string,
  header: string[],
  rawRows: Array<Record<string, unknown>>,
): ValidateResult {
  const def = domainDef(domain);
  if (!def) return { rows: [], errors: [{ row: 0, column: '', message: `unknown domain ${domain}` }] };

  const errors: CellError[] = [];
  const known = new Set(def.columns.map(c => c.name));

  // Header checks
  for (const h of header) {
    if (!known.has(h)) errors.push({ row: 0, column: h, message: `unknown column "${h}" for ${domain}` });
  }
  for (const c of def.columns) {
    if (c.required && !header.includes(c.name)) {
      errors.push({ row: 0, column: c.name, message: `missing required column "${c.name}"` });
    }
  }

  const out: Array<Record<string, unknown>> = [];
  rawRows.forEach((raw, i) => {
    const rowNo = i + 1;
    const obj: Record<string, unknown> = {};
    for (const col of def.columns) {
      const present = header.includes(col.name);
      if (!present) {
        // Optional column absent from the upload: nothing to ingest for it.
        // (Required-but-absent columns are already a header-level error above.)
        continue;
      }
      const cell = raw[col.name];
      if (col.required && (cell == null || String(cell).trim() === '')) {
        errors.push({ row: rowNo, column: col.name, message: `required value missing` });
        continue;
      }
      const r = coerce(col.type, cell);
      if (!r.ok) {
        errors.push({ row: rowNo, column: col.name, message: `expected ${col.type}` });
        continue;
      }
      obj[col.name] = r.value;
    }
    out.push(obj);
  });

  // Strong-inference: any error => nothing ingested.
  return errors.length ? { rows: [], errors } : { rows: out, errors: [] };
}
