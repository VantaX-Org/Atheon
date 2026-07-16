import { chromium } from 'playwright';

const BASE = 'https://atheon.vantax.co.za';
const EMAIL = process.env.AV_EMAIL;
const PASS = process.env.AV_PASS;

const ROUTES = [
  '/brief', '/outlook', '/decisions',
  '/dashboard', '/apex', '/roi-dashboard', '/board-digest', '/pulse', '/catalysts',
  '/mind', '/memory', '/connectivity', '/compliance', '/trust', '/settings',
  '/tenants', '/iam', '/control-plane', '/integrations', '/action-layer',
  '/deployments', '/assessments', '/executive-summary', '/platform-health',
  '/support', '/impersonate', '/bulk-users', '/custom-roles', '/revenue',
  '/feature-flags', '/integration-health', '/system-alerts', '/admin/incidents',
  '/webhooks', '/support-tickets', '/support-triage', '/company-health',
  '/security', '/performance', '/status', '/data-governance',
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// ── Login ──
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"], input[name="password"]', PASS);
await page.click('button[type="submit"]');
try {
  await page.waitForURL(/\/(dashboard|apex|compliance|board-digest)/, { timeout: 30000 });
} catch {
  console.log('LOGIN_RESULT: did not redirect; url=' + page.url());
}
const loggedIn = !/\/login/.test(page.url());
console.log('LOGIN_OK:', loggedIn, 'url=', page.url());
if (!loggedIn) {
  const body = (await page.textContent('body'))?.slice(0, 300);
  console.log('LOGIN_BODY:', body);
  await browser.close();
  process.exit(2);
}

// ── Sweep ──
const report = [];
for (const route of ROUTES) {
  const errors = [];
  const onConsole = (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); };
  const onPageErr = (e) => errors.push('pageerror: ' + (e.message || String(e)).slice(0, 200));
  page.on('console', onConsole);
  page.on('pageerror', onPageErr);
  let status = 'ok';
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1200);
    const txt = (await page.textContent('body')) || '';
    const broken = /Something went wrong|Application error|TypeError|undefined is not|Cannot read|chunk.*failed|ChunkLoadError/i.test(txt);
    const mainLen = txt.replace(/\s+/g, '').length;
    if (broken) status = 'error-boundary';
    else if (mainLen < 200) status = 'empty';
    else if (errors.length) status = 'console-errors';
    if (status !== 'ok') {
      const f = `/tmp/av-${route.replace(/\//g, '_')}.png`;
      await page.screenshot({ path: f, fullPage: false });
    }
  } catch (e) {
    status = 'nav-fail';
    errors.push('nav: ' + (e.message || String(e)).slice(0, 160));
  }
  page.off('console', onConsole);
  page.off('pageerror', onPageErr);
  report.push({ route, status, errors: errors.slice(0, 4) });
  console.log(`${status === 'ok' ? '✓' : '✗'} ${route} [${status}]${errors.length ? ' ' + errors[0] : ''}`);
}

const bad = report.filter((r) => r.status !== 'ok');
console.log('\n=== SUMMARY ===');
console.log(`total=${report.length} ok=${report.length - bad.length} bad=${bad.length}`);
console.log(JSON.stringify(bad, null, 2));
await browser.close();
