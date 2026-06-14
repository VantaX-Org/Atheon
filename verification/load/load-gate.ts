import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG } from '../config';

/**
 * Go-live load gate. Thin wrapper that drives the existing e2e/load-test.ts with
 * real seeded creds and a gentle default profile, then propagates its pass/fail
 * exit code. Keeping the measurement in one place (load-test.ts) avoids drift;
 * this file only supplies credentials, a profile, and the gate semantics.
 *
 * Profile and thresholds are env-overridable:
 *   LOAD_CONCURRENCY (default 5), LOAD_DURATION seconds (default 20),
 *   LOAD_ERROR_THRESHOLD_PCT, LOAD_P99_THRESHOLD_MS  (defaults live in load-test.ts)
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const LOAD_TEST = join(REPO_ROOT, 'e2e', 'load-test.ts');

const concurrency = process.env.LOAD_CONCURRENCY || '5';
const duration = process.env.LOAD_DURATION || '20';

// Hand load-test.ts BOTH auth paths when available and let it pick at runtime:
//   - demo-login (secret-gated, prod-disabled) is preferred where it works — it
//     needs no MFA state and is the same path the RBAC matrices use.
//   - in production demo-login returns 404 (disabled), so load-test.ts falls
//     back to the bare password login. That only succeeds for an account still
//     inside its 14-day mandatory-MFA grace; past grace it 403s, by design.
// Passing both means the gate authenticates in staging (demo) AND production
// (password) without weakening the MFA control. adminEmail/adminPassword are
// requireEnv getters that throw if unset — read them defensively so a missing
// password doesn't wedge the demo path that doesn't need it.
const childEnv: Record<string, string> = {
  ...process.env,
  LOAD_TENANT: CONFIG.tenantSlug,
};
if (CONFIG.demoSecret) {
  childEnv.LOAD_DEMO_SECRET = CONFIG.demoSecret;
  childEnv.LOAD_DEMO_ROLE = process.env.VERIFY_DEMO_ROLE || 'admin';
}
try {
  childEnv.LOAD_EMAIL = CONFIG.adminEmail;
  childEnv.LOAD_PASSWORD = CONFIG.adminPassword;
} catch {
  // No password creds configured — fine as long as the demo secret is present.
  if (!CONFIG.demoSecret) {
    console.error('load-gate: neither VERIFY_DEMO_SECRET nor VERIFY_ADMIN_EMAIL/PASSWORD set');
    process.exit(1);
  }
}

const child = spawn(TSX, [LOAD_TEST, CONFIG.apiUrl, concurrency, duration], {
  stdio: 'inherit',
  env: childEnv,
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error('load-gate: failed to spawn load test:', err);
  process.exit(1);
});
