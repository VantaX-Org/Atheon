/**
 * Runtime synthesis → billing verification (A1 + A2).
 *
 * A1: the system's own RCA synthesis (runPhase10ChainForTenant) produces
 *     well-formed, billable-shaped RCAs + causal_factors, and does NOT emit a
 *     billable (impact>0) factor from a sub-0.70-confidence RCA.
 * A2: a synthesized RCA, even once resolved and given a completed action, is
 *     NOT billed because the SAP action never reaches verification_status=
 *     'verified' — proving the ERP-anchor gate. Seeded verified RCAs still bill.
 *
 * Requires VERIFY_SETUP_SECRET. Runs against the configured apiUrl/tenant.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../lib/client';

const client = new ApiClient();
let synthesizedRcaIds: string[] = [];

beforeAll(async () => {
  await client.login();
  const before = new Set((await client.listActiveRcas()).map(r => r.id));
  await client.runPhase10Chain();
  const after = await client.listActiveRcas();
  synthesizedRcaIds = after.filter(r => !before.has(r.id)).map(r => r.id);
}, 120_000);

describe('A1: runtime synthesis traceability', () => {
  it('synthesizes at least one new RCA from the live chain', () => {
    expect(synthesizedRcaIds.length).toBeGreaterThan(0);
  });

  it('every synthesized billable factor is well-formed and ERP-traceable', async () => {
    let billableFactorCount = 0;
    for (const rcaId of synthesizedRcaIds) {
      const chain = await client.getRcaChain(rcaId);
      const billable = chain.factors.filter(f => (f.impactValue ?? 0) > 0);
      for (const f of billable) {
        billableFactorCount++;
        // confidence on a 0-100 scale; billing floor is /100 >= 0.70
        expect(chain.rca.confidence).toBeGreaterThanOrEqual(70);
        expect(f.confidence).toBeGreaterThanOrEqual(70);
        expect(f.evidence).toBeTruthy();
        // metric_id present so the factor resolves to a real process metric
        expect(chain.rca.metricId).toBeTruthy();
      }
    }
    expect(billableFactorCount).toBeGreaterThan(0);
  });

  it('NEGATIVE: no synthesized RCA below the 0.70 floor carries a billable factor', async () => {
    for (const rcaId of synthesizedRcaIds) {
      const chain = await client.getRcaChain(rcaId);
      if (chain.rca.confidence < 70) {
        const billable = chain.factors.filter(f => (f.impactValue ?? 0) > 0);
        expect(billable.length).toBe(0);
      }
    }
  });
});

describe('A2: synthesized → billing ERP-anchor boundary', () => {
  // A wide period guaranteed to include "now" so both seeded and synthesized
  // resolved RCAs fall in range.
  const FROM = '2026-01-01';
  const TO = '2026-12-31';

  it('billing EXCLUDES a synthesized RCA whose action never reaches verified', async () => {
    expect(synthesizedRcaIds.length).toBeGreaterThan(0);
    const target = synthesizedRcaIds[0];

    // Resolve it so it clears the status gate — isolating the verified-action gate.
    const resolved = await client.resolveRca(target);
    expect(resolved.resolved).toBe(true);

    // Give it a completed, prescription-linked action, then run verification.
    await client.createCompletedAction(target);
    const verif = await client.runActionVerification();
    // SAP tenant: the action must NOT have been verified.
    expect(verif.counts.verified).toBe(0);

    // Billing preview must NOT contain the synthesized RCA (no verified anchor).
    const period = await client.getBillingPreview(FROM, TO);
    const billedIds = new Set(period.line_items.map(li => li.rca_id));
    expect(billedIds.has(target)).toBe(false);
  }, 120_000);

  it('seeded verified RCAs ARE billed and carry verified action ids (sum reconciles)', async () => {
    const period = await client.getBillingPreview(FROM, TO);
    expect(period.line_items.length).toBeGreaterThan(0);
    for (const li of period.line_items) {
      expect(li.verified_action_ids.length).toBeGreaterThan(0);
      expect(li.attributed_savings).toBeGreaterThan(0);
    }
    const sum = period.line_items.reduce((s, li) => s + li.attributed_savings, 0);
    // total_realised_savings is the SUM of attributed_savings across line items.
    expect(Math.abs(sum - period.total_realised_savings)).toBeLessThan(1);
  });
});
