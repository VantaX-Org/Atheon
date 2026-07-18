import { describe, it, expect } from 'vitest';
import {
  generateKpiDefinitions,
  calculateKpiValue,
  determineKpiStatus,
  type KpiDefinition,
} from '../kpi-definitions';

// ---------------------------------------------------------------------------
// Independent oracle for determineKpiStatus. Mirrors the documented intent
// ("G/A/R from a value and its thresholds") from first principles rather than
// copying the implementation: for higher_better a bigger value is better, so
// below red => red, below green => amber, at/above green => green. Note the
// amber threshold is deliberately NOT consulted — the band is [red, green).
// ---------------------------------------------------------------------------
function oracleStatus(value: number, direction: string, green: number, red: number): string {
  if (direction === 'higher_better') {
    if (value < red) return 'red';
    if (value < green) return 'amber';
    return 'green';
  }
  if (direction === 'lower_better') {
    if (value > red) return 'red';
    if (value > green) return 'amber';
    return 'green';
  }
  return 'green'; // info / anything else
}

describe('determineKpiStatus — higher_better', () => {
  // Universal Success Rate thresholds: green 90, amber 70, red 50.
  const g = 90, a = 70, r = 50;
  const cases: Array<[number, string]> = [
    [95, 'green'],
    [90, 'green'],   // exactly at green boundary
    [89.999, 'amber'],
    [70, 'amber'],   // at amber threshold — still amber (unused param)
    [50, 'amber'],   // exactly at red boundary — NOT red (strict <)
    [49.999, 'red'],
    [0, 'red'],
  ];
  it.each(cases)('value %p => %s', (value, expected) => {
    expect(determineKpiStatus(value, 'higher_better', g, a, r)).toBe(expected);
    expect(determineKpiStatus(value, 'higher_better', g, a, r)).toBe(oracleStatus(value, 'higher_better', g, r));
  });
});

describe('determineKpiStatus — lower_better', () => {
  // Discrepancy Rate thresholds: green 2, amber 5, red 10.
  const g = 2, a = 5, r = 10;
  const cases: Array<[number, string]> = [
    [0, 'green'],
    [2, 'green'],    // exactly at green boundary
    [2.001, 'amber'],
    [5, 'amber'],    // at amber threshold
    [10, 'amber'],   // exactly at red boundary — NOT red (strict >)
    [10.001, 'red'],
    [999, 'red'],
  ];
  it.each(cases)('value %p => %s', (value, expected) => {
    expect(determineKpiStatus(value, 'lower_better', g, a, r)).toBe(expected);
    expect(determineKpiStatus(value, 'lower_better', g, a, r)).toBe(oracleStatus(value, 'lower_better', g, r));
  });
});

describe('determineKpiStatus — info', () => {
  it('always green regardless of value', () => {
    expect(determineKpiStatus(-100, 'info', 1, 2, 3)).toBe('green');
    expect(determineKpiStatus(0, 'info', 1, 2, 3)).toBe('green');
    expect(determineKpiStatus(1e9, 'info', 1, 2, 3)).toBe('green');
  });
});

// ---------------------------------------------------------------------------
// calculateKpiValue — hand-computed expectations against real branches.
// ---------------------------------------------------------------------------
function run(over: Partial<Parameters<typeof calculateKpiValue>[2]> = {}) {
  return {
    source_record_count: 0,
    target_record_count: 0,
    matched: 0,
    discrepancies: 0,
    exceptions_raised: 0,
    total_source_value: 0,
    total_matched_value: 0,
    total_discrepancy_value: 0,
    total_exception_value: 0,
    total_unmatched_value: 0,
    duration_ms: 0,
    ...over,
  };
}
const agg = { success_rate: 88, avg_duration_ms: 45000, exception_rate: 4 };

