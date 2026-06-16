import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiClient } from '../lib/client';
import { CONFIG } from '../config';
import { readManifest, type RunRecord } from '../lib/manifest';

/**
 * PRODUCTION LIVE SIMULATION — cross-functional, multi-persona, real transactions.
 *
 * Goal: exercise the product the way real users do, against the DEPLOYED API +
 * remote D1, and assert the CODE LOGIC holds for every role, journey and user
 * state — not a mocked surface. globalSetup has already reseeded the vantax
 * tenant and executed every reconciliation sub-catalyst once, recording the real
 * run results to a manifest; that is our captured-transaction substrate.
 *
 * Auth strategy (avoids the /auth/login 429 a browser sweep trips): we log in
 * ONCE as the seeded top-tier account, then MINT one fresh user per role via
 * POST /iam/users (returns a tempPassword) and log each in. Freshly minted
 * non-admin users are inside their 14-day MFA grace, so a bare password login
 * returns a token — no control is weakened, every email is distinct, and the
 * whole persona fleet costs N successful logins (never a failed-attempt lockout).
 *
 * Everything here is a hard assertion of an invariant the code dictates:
 * transaction capture, billing traceability, security-critical denials, and each
 * persona's promised surface. Journey E is the tightest of these — it pins the
 * board_member view-vs-export contract on both sides (can read its whole landing
 * page, cannot export the PDF), so a regression in either direction fails the run.
 */

// ── Persona fleet ──────────────────────────────────────────────────────────
// The seven roles below the admin tier. The top tier (superadmin/admin) is the
// primary seeded account itself — no need to mint it. Permissions MIRROR the
// production seed (migrate.ts / iam.ts) because the API gates several surfaces
// on the granted permission, not the role name.
type Persona =
  | 'executive' | 'manager' | 'analyst' | 'operator'
  | 'auditor' | 'viewer' | 'board_member';

const PERSONAS: Persona[] = [
  'executive', 'manager', 'analyst', 'operator', 'auditor', 'viewer', 'board_member',
];

const PERSONA_PERMISSIONS: Record<Persona, string[]> = {
  executive: ['apex.read', 'pulse.read', 'catalysts.read', 'catalysts.execute', 'mind.query'],
  manager: ['pulse.read', 'pulse.write', 'catalysts.read', 'catalysts.execute', 'mind.query', 'memory.read'],
  analyst: ['pulse.read', 'mind.query'],
  operator: ['apex.read', 'pulse.read', 'catalysts.read', 'catalysts.execute', 'mind.query'],
  auditor: ['compliance.read', 'audit.read'],
  viewer: ['dashboard.read'],
  board_member: ['board_digest.read', 'roi.read'],
};

/** Valid item_status values a reconciliation run item can carry. */
const ITEM_STATUSES = new Set([
  'matched', 'unmatched_source', 'unmatched_target', 'discrepancy', 'exception',
]);

interface PersonaClient { role: Persona; client: ApiClient; userId: string; email: string; }

