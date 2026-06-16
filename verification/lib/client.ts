import { CONFIG } from '../config';
import { generateTotp } from './totp';

/**
 * fetch that retries only THROWN network errors (e.g. prod TLS `ECONNRESET` /
 * "fetch failed" mid-flight — observed crashing globalSetup during a long
 * reconciliation execute). HTTP error statuses are returned untouched so every
 * caller's status-based logic and retries stay authoritative; this only papers
 * over transport-level flakes against the live API. Reads are idempotent; an
 * execute POST may create one duplicate run on retry, which is harmless and
 * deterministic on the same seed.
 */
async function fetchRetry(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await new Promise<void>(r => setTimeout(r, attempt * 1500));
    }
  }
  throw lastErr;
}

export interface AuthedUser {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  tenantSlug: string;
}

export interface Cluster {
  id: string;
  name: string;
  domain?: string;
  subCatalysts?: Array<{ name: string; enabled?: boolean }>;
}

export interface RunItemTotals {
  items_total: number;
  matched: number;
  discrepancies: number;
  unmatched: number;
  exceptions: number;
  total_source_value?: number;
  total_matched_value?: number;
}

/** One reconciliation run item — only the fields the harness inspects. */
export interface RunItem {
  id: string;
  item_status: string | null;
  exception_type: string | null;
  discrepancy_field: string | null;
  discrepancy_reason: string | null;
}

/** A synthesized/seeded RCA as returned by GET /api/diagnostics. */
export interface RcaSummary {
  id: string;
  metricId: string;
  metricName?: string;
  confidence: number; // stored 0–100; billing floor is /100 >= 0.70
  status: string;
  generatedAt: string;
}

/** One causal factor from GET /api/diagnostics/rca/:id/chain. */
export interface CausalFactor {
  factorType: string;
  impactValue: number | null;
  impactUnit?: string | null;
  confidence: number;
  evidence: Record<string, unknown>;
}

export interface RcaChain {
  rca: { id: string; metricId: string; metricName?: string; confidence: number; status: string };
  factors: CausalFactor[];
}

/** Billing preview period (GET /api/billing/period, persist:false). */
export interface BillingLineItem {
  rca_id: string;
  attributed_savings: number;
  verified_action_ids: string[];
}
export interface BillingPeriod {
  line_items: BillingLineItem[];
  total_realised_savings: number;
}

/** Counts from verifyCompletedActions (run-action-verification op). */
export interface VerifyCounts {
  checked: number;
  verified: number;
  failed: number;
  deferred: number;
  skipped: number;
}

/** Sub-catalyst execute result (the body returned by the execute endpoint). */
export interface ExecutionResult {
  id?: string;
  sub_catalyst?: string;
  status?: string; // 'failed' or a success status
  mode?: string;   // reconciliation | validation | compare | extraction — typed payload
  executed_at?: string;
  error?: string;
  run_id?: string;
  summary?: Record<string, unknown>;
}

/** Thin client over the deployed Atheon API for verification suites. */
export class ApiClient {
  token: string | null = null;
  user: AuthedUser | null = null;

  constructor(
    private readonly email = CONFIG.adminEmail,
    private readonly password = CONFIG.adminPassword,
    private readonly baseUrl = CONFIG.apiUrl,
    /**
     * When demo-login is used (default-admin creds + VERIFY_DEMO_SECRET set),
     * mint a token for THIS role instead of 'admin'. Lets a suite exercise a
     * superadmin-gated endpoint without standing up real MFA on a superadmin.
     */
    private readonly demoRole = 'admin',
  ) {}

  /** True when the caller passed real, non-default credentials (a minted user). */
  private get hasExplicitCreds(): boolean {
    return this.email !== CONFIG.adminEmail || this.password !== CONFIG.adminPassword;
  }

