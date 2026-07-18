// Go-live live sweep — drives the deployed SPA (prod) as a real operator and
// reports per-route health + captures a screenshot of every surface for the
// review team. Current IA: the /x Recovery Console (persona-lensed + its
// sub-routes) and the /console admin hub. Creds come from env ONLY
// (AV_EMAIL / AV_PASS) — never hard-coded, never committed.
//
//   cd e2e && AV_EMAIL=… AV_PASS=… node ../scripts/validate-live.mjs
// (run from e2e/ so `playwright` resolves; screenshots land in SHOTS dir).
import { chromium } from 'playwright';

const BASE = process.env.AV_BASE || 'https://atheon.vantax.co.za';
const EMAIL = process.env.AV_EMAIL;
const PASS = process.env.AV_PASS;
const SHOTS = process.env.AV_SHOTS || '/private/tmp/claude-501/-Users-reshigan-Atheon/57254b58-3ed2-4bf9-b614-e5d3426ad4a5/scratchpad/golive';

if (!EMAIL || !PASS) { console.error('AV_EMAIL / AV_PASS required in env'); process.exit(2); }

const PERSONAS = ['board', 'ceo', 'cfo', 'coo', 'cpo', 'controller', 'fm', 'ap', 'tax', 'ops'];

// The current canonical surface. Persona lenses re-order the same /x console;
// sub-routes are the drill-downs; /console is the folded admin hub.
const ROUTES = [
  '/x',
  ...PERSONAS.map((p) => `/x?as=${p}`),
  '/x#decisions', '/x#ledger', '/x#catalysts',
  '/x/ops', '/x/findings', '/x/fixes', '/x/assurance', '/x/pulse', '/x/settings',
  '/console',
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
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 });
} catch {
  console.log('LOGIN_RESULT: did not redirect; url=' + page.url());
}
const loggedIn = !/\/login/.test(page.url());
console.log('LOGIN_OK:', loggedIn, 'url=', page.url());
if (!loggedIn) {
  console.log('LOGIN_BODY:', (await page.textContent('body'))?.slice(0, 300));
  await browser.close();
  process.exit(2);
}

// ── Sweep ──
const report = [];
let receiptSeen = false;
for (const route of ROUTES) {
  const errors = [];
  const onConsole = (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); };
  const onPageErr = (e) => errors.push('pageerror: ' + (e.message || String(e)).slice(0, 200));
  page.on('console', onConsole);
  page.on('pageerror', onPageErr);
  let status = 'ok';
  let receipt = null;
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // SPA hydrates async — wait for real content instead of a fixed sleep, so a
    // slow cold nav doesn't get mislabelled 'empty'. Falls through after 15s.
    await page.waitForFunction(
      () => (document.body?.innerText || '').replace(/\s+/g, '').length > 400,
      { timeout: 15000 },
    ).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const txt = (await page.textContent('body')) || '';
    const broken = /Something went wrong|Application error|TypeError|undefined is not|Cannot read|ChunkLoadError|chunk.*failed/i.test(txt);
    const mainLen = txt.replace(/\s+/g, '').length;
    if (broken) status = 'error-boundary';
    else if (mainLen < 200) status = 'empty';
    else if (errors.length) status = 'console-errors';
    // Overnight Receipt: honest presence check (only expected on the plain /x
    // brief, and only when scheduled runs exist — it's fine if absent).
    if (route === '/x') {
      receipt = await page.locator('.overnight-receipt').count() > 0;
      if (receipt) receiptSeen = true;
    }
    const f = `${SHOTS}/${route.replace(/[/?#=]/g, '_') || '_root'}.png`;
    await page.screenshot({ path: f, fullPage: true });
  } catch (e) {
    status = 'nav-fail';
    errors.push('nav: ' + (e.message || String(e)).slice(0, 160));
  }
  page.off('console', onConsole);
  page.off('pageerror', onPageErr);
  report.push({ route, status, receipt, errors: errors.slice(0, 4) });
  console.log(`${status === 'ok' ? '✓' : '✗'} ${route} [${status}]${receipt != null ? ` receipt=${receipt}` : ''}${errors.length ? ' ' + errors[0] : ''}`);
}

const bad = report.filter((r) => r.status !== 'ok');
console.log('\n=== SUMMARY ===');
console.log(`total=${report.length} ok=${report.length - bad.length} bad=${bad.length} receiptSeen=${receiptSeen}`);
console.log(JSON.stringify(bad, null, 2));
await browser.close();
