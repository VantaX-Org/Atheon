/**
 * Catalyst DAG executor.
 *
 * When a sub-catalyst completes successfully, look up downstream dependencies
 * in `catalyst_dependencies` and enqueue the downstream sub-catalysts to run.
 *
 * Safety:
 * - MAX_CHAIN_DEPTH (5) bounds any accidental cycles — each enqueued
 *   downstream message carries an incremented `chainDepth`, and this
 *   function refuses to enqueue once the depth cap is reached.
 * - Every trigger (fired or skipped) writes an audit_log entry so
 *   operators can trace why a downstream ran.
 * - Queue binding is optional. If unavailable (tests, misconfig), we
 *   record the intended trigger in audit_log and return instead of
 *   throwing.
 */

import type { CatalystQueueMessage } from './scheduled';

export const MAX_CHAIN_DEPTH = 5;

export interface TriggerDownstreamInput {
  tenantId: string;
  upstreamClusterId: string;
  upstreamSubCatalystName: string;
  /** 0 for the root (user/scheduler-triggered) invocation. */
  chainDepth: number;
  /** Context carried from upstream, available to downstream runs. */
  parentContext?: Record<string, unknown>;
}

export interface TriggerDownstreamResult {
  enqueued: number;
  skipped: number;
  reason?: string;
}

interface DependencyRow {
  id: string;
  downstream_cluster_id: string | null;
  target_cluster_id: string | null;
  downstream_sub_name: string | null;
  target_sub_catalyst: string | null;
  strength: number | null;
  lag_hours: number | null;
  dependency_type: string | null;
}

async function logTriggerEvent(
  db: D1Database,
  tenantId: string,
  action: string,
  details: Record<string, unknown>,
  outcome: 'success' | 'failure' | 'skipped',
): Promise<void> {
  try {
    await db.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      tenantId,
      action,
      'catalysts',
      'dag',
      JSON.stringify(details),
      outcome,
    ).run();
  } catch { /* audit failures are non-fatal */ }
}

/**
 * Enqueue downstream sub-catalysts that depend on the just-completed one.
 * Safe to call without a queue binding — missing queues log the intent and
 * return with enqueued=0.
 */
export async function triggerDownstream(
  input: TriggerDownstreamInput,
  db: D1Database,
  queue?: Queue<CatalystQueueMessage>,
): Promise<TriggerDownstreamResult> {
  if (input.chainDepth >= MAX_CHAIN_DEPTH) {
    await logTriggerEvent(db, input.tenantId, 'catalyst.dag.trigger_blocked', {
      reason: 'max_chain_depth_reached',
      chainDepth: input.chainDepth,
      maxDepth: MAX_CHAIN_DEPTH,
      upstreamClusterId: input.upstreamClusterId,
      upstreamSubCatalyst: input.upstreamSubCatalystName,
    }, 'skipped');
    return { enqueued: 0, skipped: 0, reason: 'max_chain_depth_reached' };
  }

  // Look up deps with BOTH the v1 (source/target) and v2 (upstream/downstream)
  // column conventions so we work regardless of which writer produced the row.
  const rows = await db.prepare(
    `SELECT id,
            downstream_cluster_id,
            target_cluster_id,
            downstream_sub_name,
            target_sub_catalyst,
            strength,
            lag_hours,
            dependency_type
     FROM catalyst_dependencies
     WHERE tenant_id = ?
       AND (
         (upstream_cluster_id = ? AND upstream_sub_name = ?)
         OR (source_cluster_id = ? AND source_sub_catalyst = ?)
       )`,
  ).bind(
    input.tenantId,
    input.upstreamClusterId, input.upstreamSubCatalystName,
    input.upstreamClusterId, input.upstreamSubCatalystName,
  ).all<DependencyRow>();

  if (!rows.results || rows.results.length === 0) {
    return { enqueued: 0, skipped: 0 };
  }

  let enqueued = 0;
  let skipped = 0;

  for (const dep of rows.results) {
    const downstreamClusterId = dep.downstream_cluster_id || dep.target_cluster_id;
    const downstreamSub = dep.downstream_sub_name || dep.target_sub_catalyst;
    if (!downstreamClusterId || !downstreamSub) {
      skipped++;
      continue;
    }

    // Cycle short-circuit: don't re-trigger the same (cluster, sub) we just
    // ran, even if someone mis-configured a self-loop.
    if (downstreamClusterId === input.upstreamClusterId && downstreamSub === input.upstreamSubCatalystName) {
      skipped++;
      await logTriggerEvent(db, input.tenantId, 'catalyst.dag.trigger_blocked', {
        reason: 'self_reference_skipped',
        depId: dep.id,
        upstreamClusterId: input.upstreamClusterId,
        upstreamSubCatalyst: input.upstreamSubCatalystName,
      }, 'skipped');
      continue;
    }

    if (!queue) {
      // No queue binding available — log intent and move on. Lets the code
      // run under tests that don't provide CATALYST_QUEUE.
      skipped++;
      await logTriggerEvent(db, input.tenantId, 'catalyst.dag.trigger_no_queue', {
        depId: dep.id,
        downstreamClusterId,
        downstreamSub,
        chainDepth: input.chainDepth + 1,
      }, 'skipped');
      continue;
    }

    const message: CatalystQueueMessage = {
      type: 'catalyst_execution',
      tenantId: input.tenantId,
      payload: {
        clusterId: downstreamClusterId,
        catalystName: downstreamSub,
        action: downstreamSub.toLowerCase().replace(/\s+/g, '_'),
        inputData: {
          triggeredBy: 'dag',
          upstreamClusterId: input.upstreamClusterId,
          upstreamSubCatalyst: input.upstreamSubCatalystName,
          dependencyId: dep.id,
          dependencyType: dep.dependency_type || 'data_flow',
          parentContext: input.parentContext || {},
          chainDepth: input.chainDepth + 1,
        },
        riskLevel: 'medium',
        autonomyTier: 'assisted',
        trustScore: 60,
      },
      scheduledAt: new Date().toISOString(),
    };

    try {
      await queue.send(message);
      enqueued++;
      await logTriggerEvent(db, input.tenantId, 'catalyst.dag.triggered', {
        depId: dep.id,
        upstreamClusterId: input.upstreamClusterId,
        upstreamSubCatalyst: input.upstreamSubCatalystName,
        downstreamClusterId,
        downstreamSub,
        chainDepth: input.chainDepth + 1,
        dependencyType: dep.dependency_type,
      }, 'success');
    } catch (err) {
      skipped++;
      await logTriggerEvent(db, input.tenantId, 'catalyst.dag.trigger_failed', {
        depId: dep.id,
        downstreamClusterId,
        downstreamSub,
        error: (err as Error).message,
      }, 'failure');
    }
  }

  return { enqueued, skipped };
}