  async login(): Promise<void> {
    // v40 makes a bare password login for an admin-tier account return 403 once
    // its 14-day MFA grace expires — which is correct for real users but would
    // wedge the gate. Two security-preserving auth paths, in priority order:
    //   1. demo-login (X-Demo-Secret) — purpose-built automation path, disabled
    //      in production, needs no MFA state on the account. Preferred when set.
    //   2. password login that COMPLETES the real MFA challenge via /mfa/validate
    //      using a configured TOTP seed — same flow a human admin performs.
    // Neither weakens the control: demo-login is prod-disabled + secret-gated,
    // and the TOTP path proves possession of the seeded authenticator.
    //
    // Explicit (minted) credentials always take the password path: demo-login
    // would mint an ADMIN token regardless of email, masking the very role
    // boundary an RBAC suite means to probe. Freshly minted non-admin users are
    // inside their MFA grace, so the bare password login returns a token.
    // Prefer the automation path when a demo secret is configured, but it is
    // intentionally disabled in production (returns 404). If it is unavailable,
    // fall back to the real password + mandatory-MFA flow rather than wedging
    // the gate — neither path weakens a control, and this keeps the harness
    // robust even when VERIFY_DEMO_SECRET leaks into a prod-scoped run.
    if (CONFIG.demoSecret && !this.hasExplicitCreds) {
      const usedDemo = await this.demoLogin();
      if (usedDemo) return;
    }
    await this.passwordLogin();
  }

  /**
   * Mint a real JWT (default role 'admin') via the secret-gated automation path.
   * Returns true on success. Returns false when the path is unavailable (404 —
   * prod-disabled or secret mismatch) so the caller can fall back to the real
   * password + MFA flow. Throws on unexpected failures (e.g. 5xx) so genuine
   * outages still surface loudly.
   */
  private async demoLogin(): Promise<boolean> {
    const resp = await fetchRetry(`${this.baseUrl}/api/v1/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Demo-Secret': CONFIG.demoSecret },
      body: JSON.stringify({ tenant_slug: CONFIG.tenantSlug, role: this.demoRole }),
    });
    if (resp.status === 404) {
      // Prod-disabled (ENVIRONMENT=production) or wrong secret — the automation
      // path is simply not available here. Signal the caller to use passwordLogin.
      return false;
    }
    if (!resp.ok) {
      // Body can reflect request material on a failing auth endpoint — log status only.
      throw new Error(`Demo-login failed (${resp.status}) — check VERIFY_DEMO_SECRET matches the env's DEMO_LOGIN_SECRET`);
    }
    const data = await resp.json() as { token?: string; user?: AuthedUser };
    if (!data.token) throw new Error('Demo-login returned no token');
    this.token = data.token;
    this.user = data.user ?? null;
    return true;
  }

