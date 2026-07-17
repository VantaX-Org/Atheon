import { describe, it, expect } from 'vitest';
import { activePersona, PERSONAS } from './persona';

describe('activePersona', () => {
  it('?as=cpo on the Vantax demo tenant → cpo persona', () => {
    const p = activePersona('?as=cpo', 'Vantax Demo');
    expect(p?.key).toBe('cpo');
    expect(p?.kicker).toBe('Recovered from your suppliers');
    expect(p?.opsFirst?.slice(0, 2)).toEqual(['procurement', 'finance']);
    expect(p?.canApprove).toBe(false);
  });
  it('?as=cpo on a real tenant → null (no switcher)', () => {
    expect(activePersona('?as=cpo', 'Acme')).toBeNull();
  });
  it('live tenant name "Vanta X" (spaced) still matches', () => {
    expect(activePersona('?as=cpo', 'Vanta X')?.key).toBe('cpo');
  });
  it('no ?as= on Vantax → default cfo', () => {
    expect(activePersona('', 'Vantax Demo')?.key).toBe('cfo');
  });
  it('unknown ?as=zzz → default cfo', () => {
    expect(activePersona('?as=zzz', 'Vantax Demo')?.key).toBe('cfo');
  });
  it('approval rights: fm can, board cannot', () => {
    expect(PERSONAS.fm.canApprove).toBe(true);
    expect(PERSONAS.board.canApprove).toBe(false);
  });
});
