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
import { CONFIG } from '../config';

// These matrices drive the SETUP_SECRET-gated verify-ops endpoints. Without
// VERIFY_SETUP_SECRET (e.g. the CI go-live gate, which neither sets the secret
// nor needs runtime synthesis) the whole file is skipped — the file-level
// beforeAll guards on the same flag so it never calls the live chain blind.
const ENABLED = !!CONFIG.setupSecret;
const d = ENABLED ? describe : describe.skip;

const client = new ApiClient();
let synthesizedRcaIds: string[] = [];

beforeAll(async () => {
  if (!ENABLED) return;
  await client.login();
  // Drive the live synthesis chain, then read the active RCAs. The synthesizer
  // writes status='active'; the seed writes status='resolved' — so the active
  // list IS the set of runtime-synthesized RCAs. (A before/after diff is wrong:
  // the chain dedups per red metric, so a repeat run adds no NEW active RCA even
  // though synthesized ones already exist.)
  await client.runPhase10Chain();
  synthesizedRcaIds = (await client.listActiveRcas()).map(r => r.id);
}, 300_000);

d('A1: runtime synthesis traceability', () => {
  it('synthesizes at least one RCA from the live chain', () => {
    expect(synthesizedRcaIds.length).toBeGreaterThan(0);
  });

  it('every synthesized RCA is well-formed and ERP-traceable', async () => {
    for (const rcaId of synthesizedRcaIds) {
      const chain = await client.getRcaChain(rcaId);
      // confidence on a 0-100 scale; clears the billing floor (/100 >= 0.70).
      expect(chain.rca.confidence).toBeGreaterThanOrEqual(70);
      // metric_id present so the RCA resolves to a real process metric.
      expect(chain.rca.metricId).toBeTruthy();
      // at least one causal factor, each carrying evidence + a numeric confidence.
      expect(chain.factors.length).toBeGreaterThan(0);
      for (const f of chain.factors) {
        expect(f.evidence).toBeTruthy();
        expect(typeof f.confidence).toBe('number');
        expect(f.confidence).toBeGreaterThanOrEqual(0);
        expect(f.confidence).toBeLessThanOrEqual(100);
      }
    }
  });

  it('NEGATIVE: synthesis alone never fabricates a billable impact', async () => {
    // The synthesizer quantifies confidence + evidence but NOT a Rand impact —
    // impact_value stays null until a prescription-linked, ERP-verified action
    // supplies it. So no synthesized factor may carry impact_value > 0: billable
    // state cannot originate from synthesis (the ERP-anchor boundary; see A2).
    for (const rcaId of synthesizedRcaIds) {
      const chain = await client.getRcaChain(rcaId);
      const billable = chain.factors.filter(f => (f.impactValue ?? 0) > 0);
      expect(billable.length).toBe(0);
    }
  });
});

d('A2: synthesized → billing ERP-anchor boundary', () => {
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
  }, 300_000);

  it('seeded verified RCAs ARE billed and carry verified action ids (sum reconciles)', async () => {
    const period = await client.getBillingPreview(FROM, TO);
    expect(period.line_items.length).toBeGreaterThan(0);
    for (const li of period.line_items) {
      // the verified-action anchor lives in the evidence blob
      expect(li.evidence.verified_action_ids.length).toBeGreaterThan(0);
      expect(li.attributed_savings).toBeGreaterThan(0);
    }
    const sum = period.line_items.reduce((s, li) => s + li.attributed_savings, 0);
    // total_realised_savings is the SUM of attributed_savings across line items.
    expect(Math.abs(sum - period.total_realised_savings)).toBeLessThan(1);
  });
});