  /** Password login, completing a mandatory-MFA challenge via TOTP when raised. */
  private async passwordLogin(): Promise<void> {
    // A cold worker / brief D1 hiccup can make the login endpoint return a
    // transient 5xx (observed: one role's login flaked 500 mid-run while the
    // same live API passed the whole RBAC matrix moments earlier). Login is
    // idempotent — a retry only writes one more audit-log row — so retry
    // transient 5xx with backoff rather than flapping the gate. A 4xx is a real
    // client error (bad credentials, MFA-not-enabled) and is never retried.
    const MAX_ATTEMPTS = 3;
    let lastStatus = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const resp = await fetchRetry(`${this.baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.password, tenant_slug: CONFIG.tenantSlug }),
      });
      if (resp.ok) {
        const data = await resp.json() as {
          token?: string;
          user?: AuthedUser;
          mfaRequired?: boolean;
          mfaChallengeToken?: string;
        };
        // MFA-enabled account: server returns a challenge, not a token. Complete
        // it with a TOTP from the configured seed (no seed => clear error).
        if (data.mfaRequired && data.mfaChallengeToken) {
          await this.completeMfa(data.mfaChallengeToken);
          return;
        }
        if (!data.token) {
          throw new Error(
            `Login returned no token for ${this.email}. The account likely has mandatory MFA but no ` +
            `authenticator enrolled, or it raised a challenge without a token. Set VERIFY_DEMO_SECRET ` +
            `(preferred) or enrol MFA and set VERIFY_ADMIN_TOTP_SEED.`,
          );
        }
        this.token = data.token;
        this.user = data.user ?? null;
        return;
      }
      lastStatus = resp.status;
      if (resp.status === 403) {
        // v40 mandatory-MFA: admin-tier account past its grace with no MFA enabled.
        throw new Error(
          `Login forbidden (403) for ${this.email} — mandatory MFA is enforced for this role and the ` +
          `grace period has expired. Set VERIFY_DEMO_SECRET (preferred) or enrol MFA on this account ` +
          `and set VERIFY_ADMIN_TOTP_SEED. Do NOT weaken the MFA control to make the gate pass.`,
        );
      }
      if (resp.status < 500 || attempt === MAX_ATTEMPTS) {
        // Do not log the response body: a failing auth endpoint can reflect
        // request material. Status + the configured email is enough to triage.
        throw new Error(`Login failed (${resp.status}) for ${this.email} — check VERIFY_ADMIN_* credentials`);
      }
      await new Promise<void>(resolve => setTimeout(resolve, attempt * 1000));
    }
    throw new Error(`Login failed after ${MAX_ATTEMPTS} attempts (last ${lastStatus}) for ${this.email}`);
  }

  /** Exchange an MFA challenge token + generated TOTP for a session token. */
  private async completeMfa(challengeToken: string): Promise<void> {
    if (!CONFIG.adminTotpSeed) {
      throw new Error(
        `Account ${this.email} raised an MFA challenge but VERIFY_ADMIN_TOTP_SEED is not set. ` +
        `Set it to the account's base32 authenticator seed, or use VERIFY_DEMO_SECRET instead.`,
      );
    }
    const code = generateTotp(CONFIG.adminTotpSeed);
    const resp = await fetchRetry(`${this.baseUrl}/api/v1/auth/mfa/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_token: challengeToken, code }),
    });
    if (!resp.ok) {
      throw new Error(`MFA validation failed (${resp.status}) for ${this.email} — check VERIFY_ADMIN_TOTP_SEED`);
    }
    const data = await resp.json() as { token?: string; user?: AuthedUser };
    if (!data.token) throw new Error('MFA validation returned no token');
    this.token = data.token;
    this.user = data.user ?? null;
  }

  async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.token) throw new Error('authedFetch called before login()');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    return fetchRetry(`${this.baseUrl}${path}`, { ...init, headers });
  }

  async reseed(): Promise<unknown> {
    // Doubled prefix: router mounts /api/v1/seed-vantax, handler path is /seed-vantax.
    // The seed writes thousands of rows in one request and intermittently trips
    // D1's per-request CPU limit ("D1 DB exceeded its CPU time limit and was reset"),
    // returning 500 and leaving a partially-seeded tenant (e.g. a null
    // business_report_key). The seed is idempotent — it truncates then re-seeds —
    // so retry transient 5xx with backoff rather than failing the gate on one flake.
    // A 4xx is a real client error and is never retried.
    const MAX_ATTEMPTS = 3;
    let lastBody = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const resp = await this.authedFetch('/api/v1/seed-vantax/seed-vantax', { method: 'POST' });
      if (resp.ok) return resp.json();
      lastBody = await resp.text();
      if (resp.status < 500 || attempt === MAX_ATTEMPTS) {
        throw new Error(`Reseed failed (${resp.status}): ${lastBody}`);
      }
      // D1 was just reset — give it a moment to recover before re-seeding.
      await new Promise<void>(resolve => setTimeout(resolve, attempt * 5000));
    }
    throw new Error(`Reseed failed after ${MAX_ATTEMPTS} attempts: ${lastBody}`);
  }

  async listClusters(): Promise<Cluster[]> {
    const resp = await this.authedFetch('/api/v1/catalysts/clusters');
    if (!resp.ok) throw new Error(`listClusters failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { clusters?: Cluster[] } | Cluster[];
    return Array.isArray(data) ? data : (data.clusters ?? []);
  }

