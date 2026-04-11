// TASK-028: Agent Sidecar Hardening
export async function healthCheck(env: { DB: D1Database; CACHE: KVNamespace }): Promise<{
  status: 'healthy' | 'degraded' | 'error';
  checks: Record<string, { ok: boolean; latency_ms: number }>;
}> {
  const checks: Record<string, { ok: boolean; latency_ms: number }> = {};
  
  const dbStart = Date.now();
  try {
    await env.DB.prepare('SELECT 1').first();
    checks.database = { ok: true, latency_ms: Date.now() - dbStart };
  } catch {
    checks.database = { ok: false, latency_ms: Date.now() - dbStart };
  }
  
  const kvStart = Date.now();
  try {
    await env.CACHE.put('agent:health', '1', { expirationTtl: 60 });
    checks.kv = { ok: true, latency_ms: Date.now() - kvStart };
  } catch {
    checks.kv = { ok: false, latency_ms: Date.now() - kvStart };
  }
  
  const allOk = Object.values(checks).every(c => c.ok);
  return { status: allOk ? 'healthy' : 'error', checks };
}

export function validateAgentPayload(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!payload || typeof payload !== 'object') {
    errors.push('Payload must be a JSON object');
    return { valid: false, errors };
  }
  const p = payload as Record<string, unknown>;
  if (!p.action || typeof p.action !== 'string') errors.push('action field required');
  return { valid: errors.length === 0, errors };
}
