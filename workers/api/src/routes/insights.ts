/**
 * Persona Insight Dashboards — spec §5.2.
 *
 *   GET /api/insights?persona=cfo
 *     → { persona, generated_from_assessment_id, insights: PersonaInsight[], external_pulse | null }
 *
 * Tenant-scoped via tenantIsolation; role-gated (executive roles + manager)
 * in index.ts. `persona` validated against the Persona union — 400 otherwise.
 * ponytail: no caching layer — reads are cheap D1 queries over one assessment
 * + one signals table; add KV cache if p95 > 500ms.
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { buildPersonaInsights, PERSONAS, type Persona } from '../services/persona-insights';

const insights = new Hono<AppBindings>();

insights.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const tenantId = auth?.tenantId || '';
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const persona = (c.req.query('persona') || '').toLowerCase();
  if (!PERSONAS.includes(persona as Persona)) {
    return c.json({ error: 'Invalid persona', valid: PERSONAS }, 400);
  }

  const result = await buildPersonaInsights(c.env.DB, tenantId, persona as Persona);
  return c.json(result);
});

export default insights;
