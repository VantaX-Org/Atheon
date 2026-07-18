/**
 * Seal completed recoveries into the provenance chain.
 *
 * Context: the value ledger renders every completed action as "● sealed" and
 * offers "Verify chain", but nothing was ever written to `provenance_chain`
 * on completion — the seal function (appendEvent) had no callers. That made
 * the "sealed, verifiable provenance" claim UI-only: the chain was empty.
 *
 * This closes the loop with a single idempotent reconciliation instead of
 * instrumenting the ~5 scattered completion write-sites. It finds genuine
 * completed recoveries that don't yet have an `action.sealed` chain entry and
 * appends one for each, in completed_at order so the chain's seq reflects
 * recovery chronology. It back-seals existing completions AND catches every
 * future one on the next tick — self-healing, safe to re-run.
 *
 * "Genuine recovery" matches ROI attribution: status completed/verified,
 * a positive value, and not a verification we couldn't stand behind
 * (failed/skipped/deferred). The NULL-safe predicate is deliberate — a plain
 * `verification_status NOT IN (...)` would silently drop the un-verified rows.
 */
import { appendEvent, type AppendOptions } from './provenance-ledger';
import { logInfo, logError } from './logger';
import type { Env } from '../types';

interface SealableAction {
  id: string;
  catalyst_name: string | null;
  action_type: string | null;
  value_zar: number | null;
  completed_at: string | null;
  verification_status: string | null;
  approved_by: string | null;
}

export async function sealCompletedActions(
  env: Env,
  tenantId: string,
): Promise<{ scanned: number; alreadySealed: number; sealed: number }> {
  const out = { scanned: 0, alreadySealed: 0, sealed: 0 };
  try {
    // 1. Action ids already sealed — one small read, avoids double-sealing.
    const sealedRows = await env.DB.prepare(
      `SELECT payload_json FROM provenance_chain
        WHERE tenant_id = ? AND payload_type = 'action.sealed'`,
    ).bind(tenantId).all<{ payload_json: string }>();
    const already = new Set<string>();
    for (const r of sealedRows.results || []) {
      try {
        const id = (JSON.parse(r.payload_json) as { action_id?: string }).action_id;
        if (id) already.add(id);
      } catch { /* tolerate a malformed row — worst case we re-seal it once */ }
    }
    out.alreadySealed = already.size;

    // 2. Genuine completed recoveries, oldest first so seq follows chronology.
    const acts = await env.DB.prepare(
      `SELECT id, catalyst_name, action_type, value_zar, completed_at,
              verification_status, approved_by
         FROM catalyst_actions
        WHERE tenant_id = ?
          AND status IN ('completed', 'verified')
          AND value_zar IS NOT NULL AND value_zar > 0
          AND (verification_status IS NULL
               OR verification_status NOT IN ('failed', 'skipped', 'deferred'))
        ORDER BY COALESCE(completed_at, created_at) ASC, id ASC`,
    ).bind(tenantId).all<SealableAction>();
    out.scanned = (acts.results || []).length;

    // 3. Seal each unsealed action. Sequential — appendEvent reads the chain
    //    tip to derive seq/merkle, so concurrent appends would collide.
    for (const a of acts.results || []) {
      if (already.has(a.id)) continue;
      const opts: AppendOptions = {};
      if (a.completed_at) opts.createdAt = a.completed_at;
      if (a.approved_by) opts.signedByUserId = a.approved_by;
      await appendEvent(env, tenantId, 'action.sealed', {
        action_id: a.id,
        catalyst_name: a.catalyst_name,
        action_type: a.action_type,
        value_zar: a.value_zar,
        completed_at: a.completed_at,
        verification_status: a.verification_status,
      }, opts);
      out.sealed++;
    }

    if (out.sealed > 0) {
      logInfo('provenance.seal_completions', { tenantId, layer: 'provenance', action: 'seal' }, out);
    }
  } catch (err) {
    logError('provenance.seal_completions_failed', err, { tenantId }, {});
  }
  return out;
}
