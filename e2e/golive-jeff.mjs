// Jeff must answer live, grounded in real seeded Vantax data — never the
// "temporarily unavailable" / "could not answer" degrade, never a fabricated
// figure. Drives the real JeffLauncher slide-over on prod. Creds via env only.
import { chromium } from 'playwright';

const BASE = process.env.AV_BASE || 'https://atheon.vantax.co.za';
const EMAIL = process.env.AV_EMAIL, PASS = process.env.AV_PASS;
if (!EMAIL || !PASS) { console.error('AV_EMAIL / AV_PASS required'); process.exit(2); }
const pass = [], fail = [];
const ok = (n, c, d = '') => { (c ? pass : fail).push(n); console.log(`${c ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"], input[name="password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }).catch(() => {});
await page.goto(`${BASE}/x`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction(() => (document.body?.innerText || '').replace(/\s+/g, '').length > 400, { timeout: 15000 }).catch(() => {});

// Open Jeff (pill or floating launcher — both carry the aria-label).
const opener = page.locator('[aria-label="Ask Jeff — your assistant"]');
ok('Jeff launcher present', await opener.count() > 0);
await opener.first().click();
const box = page.locator('textarea[placeholder="Ask Jeff…"]');
await box.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
ok('Jeff composer opens', await box.count() > 0);

// Count assistant bubbles so we can wait for the NEXT one after each ask.
const answerSel = '[class*="whitespace-pre-line"]';
async function ask(q) {
  const before = await page.locator(answerSel).count();
  await box.fill(q);
  await box.press('Enter');
  // Answer can take a while (LLM-bound, 4–8s seen). Wait for a new bubble.
  await page.waitForFunction(
    ([sel, n]) => document.querySelectorAll(sel).length > n,
    [answerSel, before], { timeout: 45000 },
  ).catch(() => {});
  const bubbles = page.locator(answerSel);
  const c = await bubbles.count();
  return c > before ? (await bubbles.nth(c - 1).innerText()).trim() : '';
}

const DEGRADE = /temporarily unavailable|could not answer|try again|no data available|i (don'?t|do not) have access/i;

// Q1 — headline grounded question.
const a1 = await ask('What is our single biggest value leak right now, and roughly how much?');
ok('Jeff answered Q1 (biggest leak)', a1.length > 40 && !DEGRADE.test(a1), a1.slice(0, 110).replace(/\n/g, ' '));
// A grounded answer should carry a rand figure (R … ) drawn from real data.
ok('Q1 answer cites a real rand figure', /R\s?[\d.,]{3,}|\bmillion\b|\bthousand\b/i.test(a1), (a1.match(/R\s?[\d.,]{3,}/) || [''])[0]);

// Q2 — specific seeded fact (Vantax seed: inventory shrinkage, rand volatility).
const a2 = await ask('What does the macro/market radar say is our top external signal?');
ok('Jeff answered Q2 (radar signal)', a2.length > 30 && !DEGRADE.test(a2), a2.slice(0, 110).replace(/\n/g, ' '));

// Model chip present = a real model answered (honest provenance).
const chip = await page.locator('[title="Model that answered"]').last();
const model = (await chip.count()) > 0 ? (await chip.innerText()).trim() : '';
ok('Jeff shows the real answering model', model.length > 0, model);

ok('no console errors during Jeff session', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n=== JEFF SUMMARY === pass=${pass.length} fail=${fail.length}`);
if (fail.length) console.log('FAILURES: ' + fail.join(' | '));
await browser.close();
process.exit(fail.length ? 1 : 0);