describe('PRODUCTION live simulation', () => {
  let primary: ApiClient;               // seeded top-tier (superadmin + admin)
  const fleet = new Map<Persona, PersonaClient>();
  let manifestRuns: Record<string, RunRecord> = {};

  beforeAll(async () => {
    primary = new ApiClient();
    await primary.login();

    // Journey A is also provisioning: mint + log in every persona ONCE here so
    // the later journeys can reuse the authenticated clients.
    for (const role of PERSONAS) {
      const email = `sim-${role}-${randomUUID().slice(0, 8)}@vantax.co.za`;
      const mint = await primary.authedFetch('/api/v1/iam/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: `Sim ${role}`, role, permissions: PERSONA_PERMISSIONS[role] }),
      });
      if (mint.status !== 201) {
        throw new Error(`mint ${role} failed (${mint.status}): ${await mint.text()}`);
      }
      const minted = await mint.json() as { tempPassword: string; user?: { id?: string } };
      const client = new ApiClient(email, minted.tempPassword, CONFIG.apiUrl);
      await client.login();
      fleet.set(role, { role, client, userId: minted.user?.id ?? '', email });
    }

    manifestRuns = readManifest().runs;
  }, 180_000);

  // ── Journey A — provisioning + user-state lifecycle ──────────────────────
  describe('Journey A — provisioning & user-state lifecycle', () => {
    it('minted a working session for every persona (invited → active, within MFA grace)', () => {
      for (const role of PERSONAS) {
        const pc = fleet.get(role);
        expect(pc, `${role} should be provisioned`).toBeTruthy();
        expect(pc!.client.token, `${role} should hold a session token`).toBeTruthy();
      }
    });

    it.each(PERSONAS)('%s session reports the correct role and the vantax tenant', (role) => {
      const u = fleet.get(role)!.client.user;
      expect(u, `${role} login returned a user`).toBeTruthy();
      expect(u!.role, `${role} token role`).toBe(role);
      // Minted users must share the primary's tenant — proves no cross-tenant leak
      // at provisioning and that the persona is scoped to vantax.
      expect(u!.tenantId, `${role} bound to vantax tenant`).toBe(primary.user!.tenantId);
    });

    it('every authenticated persona can read the universal dashboard surface', async () => {
      for (const role of PERSONAS) {
        const resp = await fleet.get(role)!.client.authedFetch('/api/v1/apex/health');
        expect(resp.status, `${role} apex/health`).toBe(200);
      }
    });
  });

  // ── Journey B — catalyst execution & real transaction capture ────────────
  describe('Journey B — real transaction capture (reconciliation runs)', () => {
    it('globalSetup captured at least one real run', () => {
      expect(Object.keys(manifestRuns).length).toBeGreaterThan(0);
    });

    it.each(['grir', 'bank', 'inventory', 'salesOrder'])(
      '%s run is persisted with consistent, real item totals',
      (key) => {
        const run = manifestRuns[key];
        expect(run, `${key} run recorded`).toBeTruthy();
        expect(run.runId, `${key} has a run id`).toBeTruthy();
        expect(run.totals.items_total, `${key} captured real items`).toBeGreaterThan(0);

        // Every per-item status is a known reconciliation outcome — no junk states.
        for (const status of Object.keys(run.statusCounts)) {
          expect(ITEM_STATUSES.has(status), `${key} item_status "${status}" is valid`).toBe(true);
        }

        // The item breakdown must account for the recorded total (no phantom items).
        const breakdownSum = Object.values(run.statusCounts).reduce((a, b) => a + b, 0);
        expect(breakdownSum, `${key} item breakdown == items_total`).toBe(run.totals.items_total);
      },
    );

    it('a reconciliation actually matched value (proves real ERP data flowed, not empty runs)', () => {
      const matchedTotal = Object.values(manifestRuns).reduce((a, r) => a + (r.totals.matched ?? 0), 0);
      expect(matchedTotal, 'at least one matched item across all runs').toBeGreaterThan(0);
    });
  });

  // ── Journey C — cross-functional RBAC capability matrix ──────────────────
  // Probe a representative gated surface from every layer of the product, for
  // every persona + the top tier, then assert the security-critical outcomes.
  describe('Journey C — RBAC capability matrix (all personas × gated surfaces)', () => {
    const EXECUTE_PATH = '/api/v1/catalysts/clusters/__none__/sub-catalysts/x/execute';
    const NEW_USER = () => JSON.stringify({ email: `probe-${randomUUID().slice(0, 6)}@vantax.co.za`, name: 'probe', role: 'viewer' });

    async function probe(c: ApiClient, path: string, init?: RequestInit): Promise<number> {
      const resp = await c.authedFetch(path, init);
      return resp.status;
    }

    it('executive may execute a catalyst; analyst/viewer/auditor/board_member may NOT', async () => {
      const exec = await probe(fleet.get('executive')!.client, EXECUTE_PATH, { method: 'POST' });
      // Executive clears the role gate (reaches lookup → 404 on the bogus cluster),
      // never denied (401/403) and never a 5xx (which would mean the gate errored).
      expect(exec, 'executive not denied at role gate').not.toBe(403);
      expect(exec, 'executive authenticated').not.toBe(401);
      expect(exec, 'executive reached lookup, no server error').toBeLessThan(500);

      for (const role of ['analyst', 'viewer', 'auditor', 'board_member'] as Persona[]) {
        const s = await probe(fleet.get(role)!.client, EXECUTE_PATH, { method: 'POST' });
        expect(s, `${role} denied catalyst execute`).toBe(403);
      }
    });

    it('admin tier may create users; viewer/analyst/auditor may NOT (write gate)', async () => {
      const top = await probe(primary, '/api/v1/iam/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: NEW_USER(),
      });
      expect(top, 'top tier can create users').toBe(201);

      for (const role of ['viewer', 'analyst', 'auditor'] as Persona[]) {
        const s = await probe(fleet.get(role)!.client, '/api/v1/iam/users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: NEW_USER(),
        });
        expect(s, `${role} denied user create`).toBe(403);
      }
    });

    it('auditor (audit.read) reads the audit log; viewer (no grant) is denied', async () => {
      const a = await probe(fleet.get('auditor')!.client, '/api/v1/audit/log');
      expect(a, 'auditor allowed').toBe(200);
      const v = await probe(fleet.get('viewer')!.client, '/api/v1/audit/log');
      expect(v, 'viewer denied').toBe(403);
    });

    it('billing period (shared-savings) is admin-tier only; operator/viewer denied', async () => {
      const top = await probe(primary, '/api/v1/billing/period?from=2024-01-01&to=2030-01-01');
      expect(top, 'top tier reads billing').toBe(200);
      for (const role of ['operator', 'viewer'] as Persona[]) {
        const s = await probe(fleet.get(role)!.client, '/api/v1/billing/period?from=2024-01-01&to=2030-01-01');
        expect(s, `${role} denied billing`).toBe(403);
      }
    });
  });

  // ── Journey D — shared-savings billing traceability (API-level) ───────────
  // The strongest business invariant: every claimed Rand traces to an RCA + a
  // confidence + evidence anchoring it to ONE ERP-derived causal factor. We
  // assert it against the LIVE compute path (persist:false preview), not just
  // the persisted table the D1 invariant test checks.
  describe('Journey D — shared-savings billing traceability (live compute)', () => {
    interface LineItem {
      rca_id: string; metric_name: string; attributed_savings: number; confidence: number;
      evidence: { causal_factor_id: string | null; verified_action_ids: string[]; max_factor_impact: number };
    }
    interface Period {
      currency: string; share_pct: number; line_items: LineItem[];
      total_realised_savings: number; atheon_revenue: number;
    }
    let period: Period;

    beforeAll(async () => {
      const resp = await primary.authedFetch('/api/v1/billing/period?from=2024-01-01&to=2030-01-01');
      expect(resp.status, 'billing period preview').toBe(200);
      period = (await resp.json() as { period: Period }).period;
    });

    it('materialised at least one billable line item from real resolved RCAs', () => {
      expect(period.line_items.length, 'live compute produced billable claims').toBeGreaterThan(0);
    });

    it('every claimed Rand traces to an RCA, a confidence, and an ERP-anchored causal factor', () => {
      const offenders: string[] = [];
      for (const li of period.line_items) {
        if (!li.rca_id) offenders.push(`${li.metric_name}: null rca_id`);
        if (li.attributed_savings == null || li.attributed_savings < 0) offenders.push(`${li.rca_id}: savings=${li.attributed_savings}`);
        // Strong inference: a billed claim with zero confidence would be a weak
        // rule silently applied — the project rule forbids it.
        if (li.confidence == null || li.confidence <= 0) offenders.push(`${li.rca_id}: confidence=${li.confidence}`);
        if (li.confidence > 1) offenders.push(`${li.rca_id}: confidence>1 (${li.confidence})`);
        // The anchor that ties the dollar to one ERP record + field mapping.
        if (!li.evidence?.causal_factor_id) offenders.push(`${li.rca_id}: no causal_factor anchor`);
      }
      expect(offenders, offenders.join('\n')).toHaveLength(0);
    });

    it('SUM(attributed_savings) reconciles to total_realised_savings', () => {
      const sum = period.line_items.reduce((a, li) => a + (li.attributed_savings ?? 0), 0);
      expect(Math.abs(sum - period.total_realised_savings)).toBeLessThanOrEqual(1);
    });

    it('atheon_revenue == total_realised_savings × share_pct (no fabricated revenue)', () => {
      const expected = period.total_realised_savings * period.share_pct;
      expect(Math.abs(period.atheon_revenue - expected)).toBeLessThanOrEqual(1);
    });
  });

  // ── Journey E — board_member persona surface (its one landing page) ──────
  // board_member (ROLE_LEVELS level 80, seeded board_digest.read + roi.read)
  // lands on /board-digest and sees ONLY that page. The page itself does NOT
  // call /api/v1/board-digest/* — it composes its tiles from open, authenticated
  // read endpoints (apex.health, insights-stats billing/forecast, apex risks
  // count, pulse anomalies count), all mounted under tenantIsolation with no
  // role gate. /api/v1/board-digest/generate is the EXPORT-to-PDF action only,
  // gated requireRole(...,executive) AND hidden client-side for board_member
  // (BoardDigestPage canExportDigest). So the contract is: board_member can VIEW
  // the whole surface but cannot EXPORT. We assert both halves hold on prod.
  const BOARD_DIGEST_PAGE_SURFACE = [
    '/api/v1/apex/health',
    '/api/v1/insights-stats/billing-summary',
    '/api/v1/insights-stats/forecast-accuracy',
    '/api/v1/apex/risks/count',
    '/api/v1/pulse/anomalies/count',
  ];
  describe('Journey E — board_member surface reachability', () => {
    it('board_member can load every data endpoint its landing page composes (full VIEW access)', async () => {
      const bm = fleet.get('board_member')!.client;
      for (const path of BOARD_DIGEST_PAGE_SURFACE) {
        const resp = await bm.authedFetch(path);
        // 200 = served. Never 401/403 (would mean the persona is gate-locked out
        // of its own page) and never 5xx (gate errored).
        expect(resp.status, `board_member blocked from page surface ${path}`).not.toBe(401);
        expect(resp.status, `board_member blocked from page surface ${path}`).not.toBe(403);
        expect(resp.status, `${path} 5xx for board_member`).toBeLessThan(500);
      }
    });

    it('board_member CAN reach its roi data path (roi.read)', async () => {
      const resp = await fleet.get('board_member')!.client.authedFetch('/api/v1/roi');
      // roi is mounted under tenantIsolation for all authenticated users; a 200
      // (or 404 if the tenant has no roi row yet) both prove it is not gate-blocked.
      expect([200, 404], `board_member roi status was ${resp.status}`).toContain(resp.status);
    });

    it('board_member is correctly DENIED the PDF export (view-only contract; matches hidden client button)', async () => {
      const resp = await fleet.get('board_member')!.client.authedFetch('/api/v1/board-digest/generate', { method: 'POST' });
      // Intended by design (index.ts:543 + BoardDigestPage canExportDigest): the
      // board_member views on-screen but does not export. 403 is the correct
      // server-side mirror of the hidden Download-PDF button — NOT a gap.
      expect(resp.status, 'board_member must not be able to export the digest PDF').toBe(403);
    });
  });
});
