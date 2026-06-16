import { describe, it, expect } from 'vitest';
import { validateDomainRows } from '../ingest-validate';

describe('validateDomainRows', () => {
  it('accepts a valid invoices row set', () => {
    const r = validateDomainRows('invoices',
      ['invoice_number', 'invoice_date', 'total'],
      [{ invoice_number: 'INV-1', invoice_date: '2026-01-15', total: '1000.50' }]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ invoice_number: 'INV-1', invoice_date: '2026-01-15', total: 1000.5 }]);
  });

  it('rejects an unknown column wholesale (strong inference)', () => {
    const r = validateDomainRows('invoices',
      ['invoice_number', 'invoice_date', 'total', 'mystery_col'],
      [{ invoice_number: 'INV-1', invoice_date: '2026-01-15', total: '1', mystery_col: 'x' }]);
    expect(r.errors.some(e => /unknown column.*mystery_col/i.test(e.message))).toBe(true);
    expect(r.rows).toEqual([]);
  });

  it('rejects a missing required column', () => {
    const r = validateDomainRows('invoices', ['invoice_number', 'invoice_date'], []);
    expect(r.errors.some(e => /missing required column.*total/i.test(e.message))).toBe(true);
  });

  it('flags a type mismatch with row + column', () => {
    const r = validateDomainRows('invoices',
      ['invoice_number', 'invoice_date', 'total'],
      [{ invoice_number: 'INV-1', invoice_date: 'not-a-date', total: 'abc' }]);
    expect(r.errors.some(e => e.row === 1 && e.column === 'invoice_date')).toBe(true);
    expect(r.errors.some(e => e.row === 1 && e.column === 'total')).toBe(true);
    expect(r.rows).toEqual([]);
  });
});