describe('calculateKpiValue — universal', () => {
  it('success rate reads aggregate', () => {
    expect(calculateKpiValue('universal', 'X — Success Rate', run(), agg)).toBe(88);
  });
  it('processing time converts ms to seconds', () => {
    expect(calculateKpiValue('universal', 'X — Avg Processing Time', run(), agg)).toBe(45);
  });
  it('exception rate reads aggregate', () => {
    expect(calculateKpiValue('universal', 'X — Exception Rate', run(), agg)).toBe(4);
  });
});

describe('calculateKpiValue — reconciliation', () => {
  it('match rate = matched/source*100', () => {
    expect(calculateKpiValue('reconciliation', 'X — Match Rate', run({ matched: 95, source_record_count: 100 }), agg)).toBe(95);
  });
  it('match rate defaults to 100 when no source records (no div-by-zero)', () => {
    expect(calculateKpiValue('reconciliation', 'X — Match Rate', run(), agg)).toBe(100);
  });
  it('discrepancy rate = discrepancies/matched*100', () => {
    expect(calculateKpiValue('reconciliation', 'X — Discrepancy Rate', run({ discrepancies: 3, matched: 60 }), agg)).toBe(5);
  });
  it('discrepancy rate defaults to 0 when no matched (no div-by-zero)', () => {
    expect(calculateKpiValue('reconciliation', 'X — Discrepancy Rate', run(), agg)).toBe(0);
  });
  it('discrepancy value is passed through', () => {
    expect(calculateKpiValue('reconciliation', 'X — Discrepancy Value', run({ total_discrepancy_value: 12345 }), agg)).toBe(12345);
  });
});

describe('calculateKpiValue — maintenance (proxy math)', () => {
  it('MTBF = round(records/exceptions)', () => {
    expect(calculateKpiValue('maintenance', 'X — MTBF', run({ source_record_count: 100, exceptions_raised: 3 }), agg)).toBe(33);
  });
  it('MTBF defaults to 30 when no exceptions but records exist', () => {
    expect(calculateKpiValue('maintenance', 'X — MTBF', run({ source_record_count: 100 }), agg)).toBe(30);
  });
  it('MTBF is 0 when there is no data at all', () => {
    expect(calculateKpiValue('maintenance', 'X — MTBF', run(), agg)).toBe(0);
  });
  it('planned vs unplanned = round(matched/exceptions*10)/10', () => {
    expect(calculateKpiValue('maintenance', 'X — Planned vs Unplanned Ratio', run({ matched: 40, exceptions_raised: 3 }), agg)).toBe(13.3);
  });
  it('planned vs unplanned caps at 99 when no exceptions', () => {
    expect(calculateKpiValue('maintenance', 'X — Planned vs Unplanned Ratio', run({ matched: 40 }), agg)).toBe(99);
  });
});

describe('calculateKpiValue — experience NPS', () => {
  it('NPS = round((promoters-detractors)/total*100)', () => {
    // matched(promoters)=70, discrepancies(detractors)=10, total=100 => 60
    expect(calculateKpiValue('experience', 'X — NPS Score', run({ matched: 70, discrepancies: 10, source_record_count: 100 }), agg)).toBe(60);
  });
  it('NPS is 0 when no responses', () => {
    expect(calculateKpiValue('experience', 'X — NPS Score', run(), agg)).toBe(0);
  });
});

