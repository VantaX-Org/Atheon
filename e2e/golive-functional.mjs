// Go-live FUNCTIONAL test — drives the deployed prod SPA as a real operator and
// exercises behaviour, not just render. Checks: login, Overnight Receipt headline
// + expand + honest copy, persona lens switching produces distinct content, hash
// drilldowns, honesty-law DOM scan (no fabricated "R 0" where a "—" is owed),
// /console tabs, zero console/page errors on every surface.
//
//   cd e2e && AV_EMAIL=… AV_PASS=… node golive-functional.mjs
import { chromium } from 'playwright';

const BASE = process.env.AV_BASE || 'https://atheon.vantax.co.za';
const EMAIL = process.env.AV_EMAIL;
const PASS = process.env.AV_PASS;
const SHOTS = process.env.AV_SHOTS || '/private/tmp/claude-501/-Users-reshigan-Atheon/57254b58-3ed2-4bf9-b614-e5d3426ad4a5/scratchpad/golive-fn';
if (!EMAIL || !PASS) { console.error('AV_EMAIL / AV_PASS required'); process.exit(2); }

const PERSONAS = ['board', 'ceo', 'cfo', 'coo', 'cpo', 'controller', 'fm', 'ap', 'tax', 'ops'];
const pass = []; const fail = [];
const ok = (name, cond, detail = '') => { (cond ? pass : fail).push({ name, detail }); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message || '').slice(0, 160)));

async function settle() {
  await page.waitForFunction(() => (document.body?.innerText || '').replace(/\s+/g, '').length > 400, { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
}
const text = () => page.evaluate(() => document.body.innerText);

// ── 1. Login ──
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"], input[name="password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }).catch(() => {});
ok('login redirects off /login', !/\/login/.test(page.url()), page.url());
if (/\/login/.test(page.url())) { await browser.close(); process.exit(2); }

// ── 2. /x brief loads + Overnight Receipt ──
await page.goto(`${BASE}/x`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await settle();
const receipt = page.locator('.overnight-receipt');
const hasReceipt = await receipt.count() > 0;
ok('overnight receipt renders on /x', hasReceipt);
if (hasReceipt) {
  const headline = (await page.locator('.or-headline').innerText().catch(() => '')).trim();
  ok('receipt headline present', headline.length > 10, headline);
  // Honesty: "recovered" only if a real verified number backs it; otherwise "surfaced"/"all clean".
  const kicker = (await page.locator('.or-kicker').innerText().catch(() => '')).toLowerCase();
  ok('receipt kicker = sealed receipt', kicker.includes('sealed'), kicker);
  // Expand
  await page.locator('.or-main').click();
  await page.waitForTimeout(300);
  const runsVisible = await page.locator('.or-runs').count() > 0;
  ok('receipt expands to per-run detail', runsVisible);
  const runRows = await page.locator('.or-run').count();
  ok('receipt shows individual run rows', runRows > 0, `${runRows} runs`);
  const proof = await page.locator('.or-proof').count() > 0;
  ok('receipt links to sealed ledger', proof);
  await page.locator('.or-main').click(); // collapse
}
await page.screenshot({ path: `${SHOTS}/x-receipt-open.png`, fullPage: true });

// ── 3. Persona lens switching yields distinct content ──
const fingerprints = {};
for (const p of PERSONAS) {
  const before = errors.length;
  await page.goto(`${BASE}/x?as=${p}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle();
  const t = await text();
  fingerprints[p] = t.replace(/\s+/g, '').length;
  ok(`persona ${p} renders`, fingerprints[p] > 400, `${fingerprints[p]} chars`);
  ok(`persona ${p} no new console errors`, errors.length === before, errors.slice(before).join(' | '));
}
// At least some personas should differ in content length (distinct lenses).
const distinct = new Set(Object.values(fingerprints)).size;
ok('persona lenses produce varied content', distinct > 1, `${distinct} distinct sizes across ${PERSONAS.length}`);

// ── 4. Hash drilldowns ──
for (const h of ['decisions', 'ledger', 'catalysts']) {
  const before = errors.length;
  await page.goto(`${BASE}/x#${h}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle();
  const t = await text();
  ok(`#${h} drilldown renders`, t.replace(/\s+/g, '').length > 400);
  ok(`#${h} no console errors`, errors.length === before, errors.slice(before).join(' | '));
}

// ── 5. Honesty-law DOM scan on /x ──
// A dashed metric (source hasn't reported) must render "—", never a fake "R 0".
// We can't prove intent from outside, but we CAN flag the smell: a metric labelled
// with a "no data"/"pending"/"not reported" qualifier that also shows a 0 value.
await page.goto(`${BASE}/x`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await settle();
const honesty = await page.evaluate(() => {
  const body = document.body.innerText;
  const dashCount = (body.match(/—/g) || []).length;
  // Smell: literal "R 0" adjacent to words implying absence-of-report rather than genuine-zero.
  const badPhrases = /(?:not reported|no data|pending sync|awaiting)[^\n]{0,40}R\s*0(?:\b|\.00)/gi;
  const smells = body.match(badPhrases) || [];
  return { dashCount, smells };
});
ok('honesty-law: dashes present for unreported sources', honesty.dashCount > 0, `${honesty.dashCount} em-dashes`);
ok('honesty-law: no "R 0" masquerading as unreported', honesty.smells.length === 0, honesty.smells.join(' | '));

// ── 6. /console admin hub + tabs ──
{
  const before = errors.length;
  await page.goto(`${BASE}/console`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle();
  const t = await text();
  ok('/console renders', t.replace(/\s+/g, '').length > 400);
  ok('/console shows tenants', /tenant/i.test(t));
  ok('/console no console errors', errors.length === before, errors.slice(before).join(' | '));
  // Click a couple of left-rail sections if present.
  for (const label of ['IAM', 'Revenue', 'Integrations']) {
    const link = page.getByText(label, { exact: true }).first();
    if (await link.count() > 0) {
      const b = errors.length;
      await link.click().catch(() => {});
      await page.waitForTimeout(600);
      ok(`/console → ${label} no error`, errors.length === b, errors.slice(b).join(' | '));
    }
  }
  await page.screenshot({ path: `${SHOTS}/console.png`, fullPage: true });
}

// ── Summary ──
console.log('\n=== FUNCTIONAL SUMMARY ===');
console.log(`pass=${pass.length} fail=${fail.length} totalConsoleErrors=${errors.length}`);
if (fail.length) console.log('FAILURES:\n' + JSON.stringify(fail, null, 2));
if (errors.length) console.log('CONSOLE ERRORS (first 8):\n' + errors.slice(0, 8).join('\n'));
await browser.close();
process.exit(fail.length ? 1 : 0);
