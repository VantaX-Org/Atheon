import { describe, it, expect } from 'vitest';
import { CATALYST_CATALOG } from '../services/catalyst-templates';
// Cross-boundary import: the frontend recommendation rules live in the SPA
// bundle but reference catalog cluster/sub names owned by the API. The file
// has zero imports of its own so the workers pool bundles it directly —
// keeping this drift lock build-time with no fs reads (workerd has no fs).
import { ANOMALY_RULES, RISK_RULES } from '../../../../src/lib/catalyst-recommendation';

/**
 * Drift lock (spec §7.4): every cluster + sub-catalyst name referenced by the
 * frontend recommendation rules must exist in CATALYST_CATALOG, otherwise the
 * "Deploy catalyst" deep-links (?cluster=&sub=) dangle into a toast error.
 * Mirrors the FINDING_CATALYST_MAP lock in assessment-findings.test.ts.
 */
describe('catalyst-recommendation drift lock', () => {
  const ruleSets = [
    { label: 'ANOMALY_RULES', rules: ANOMALY_RULES },
    { label: 'RISK_RULES', rules: RISK_RULES },
  ];

  for (const { label, rules } of ruleSets) {
    it(`every ${label} recommendation resolves to a catalog cluster + sub-catalyst`, () => {
      const errors: string[] = [];
      for (const rule of rules) {
        const cluster = CATALYST_CATALOG.find(c => c.name === rule.rec.catalyst);
        if (!cluster) {
          errors.push(`[${rule.keywords[0]}]: cluster "${rule.rec.catalyst}" not found in catalog`);
          continue;
        }
        if (!cluster.sub_catalysts.some(s => s.name === rule.rec.subCatalyst)) {
          errors.push(`[${rule.keywords[0]}]: sub-catalyst "${rule.rec.subCatalyst}" not found on cluster "${rule.rec.catalyst}"`);
        }
      }
      expect(errors).toEqual([]);
    });
  }
});