  /** Find the cluster that owns a sub-catalyst by its display name. */
  async resolveCluster(subName: string): Promise<Cluster> {
    const clusters = await this.listClusters();
    const match = clusters.find(c => (c.subCatalysts ?? []).some(s => s.name === subName));
    if (!match) {
      const names = clusters.flatMap(c => (c.subCatalysts ?? []).map(s => s.name));
      throw new Error(`No cluster owns sub-catalyst "${subName}". Available: ${names.join(', ')}`);
    }
    return match;
  }

  /** Execute a reconciliation sub-catalyst by display name; returns its run id. */
  async executeSubCatalyst(subName: string): Promise<{ runId: string; status: string }> {
    const cluster = await this.resolveCluster(subName);
    const enc = encodeURIComponent(subName);
    const resp = await this.authedFetch(
      `/api/v1/catalysts/clusters/${cluster.id}/sub-catalysts/${enc}/execute`,
      { method: 'POST' },
    );
    if (!resp.ok) throw new Error(`execute "${subName}" failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { run_id?: string; id?: string; status?: string };
    const runId = data.run_id ?? data.id;
    if (!runId) throw new Error(`execute "${subName}" returned no run id: ${JSON.stringify(data)}`);
    return { runId, status: data.status ?? 'unknown' };
  }

  async getRunItemTotals(runId: string): Promise<RunItemTotals> {
    const resp = await this.authedFetch(`/api/v1/catalysts/runs/${runId}/items?limit=1`);
    if (!resp.ok) throw new Error(`getRunItems failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { totals?: RunItemTotals };
    if (!data.totals) throw new Error(`run ${runId} returned no totals`);
    return data.totals;
  }

  /**
   * Fetch run items plus totals in one call. `totals.unmatched` conflates both
   * sides of a two-sided reconciliation (e.g. bank: unmatched bank lines AND
   * unmatched book entries), so the per-item `item_status` breakdown is the only
   * way to recover the source-side count the oracle models.
   */
  async getRun(runId: string, limit = 300): Promise<{ totals: RunItemTotals; items: RunItem[] }> {
    const resp = await this.authedFetch(`/api/v1/catalysts/runs/${runId}/items?limit=${limit}`);
    if (!resp.ok) throw new Error(`getRun failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { totals?: RunItemTotals; items?: RunItem[] };
    if (!data.totals) throw new Error(`run ${runId} returned no totals`);
    return { totals: data.totals, items: data.items ?? [] };
  }

  async getAssessment(id: string): Promise<{ businessReportKey: string | null }> {
    const resp = await this.authedFetch(`/api/v1/assessments/${id}`);
    if (!resp.ok) throw new Error(`getAssessment(${id}) failed (${resp.status}): ${await resp.text()}`);
    return resp.json() as Promise<{ businessReportKey: string | null }>;
  }

  async getBusinessReport(id: string): Promise<{ status: number; contentType: string; head: string }> {
    const resp = await this.authedFetch(`/api/v1/assessments/${id}/report/business`);
    const buf = resp.ok ? Buffer.from(await resp.arrayBuffer()) : Buffer.alloc(0);
    return {
      status: resp.status,
      contentType: resp.headers.get('content-type') ?? '',
      head: buf.subarray(0, 5).toString('latin1'),
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Verify-ops: SETUP_SECRET deploy-tooling that drives the live synthesis→
  // billing chain (admin-ops route). No tenant auth — secret-gated.
  // ────────────────────────────────────────────────────────────────────────

  /** POST a verify-ops op with the SETUP_SECRET header + tenant slug. */
  private async verifyOps<T>(op: string, extra: Record<string, unknown> = {}): Promise<T> {
    if (!CONFIG.setupSecret) {
      throw new Error(`VERIFY_SETUP_SECRET is not set — cannot call verify-ops/${op}.`);
    }
    const resp = await fetchRetry(`${this.baseUrl}/api/v1/admin/verify-ops/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Secret': CONFIG.setupSecret },
      body: JSON.stringify({ tenant_slug: CONFIG.tenantSlug, ...extra }),
    });
    if (!resp.ok) throw new Error(`verify-ops/${op} failed (${resp.status}): ${await resp.text()}`);
    return resp.json() as Promise<T>;
  }