describe('calculateKpiValue — robustness', () => {
  it('unknown category returns null', () => {
    expect(calculateKpiValue('nope', 'X — Anything', run(), agg)).toBeNull();
  });
  it('known category, unknown KPI name returns null', () => {
    expect(calculateKpiValue('reconciliation', 'X — Not A Real KPI', run(), agg)).toBeNull();
  });
  it('all-zero inputs never produce NaN across every calculable KPI', () => {
    const catalog = generateKpiDefinitions(
      'Z',
      // description packed with a keyword from every category rule
      'reconcil invoice stock maintenance fleet shift pipeline quality production safety demand ' +
        'cold chain pricing security satisfaction spend energy',
      'ops',
      'assisted',
    );
    for (const def of catalog) {
      const v = calculateKpiValue(def.category, def.name, run(), { success_rate: 0, avg_duration_ms: 0, exception_rate: 0 });
      if (v !== null) expect(Number.isNaN(v)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// generateKpiDefinitions — catalog well-formedness + keyword matching.
// ---------------------------------------------------------------------------
const REQUIRED_STR: Array<keyof KpiDefinition> = ['name', 'unit', 'calculation', 'source', 'category'];

function assertWellFormed(defs: KpiDefinition[]) {
  const names = new Set<string>();
  for (const d of defs) {
    for (const f of REQUIRED_STR) {
      expect(typeof d[f], `${d.name}.${f}`).toBe('string');
      expect((d[f] as string).length, `${d.name}.${f} non-empty`).toBeGreaterThan(0);
    }
    expect(['higher_better', 'lower_better', 'info']).toContain(d.direction);
    for (const t of ['green', 'amber', 'red'] as const) {
      expect(Number.isFinite(d[t]), `${d.name}.${t} finite`).toBe(true);
    }
    expect(typeof d.is_universal).toBe('boolean');
    // Threshold monotonicity is what makes determineKpiStatus meaningful:
    // higher_better wants red <= green; lower_better wants green <= red.
    if (d.direction === 'higher_better') expect(d.red, `${d.name} red<=green`).toBeLessThanOrEqual(d.green);
    if (d.direction === 'lower_better') expect(d.green, `${d.name} green<=red`).toBeLessThanOrEqual(d.red);
    // Names must be unique within a catalog (dashboard keys).
    expect(names.has(d.name), `duplicate name ${d.name}`).toBe(false);
    names.add(d.name);
    // No fallback "KPI N" names should leak — every template has a real name.
    expect(d.name, 'no fallback KPI name').not.toMatch(/— KPI \d+$/);
  }
}

describe('generateKpiDefinitions', () => {
  it('always emits the 3 universal KPIs, even with no keyword match', () => {
    // Careful: matching is naive substring — avoid words that CONTAIN a keyword
    // (e.g. "matching" contains "match"). This description hits nothing.
    const defs = generateKpiDefinitions('Widget', 'foobar baz qux run', 'general', 'auto');
    const universal = defs.filter(d => d.is_universal);
    expect(universal).toHaveLength(3);
    expect(defs).toHaveLength(3); // nothing else matched
    expect(universal.map(d => d.name)).toEqual([
      'Widget — Success Rate',
      'Widget — Avg Processing Time',
      'Widget — Exception Rate',
    ]);
    assertWellFormed(defs);
  });

  it('matches multiple categories and prefixes every name with the sub-catalyst', () => {
    // "invoice reconciliation" hits reconciliation (reconcil) + financial (invoice).
    const defs = generateKpiDefinitions('AP Match', 'invoice reconciliation run', 'finance', 'auto');
    const cats = new Set(defs.map(d => d.category));
    expect(cats).toEqual(new Set(['universal', 'reconciliation', 'financial']));
    // 3 universal + 3 reconciliation + 3 financial
    expect(defs).toHaveLength(9);
    expect(defs.every(d => d.name.startsWith('AP Match — '))).toBe(true);
    assertWellFormed(defs);
  });

  it('matching keywords via the domain/autonomy fields also works (searchText is combined)', () => {
    const defs = generateKpiDefinitions('Plant', 'daily run', 'safety', 'assisted');
    expect(defs.some(d => d.category === 'safety')).toBe(true);
  });

  it('produces a fully well-formed catalog when every category matches', () => {
    const defs = generateKpiDefinitions(
      'Everything',
      'reconcil invoice stock maintenance fleet shift pipeline quality production safety demand ' +
        'cold chain pricing security satisfaction spend energy',
      'ops',
      'assisted',
    );
    // Every one of the 17 category rules should have fired at least once.
    const cats = new Set(defs.map(d => d.category));
    expect(cats.size).toBe(18); // 17 domain categories + 'universal'
    assertWellFormed(defs);
  });
});
