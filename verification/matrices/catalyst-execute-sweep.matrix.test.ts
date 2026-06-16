/**
 * B: execute-path catalyst sweep.
 *
 * For every ENABLED sub-catalyst, POST the live execute endpoint and assert:
 *   - HTTP 200 (the run executed)
 *   - the result status !== 'failed'
 *   - the payload is typed (carries a `mode` + an `executed_at` timestamp)
 * Sub-catalysts with no data sources configured / disabled return 400 and are
 * recorded as skipped (logged, not silently dropped).
 *
 * Flag-gated: only runs when VERIFY_CATALYST_SWEEP=1.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../lib/client';

const ENABLED = process.env.VERIFY_CATALYST_SWEEP === '1';
const d = ENABLED ? describe : describe.skip;

const client = new ApiClient();
let subs: Array<{ clusterId: string; name: string }> = [];

beforeAll(async () => {
  if (!ENABLED) return;
  await client.login();
  subs = await client.enabledSubCatalysts();
}, 60_000);

d('B: every enabled sub-catalyst executes through the live endpoint', () => {
  it('discovers enabled sub-catalysts', () => {
    expect(subs.length).toBeGreaterThan(0);
  });

  it('executes each enabled sub-catalyst with a typed, non-failed result', async () => {
    const skipped: string[] = [];
    const failed: string[] = [];
    let executed = 0;

    for (const { clusterId, name } of subs) {
      const { httpStatus, result } = await client.executeRaw(clusterId, name);

      // 400 "No data sources configured" / "Sub-catalyst is disabled" → skip, log.
      if (httpStatus === 400) {
        skipped.push(`${name}: ${result.error ?? 'bad request'}`);
        continue;
      }
      if (httpStatus !== 200) {
        failed.push(`${name}: HTTP ${httpStatus} ${result.error ?? ''}`.trim());
        continue;
      }

      executed++;
      if (result.status === 'failed') { failed.push(`${name}: status=failed ${result.error ?? ''}`.trim()); continue; }
      if (!result.mode) { failed.push(`${name}: missing typed payload (no mode)`); continue; }
      if (!result.executed_at) { failed.push(`${name}: missing executed_at`); }
    }

    // Explicit coverage reporting — no silent caps.
    console.log(`[B-sweep] enabled=${subs.length} executed=${executed} skipped=${skipped.length} failed=${failed.length}`);
    if (skipped.length) console.log(`[B-sweep] skipped:\n  ${skipped.join('\n  ')}`);
    if (failed.length) console.log(`[B-sweep] FAILED:\n  ${failed.join('\n  ')}`);

    expect(failed).toEqual([]);
  }, 600_000);
});
