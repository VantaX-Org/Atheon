/**
 * Env-driven config for the deployed-API verification suites.
 * Credentials are NEVER hardcoded — the seeded vantax users are provisioned
 * out-of-band, so real creds come from CI secrets / the runbook operator.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `Missing required env var ${name}. Set it before running the verification suite ` +
      `(see docs/runbooks/go-live.md).`,
    );
  }
  return v.trim();
}

function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

export const CONFIG = {
  apiUrl: optionalEnv('VERIFY_API_URL', 'https://atheon-api.vantax.co.za'),
  appUrl: optionalEnv('VERIFY_APP_URL', 'https://atheon.vantax.co.za'),
  tenantSlug: optionalEnv('VERIFY_TENANT_SLUG', 'vantax'),
  get adminEmail() { return requireEnv('VERIFY_ADMIN_EMAIL'); },
  get adminPassword() { return requireEnv('VERIFY_ADMIN_PASSWORD'); },
  // v40 mandatory-MFA makes a bare password login for an admin-tier account
  // return 403 once its 14-day grace expires. Two optional, security-preserving
  // ways for CI to authenticate without weakening the control for real users:
  //   1. VERIFY_DEMO_SECRET — the X-Demo-Secret for POST /auth/demo-login, the
  //      purpose-built automation path (disabled in production, secret-gated).
  //      Preferred: needs no MFA state on the account.
  //   2. VERIFY_ADMIN_TOTP_SEED — base32 TOTP seed for the admin account when it
  //      has MFA enabled; lets the gate complete the real /login -> /mfa/validate
  //      challenge exactly as a human admin would.
  demoSecret: optionalEnv('VERIFY_DEMO_SECRET', ''),
  adminTotpSeed: optionalEnv('VERIFY_ADMIN_TOTP_SEED', ''),
  // SETUP_SECRET for the verify-ops admin endpoints (synthesis/billing chain).
  setupSecret: optionalEnv('VERIFY_SETUP_SECRET', ''),
  // Optional — only needed by the second-tenant isolation enhancement.
  superadminEmail: optionalEnv('VERIFY_SUPERADMIN_EMAIL', ''),
  superadminPassword: optionalEnv('VERIFY_SUPERADMIN_PASSWORD', ''),
  d1DatabaseName: optionalEnv('VERIFY_D1_DB', 'atheon-db'),
} as const;