/**
 * Cycle detection for dependency CRUD. Returns true if adding an edge from
 * upstream -> downstream would create a cycle (downstream can already reach
 * upstream via existing deps). Uses BFS; bounded by MAX_CHAIN_DEPTH * N so
 * large graphs stay fast.
 */
export async function wouldCreateCycle(
  tenantId: string,
  upstreamClusterId: string,
  upstreamSubCatalyst: string,
  downstreamClusterId: string,
  downstreamSubCatalyst: string,
  db: D1Database,
): Promise<boolean> {
  // Self-loop is always a cycle.
  if (upstreamClusterId === downstreamClusterId && upstreamSubCatalyst === downstreamSubCatalyst) {
    return true;
  }

  // BFS from downstream following outgoing edges; if we reach upstream, we have a cycle.
  const visited = new Set<string>();
  const key = (cid: string, sub: string): string => `${cid}::${sub}`;
  const queue: Array<{ clusterId: string; sub: string }> = [
    { clusterId: downstreamClusterId, sub: downstreamSubCatalyst },
  ];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const nodeKey = key(node.clusterId, node.sub);
    if (visited.has(nodeKey)) continue;
    visited.add(nodeKey);
    if (visited.size > 500) return false; // safety valve — graph too big to fully scan, assume no cycle

    if (node.clusterId === upstreamClusterId && node.sub === upstreamSubCatalyst) {
      return true;
    }

    const next = await db.prepare(
      `SELECT downstream_cluster_id, target_cluster_id, downstream_sub_name, target_sub_catalyst
       FROM catalyst_dependencies
       WHERE tenant_id = ?
         AND ((upstream_cluster_id = ? AND upstream_sub_name = ?)
              OR (source_cluster_id = ? AND source_sub_catalyst = ?))`,
    ).bind(
      tenantId,
      node.clusterId, node.sub,
      node.clusterId, node.sub,
    ).all<{
      downstream_cluster_id: string | null;
      target_cluster_id: string | null;
      downstream_sub_name: string | null;
      target_sub_catalyst: string | null;
    }>();

    for (const row of next.results) {
      const dsCluster = row.downstream_cluster_id || row.target_cluster_id;
      const dsSub = row.downstream_sub_name || row.target_sub_catalyst;
      if (dsCluster && dsSub) {
        queue.push({ clusterId: dsCluster, sub: dsSub });
      }
    }
  }
  return false;
}
