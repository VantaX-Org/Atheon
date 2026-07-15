import { describe, it, expect } from 'vitest';
import { buildJourneyStages, type StageInput } from '@/lib/journey';

const base: StageInput = {
  connections: { total: 3, broken: 0 },
  exposure: { openValueZar: 4_200_000, findingCount: 12 },
  fixes: { pendingCount: 0, pendingValueZar: 0 },
  savings: { recoveredZar: 160_644_105, roiMultiple: 12.4 },
};

describe('buildJourneyStages', () => {
  it('returns 5 stages in loop order with exactly one current', () => {
    const stages = buildJourneyStages(base, 'ZAR');
    expect(stages.map((s) => s.key)).toEqual(['connect', 'detect', 'fix', 'recover', 'report']);
    expect(stages.filter((s) => s.current)).toHaveLength(1);
  });

  it('fresh tenant: no connections → connect is current, nothing red', () => {
    const stages = buildJourneyStages(
      { connections: { total: 0, broken: 0 }, exposure: null, fixes: null, savings: null },
      'ZAR',
    );
    expect(stages[0].current).toBe(true);
    expect(stages.every((s) => s.rag !== 'red')).toBe(true);
  });

  it('connected but no findings yet → detect is current', () => {
    const stages = buildJourneyStages(
      { ...base, exposure: { openValueZar: 0, findingCount: 0 }, fixes: { pendingCount: 0, pendingValueZar: 0 }, savings: { recoveredZar: 0, roiMultiple: 0 } },
      'ZAR',
    );
    expect(stages.find((s) => s.key === 'detect')!.current).toBe(true);
  });

  it('pending approvals → fix is current and amber', () => {
    const stages = buildJourneyStages(
      { ...base, fixes: { pendingCount: 4, pendingValueZar: 900_000 } },
      'ZAR',
    );
    const fix = stages.find((s) => s.key === 'fix')!;
    expect(fix.current).toBe(true);
    expect(fix.rag).toBe('amber');
  });

  it('open exposure, empty queue, nothing recovered → fix is current (not recover)', () => {
    const stages = buildJourneyStages(
      { ...base, savings: { recoveredZar: 0, roiMultiple: 0 } },
      'ZAR',
    );
    expect(stages.find((s) => s.key === 'fix')!.current).toBe(true);
  });

  it('zero findings → detect CTA is neutral, not "Review findings"', () => {
    const stages = buildJourneyStages(
      { ...base, exposure: { openValueZar: 0, findingCount: 0 } },
      'ZAR',
    );
    expect(stages.find((s) => s.key === 'detect')!.cta).toBe('View findings');
  });

  it('healthy mature tenant → report is current', () => {
    const stages = buildJourneyStages(base, 'ZAR');
    expect(stages.find((s) => s.key === 'report')!.current).toBe(true);
  });

  it('broken connection → connect stage is red', () => {
    const stages = buildJourneyStages(
      { ...base, connections: { total: 3, broken: 1 } },
      'ZAR',
    );
    expect(stages[0].rag).toBe('red');
  });

  it('failed fetches → em-dash headlines (null), never zero', () => {
    const stages = buildJourneyStages(
      { connections: null, exposure: null, fixes: null, savings: null },
      'ZAR',
    );
    for (const s of stages) expect(s.headline).toBeNull();
  });

  it('formats exposure headline compactly in tenant currency', () => {
    const detect = buildJourneyStages(base, 'ZAR').find((s) => s.key === 'detect')!;
    expect(detect.headline).toMatch(/R/); // formatCompactCurrency ZAR
  });
});
