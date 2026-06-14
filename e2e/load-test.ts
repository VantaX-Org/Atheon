/**
 * Atheon Load Test Script
 * Simulates concurrent API requests to validate performance under load.
 * Run with: npx tsx e2e/load-test.ts [baseUrl] [concurrency] [duration_seconds]
 *
 * Default: 10 concurrent users, 30 seconds, against localhost:8787
 */

const BASE_URL = process.argv[2] || 'https://atheon-api.vantax.co.za';
const CONCURRENCY = parseInt(process.argv[3] || '10', 10);
const DURATION_SECONDS = parseInt(process.argv[4] || '30', 10);

// Creds come from the env — the gate injects real seeded users. Never hardcode a
// password. With no creds the script degrades to public endpoints only; the
// authenticated probes then 401, which is the correct signal that creds are absent.
const LOGIN_EMAIL = process.env.LOAD_EMAIL ?? '';
const LOGIN_PASSWORD = process.env.LOAD_PASSWORD ?? '';
const LOGIN_TENANT = process.env.LOAD_TENANT || 'vantax';
const HAS_CREDS = LOGIN_EMAIL !== '' && LOGIN_PASSWORD !== '';
const LOGIN_BODY = { email: LOGIN_EMAIL, password: LOGIN_PASSWORD, tenant_slug: LOGIN_TENANT };

// v40 mandatory-MFA: an admin-tier account's bare password login returns 403
// once its grace expires, which would make EVERY auth request an "error" and
// wedge the load gate on a control that is working as designed. When a demo
// secret is supplied (the same secret-gated, prod-disabled path the matrices
// use) we authenticate — and load-test the auth endpoint — via /auth/demo-login
// instead, which returns a real token without weakening the MFA control.
const LOGIN_DEMO_SECRET = process.env.LOAD_DEMO_SECRET ?? '';
const LOGIN_DEMO_ROLE = process.env.LOAD_DEMO_ROLE || 'admin';
const HAS_DEMO_SECRET = LOGIN_DEMO_SECRET !== '';
const DEMO_LOGIN_BODY = { tenant_slug: LOGIN_TENANT, role: LOGIN_DEMO_ROLE };

type AuthEndpoint = { method: string; path: string; auth: boolean; body?: Record<string, string>; headers?: Record<string, string> };

const DEMO_AUTH_ENDPOINT: AuthEndpoint = {
  method: 'POST',
  path: '/api/v1/auth/demo-login',
  auth: false,
  body: DEMO_LOGIN_BODY as Record<string, string>,
  headers: { 'X-Demo-Secret': LOGIN_DEMO_SECRET },
};
const PASSWORD_AUTH_ENDPOINT: AuthEndpoint = {
  method: 'POST',
  path: '/api/v1/auth/login',
  auth: false,
  body: LOGIN_BODY,
};

// The auth endpoint exercised under load is resolved at RUNTIME (see resolveAuth):
// prefer demo-login, but in production it returns 404 (disabled) so we fall back
// to the password login. Resolving by probing — instead of statically by which
// env vars are present — keeps the load endpoint pointed at a path that actually
// returns 200, so a prod-disabled demo route doesn't poison the error rate.
let AUTH_ENDPOINT: AuthEndpoint = HAS_DEMO_SECRET ? DEMO_AUTH_ENDPOINT : PASSWORD_AUTH_ENDPOINT;

interface LoadTestResult {
  endpoint: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  requestsPerSecond: number;
}

/** Endpoints to test (public + authenticated). Built after auth is resolved so
 *  the auth slot points at the path that actually returns 200. */
function buildEndpoints(authEp: AuthEndpoint) {
  return [
    { method: 'GET', path: '/healthz', auth: false },
    { method: 'GET', path: '/', auth: false },
    authEp,
    { method: 'GET', path: '/api/v1/apex/health', auth: true },
    { method: 'GET', path: '/api/v1/pulse/metrics', auth: true },
    { method: 'GET', path: '/api/v1/catalysts/clusters', auth: true },
    { method: 'GET', path: '/api/v1/erp/adapters', auth: true },
    { method: 'GET', path: '/api/v1/notifications', auth: true },
  ];
}

/**
 * Perform a single HTTP request and measure latency.
 * @param endpoint - Endpoint configuration
 * @param token - JWT token for authenticated requests
 * @returns Latency in milliseconds, or -1 on error
 */