  /** Run the live phase-10 synthesis chain for the configured tenant. */
  async runPhase10Chain(): Promise<{ ok: boolean; chain_result: unknown }> {
    return this.verifyOps('run-phase10-chain');
  }

  /** Resolve a synthesized RCA so it clears billing's status gate. */
  async resolveRca(rcaId: string): Promise<{ ok: boolean; resolved: boolean }> {
    return this.verifyOps('resolve-rca', { rca_id: rcaId });
  }

  /** Create a prescription-linked completed (unverified) action for an RCA. */
  async createCompletedAction(rcaId: string): Promise<{ ok: boolean; action_id: string; prescription_id: string }> {
    return this.verifyOps('create-completed-action', { rca_id: rcaId });
  }

  /** Run action verification (cron parity). */
  async runActionVerification(): Promise<{ ok: boolean; counts: VerifyCounts }> {
    return this.verifyOps('run-action-verification');
  }

  // ── Diagnostics + billing reads (tenant-auth) ───────────────────────────

  /** Active (synthesized) RCAs. */
  async listActiveRcas(): Promise<RcaSummary[]> {
    // No trailing slash before the query — Hono's get('/') under the mount
    // basePath does not match `/api/v1/diagnostics/`, which 404s.
    const resp = await this.authedFetch('/api/v1/diagnostics?status=active&limit=100');
    if (!resp.ok) throw new Error(`listActiveRcas failed (${resp.status}): ${await resp.text()}`);
    const json = await resp.json() as { analyses: RcaSummary[] };
    return json.analyses;
  }

  /** Full RCA + causal-factor chain. */
  async getRcaChain(rcaId: string): Promise<RcaChain> {
    const resp = await this.authedFetch(`/api/v1/diagnostics/rca/${rcaId}/chain`);
    if (!resp.ok) throw new Error(`getRcaChain(${rcaId}) failed (${resp.status}): ${await resp.text()}`);
    return resp.json() as Promise<RcaChain>;
  }

  /** Non-destructive billing preview for a period (persist:false). */
  async getBillingPreview(from: string, to: string): Promise<BillingPeriod> {
    const resp = await this.authedFetch(`/api/v1/billing/period?from=${from}&to=${to}`);
    if (!resp.ok) throw new Error(`getBillingPreview failed (${resp.status}): ${await resp.text()}`);
    const json = await resp.json() as { period: BillingPeriod };
    return json.period;
  }

  // ── Catalyst execute sweep (B) ──────────────────────────────────────────

  /** Every ENABLED sub-catalyst across all clusters, with its owning cluster id. */
  async enabledSubCatalysts(): Promise<Array<{ clusterId: string; name: string }>> {
    const clusters = await this.listClusters();
    return clusters.flatMap(cl =>
      (cl.subCatalysts ?? [])
        .filter(s => s.enabled)
        .map(s => ({ clusterId: cl.id, name: s.name })),
    );
  }

  /**
   * Execute a sub-catalyst and return the raw HTTP status + parsed body. Unlike
   * executeSubCatalyst, does NOT throw on non-2xx — the B sweep needs to treat a
   * 400 ("No data sources configured" / disabled) as a skip rather than a failure.
   */
  async executeRaw(clusterId: string, subName: string): Promise<{ httpStatus: number; result: ExecutionResult }> {
    const enc = encodeURIComponent(subName);
    const resp = await this.authedFetch(
      `/api/v1/catalysts/clusters/${clusterId}/sub-catalysts/${enc}/execute`,
      { method: 'POST' },
    );
    let result: ExecutionResult = {};
    try { result = await resp.json() as ExecutionResult; } catch { /* non-JSON error body */ }
    return { httpStatus: resp.status, result };
  }
}

/** Reconciliation sub-catalyst display names (must match seeded `name` fields). */
export const RECON_SUBCATALYSTS = {
  grir: 'GR/IR Reconciliation',
  bank: 'Bank Reconciliation',
  inventory: 'Inventory Reconciliation',
  salesOrder: 'Sales Order Matching',
} as const;