async function makeRequest(
  endpoint: { method: string; path: string; auth: boolean; body?: Record<string, string>; headers?: Record<string, string> },
  token: string | null,
): Promise<{ latencyMs: number; success: boolean; status: number }> {
  const url = `${BASE_URL}${endpoint.path}`;
  const headers: Record<string, string> = { ...(endpoint.headers || {}) };
  if (endpoint.auth && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (endpoint.body) {
    headers['Content-Type'] = 'application/json';
  }

  const start = performance.now();
  try {
    const resp = await fetch(url, {
      method: endpoint.method,
      headers,
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
    });
    const latencyMs = performance.now() - start;
    return { latencyMs, success: resp.ok, status: resp.status };
  } catch {
    const latencyMs = performance.now() - start;
    return { latencyMs, success: false, status: 0 };
  }
}

/**
 * Calculate percentile from a sorted array of numbers.
 * @param sorted - Sorted array of latency values
 * @param percentile - Target percentile (0-100)
 * @returns Value at the given percentile
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Run the load test.
 */
async function runLoadTest(): Promise<void> {
  console.log(`\n🔄 Atheon Load Test`);
  console.log(`   Base URL:    ${BASE_URL}`);
  console.log(`   Concurrency: ${CONCURRENCY}`);
  console.log(`   Duration:    ${DURATION_SECONDS}s`);
  console.log(`   Endpoints:   ${buildEndpoints(AUTH_ENDPOINT).length}\n`);

  // Step 1: Resolve the auth path by probing, then acquire the warmup token.
  // Order: demo-login first (if a secret is supplied), and on a 404 — demo-login
  // is disabled in production — fall back to the bare password login. Whichever
  // returns 200 becomes AUTH_ENDPOINT, so the path exercised under load is one
  // that actually succeeds (a prod-disabled demo route would otherwise count as
  // an error on every hit and wedge the gate).
  async function attemptLogin(ep: AuthEndpoint): Promise<{ status: number; token: string | null }> {
    const resp = await fetch(`${BASE_URL}${ep.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ep.headers || {}) },
      body: JSON.stringify(ep.body),
    });
    if (!resp.ok) return { status: resp.status, token: null };
    const data = await resp.json() as { token?: string };
    return { status: resp.status, token: data.token || null };
  }

  let token: string | null = null;
  const candidates: AuthEndpoint[] = [];
  if (HAS_DEMO_SECRET) candidates.push(DEMO_AUTH_ENDPOINT);
  if (HAS_CREDS) candidates.push(PASSWORD_AUTH_ENDPOINT);

  if (candidates.length === 0) {
    console.log('   Auth: no LOAD_DEMO_SECRET and no LOAD_EMAIL/PASSWORD — public endpoints only\n');
  } else {
    for (const ep of candidates) {
      try {
        const { status, token: t } = await attemptLogin(ep);
        if (t) {
          token = t;
          AUTH_ENDPOINT = ep;
          console.log(`   Auth: Token acquired via ${ep.path}\n`);
          break;
        }
        console.log(`   Auth: ${ep.path} returned ${status} — ${ep === candidates[candidates.length - 1] ? 'proceeding with public endpoints only' : 'trying next auth path'}\n`);
      } catch {
        console.log(`   Auth: ${ep.path} request failed — ${ep === candidates[candidates.length - 1] ? 'proceeding with public endpoints only' : 'trying next auth path'}\n`);
      }
    }
  }

  const ENDPOINTS = buildEndpoints(AUTH_ENDPOINT);

  const results: Map<string, number[]> = new Map();
  const errors: Map<string, number> = new Map();
  const successes: Map<string, number> = new Map();

  for (const ep of ENDPOINTS) {
    results.set(ep.path, []);
    errors.set(ep.path, 0);
    successes.set(ep.path, 0);
  }

  // Warmup: the gate runs this immediately after a destructive tenant reseed, so
  // the first hit to each worker isolate / D1-heavy endpoint cold-starts and can
  // spike to tens of seconds before steady state. We measure STEADY-STATE, not
  // cold start: prime every endpoint with a couple of sequential passes and
  // discard the timings. Skipped when WARMUP_PASSES=0. This absorbs cold-start
  // artifacts without touching the thresholds (no gaming — the post-warmup
  // numbers are what real traffic sees once isolates are warm).
  const warmupPasses = parseInt(process.env.LOAD_WARMUP_PASSES || '2', 10);
  if (warmupPasses > 0) {
    console.log(`   Warmup: ${warmupPasses} concurrent pass(es) over ${ENDPOINTS.length} endpoints @ ${CONCURRENCY} workers (timings discarded)\n`);
    for (let pass = 0; pass < warmupPasses; pass++) {
      // Fire every endpoint CONCURRENCY-wide so the same isolate pool that serves
      // the measured phase is warm — a sequential pass primes only one isolate.
      await Promise.all(
        ENDPOINTS.flatMap((ep) =>
          Array.from({ length: CONCURRENCY }, () => makeRequest(ep, token)),
        ),
      );
    }
  }

  const endTime = Date.now() + DURATION_SECONDS * 1000;

  // Step 2: Run concurrent workers
  const workers = Array.from({ length: CONCURRENCY }, async (_elem, _idx) => {
    void _idx;
    while (Date.now() < endTime) {
      const ep = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
      const result = await makeRequest(ep, token);
      results.get(ep.path)?.push(result.latencyMs);
      if (result.success) {
        successes.set(ep.path, (successes.get(ep.path) || 0) + 1);
      } else {
        errors.set(ep.path, (errors.get(ep.path) || 0) + 1);
      }
    }
  });

  await Promise.all(workers);

  // Step 3: Calculate and print results
  console.log('─'.repeat(100));
  console.log(
    'Endpoint'.padEnd(35),
    'Reqs'.padStart(6),
    'OK'.padStart(6),
    'Err'.padStart(5),
    'Avg(ms)'.padStart(9),
    'P95(ms)'.padStart(9),
    'P99(ms)'.padStart(9),
    'Min(ms)'.padStart(9),
    'Max(ms)'.padStart(9),
    'RPS'.padStart(7),
  );
  console.log('─'.repeat(100));

  const summaryResults: LoadTestResult[] = [];

  for (const ep of ENDPOINTS) {
    const latencies = results.get(ep.path) || [];
    const sorted = [...latencies].sort((a, b) => a - b);
    const total = latencies.length;
    const ok = successes.get(ep.path) || 0;
    const err = errors.get(ep.path) || 0;
    const avg = total > 0 ? latencies.reduce((a, b) => a + b, 0) / total : 0;
    const rps = total / DURATION_SECONDS;

    const result: LoadTestResult = {
      endpoint: `${ep.method} ${ep.path}`,
      totalRequests: total,
      successCount: ok,
      errorCount: err,
      avgLatencyMs: Math.round(avg),
      p95LatencyMs: Math.round(percentile(sorted, 95)),
      p99LatencyMs: Math.round(percentile(sorted, 99)),
      minLatencyMs: Math.round(sorted[0] || 0),
      maxLatencyMs: Math.round(sorted[sorted.length - 1] || 0),
      requestsPerSecond: Math.round(rps * 10) / 10,
    };
    summaryResults.push(result);

    console.log(
      result.endpoint.padEnd(35),
      String(result.totalRequests).padStart(6),
      String(result.successCount).padStart(6),
      String(result.errorCount).padStart(5),
      String(result.avgLatencyMs).padStart(9),
      String(result.p95LatencyMs).padStart(9),
      String(result.p99LatencyMs).padStart(9),
      String(result.minLatencyMs).padStart(9),
      String(result.maxLatencyMs).padStart(9),
      String(result.requestsPerSecond).padStart(7),
    );
  }

  console.log('─'.repeat(100));

  // Summary
  const totalReqs = summaryResults.reduce((a, r) => a + r.totalRequests, 0);
  const totalErrors = summaryResults.reduce((a, r) => a + r.errorCount, 0);
  const avgRps = totalReqs / DURATION_SECONDS;
  const errorRate = totalReqs > 0 ? (totalErrors / totalReqs * 100).toFixed(2) : '0';

  console.log(`\n   Total Requests: ${totalReqs}`);
  console.log(`   Total Errors:   ${totalErrors} (${errorRate}%)`);
  console.log(`   Avg RPS:        ${Math.round(avgRps * 10) / 10}`);
  console.log(`   Duration:       ${DURATION_SECONDS}s\n`);

  // Pass/Fail criteria (env-overridable so the go-live gate can tighten/loosen
  // without code changes; defaults match the original hardcoded budget).
  const errorThreshold = parseFloat(process.env.LOAD_ERROR_THRESHOLD_PCT || '5'); // % error rate max
  const latencyThreshold = parseInt(process.env.LOAD_P99_THRESHOLD_MS || '5000', 10); // p99 ms max
  const p99Max = Math.max(...summaryResults.map(r => r.p99LatencyMs));

  if (parseFloat(errorRate) > errorThreshold) {
    console.log(`   FAIL: Error rate ${errorRate}% exceeds threshold ${errorThreshold}%`);
    process.exit(1);
  }
  if (p99Max > latencyThreshold) {
    console.log(`   FAIL: P99 latency ${p99Max}ms exceeds threshold ${latencyThreshold}ms`);
    process.exit(1);
  }

  console.log(`   PASS: Error rate ${errorRate}% and P99 ${p99Max}ms within thresholds`);
}

runLoadTest().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
