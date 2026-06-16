import { Hono } from 'hono';
import type { AppBindings } from '../types';
import type { AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { semanticSearch, indexGraphEntities } from '../services/vectorize';

const memory = new Hono<AppBindings>();

// BUG-09: Escape user input for SQL LIKE patterns
function escapeLike(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/memory/entities
memory.get('/entities', async (c) => {
  const tenantId = getTenantId(c);
  const entityType = c.req.query('type');
  const search = c.req.query('search');

  let query = 'SELECT * FROM graph_entities WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (entityType) { query += ' AND type = ?'; binds.push(entityType); }
  if (search) {
    const escaped = escapeLike(search);
    query += " AND (name LIKE ? ESCAPE '\\' OR type LIKE ? ESCAPE '\\')";
    binds.push(`%${escaped}%`, `%${escaped}%`);
  }

  query += ' ORDER BY name ASC LIMIT 100';

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  const formatted = results.results.map((e: Record<string, unknown>) => ({
    id: e.id,
    type: e.type,
    name: e.name,
    properties: JSON.parse(e.properties as string || '{}'),
    confidence: e.confidence,
    source: e.source,
    validFrom: e.valid_from,
    validTo: e.valid_to,
  }));

  return c.json({ entities: formatted, total: formatted.length });
});

// GET /api/memory/entities/:id
memory.get('/entities/:id', async (c) => {
  const id = c.req.param('id');
  const entity = await c.env.DB.prepare('SELECT * FROM graph_entities WHERE id = ?').bind(id).first();

  if (!entity) return c.json({ error: 'Entity not found' }, 404);

  // Get relationships
  const outgoing = await c.env.DB.prepare(
    'SELECT r.*, ge.name as target_name, ge.type as target_type FROM graph_relationships r JOIN graph_entities ge ON r.target_id = ge.id WHERE r.source_id = ?'
  ).bind(id).all();

  const incoming = await c.env.DB.prepare(
    'SELECT r.*, ge.name as source_name, ge.type as source_type FROM graph_relationships r JOIN graph_entities ge ON r.source_id = ge.id WHERE r.target_id = ?'
  ).bind(id).all();

  return c.json({
    id: entity.id,
    type: entity.type,
    name: entity.name,
    properties: JSON.parse(entity.properties as string || '{}'),
    confidence: entity.confidence,
    source: entity.source,
    relationships: {
      outgoing: outgoing.results.map((r: Record<string, unknown>) => ({
        id: r.id,
        type: r.type,
        targetId: r.target_id,
        targetName: r.target_name,
        targetType: r.target_type,
        properties: JSON.parse(r.properties as string || '{}'),
        confidence: r.confidence,
      })),
      incoming: incoming.results.map((r: Record<string, unknown>) => ({
        id: r.id,
        type: r.type,
        sourceId: r.source_id,
        sourceName: r.source_name,
        sourceType: r.source_type,
        properties: JSON.parse(r.properties as string || '{}'),
        confidence: r.confidence,
      })),
    },
  });
});

// POST /api/memory/entities
memory.post('/entities', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    type: string; name: string; properties?: Record<string, unknown>; source?: string;
  }>(c, [
    { field: 'type', type: 'string', required: true, minLength: 1, maxLength: 64 },
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'source', type: 'string', required: false, maxLength: 64 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO graph_entities (id, tenant_id, type, name, properties, source) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.type, body.name, JSON.stringify(body.properties || {}), body.source || 'manual').run();

  return c.json({ id, type: body.type, name: body.name }, 201);
});

// GET /api/memory/relationships
memory.get('/relationships', async (c) => {
  const tenantId = getTenantId(c);

  const results = await c.env.DB.prepare(
    `SELECT r.*, 
      s.name as source_name, s.type as source_type, 
      t.name as target_name, t.type as target_type 
    FROM graph_relationships r 
    JOIN graph_entities s ON r.source_id = s.id 
    JOIN graph_entities t ON r.target_id = t.id 
    WHERE r.tenant_id = ? 
    ORDER BY r.confidence DESC LIMIT 100`
  ).bind(tenantId).all();

  const formatted = results.results.map((r: Record<string, unknown>) => ({
    id: r.id,
    type: r.type,
    sourceId: r.source_id,
    sourceName: r.source_name,
    sourceType: r.source_type,
    targetId: r.target_id,
    targetName: r.target_name,
    targetType: r.target_type,
    properties: JSON.parse(r.properties as string || '{}'),
    confidence: r.confidence,
  }));

  return c.json({ relationships: formatted, total: formatted.length });
});

// POST /api/memory/relationships
memory.post('/relationships', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    source_id: string; target_id: string; type: string; properties?: Record<string, unknown>;
  }>(c, [
    { field: 'source_id', type: 'string', required: true, minLength: 1 },
    { field: 'target_id', type: 'string', required: true, minLength: 1 },
    { field: 'type', type: 'string', required: true, minLength: 1, maxLength: 64 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO graph_relationships (id, tenant_id, source_id, target_id, type, properties) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.source_id, body.target_id, body.type, JSON.stringify(body.properties || {})).run();

  return c.json({ id }, 201);
});

// GET /api/memory/graph (full graph for visualization)
memory.get('/graph', async (c) => {
  const tenantId = getTenantId(c);

  const entities = await c.env.DB.prepare(
    'SELECT id, type, name, properties, confidence FROM graph_entities WHERE tenant_id = ? LIMIT 200'
  ).bind(tenantId).all();

  const relationships = await c.env.DB.prepare(
    'SELECT id, source_id, target_id, type, confidence FROM graph_relationships WHERE tenant_id = ? LIMIT 500'
  ).bind(tenantId).all();

  return c.json({
    nodes: entities.results.map((e: Record<string, unknown>) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      properties: JSON.parse(e.properties as string || '{}'),
      confidence: e.confidence,
    })),
    edges: relationships.results.map((r: Record<string, unknown>) => ({
      id: r.id,
      source: r.source_id,
      target: r.target_id,
      type: r.type,
      confidence: r.confidence,
    })),
  });
});

// POST /api/memory/query (GraphRAG query with semantic + keyword search)
memory.post('/query', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{ query: string; depth?: number }>(c, [
    { field: 'query', type: 'string', required: true, minLength: 1, maxLength: 500 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);
  const tenantId = getTenantId(c);
  const query = body.query.toLowerCase();

  // Try Vectorize semantic search first (if available)
  let vectorResults: { id: string; score: number; metadata: Record<string, unknown> }[] = [];
  if (c.env.VECTORIZE) {
    try {
      vectorResults = await semanticSearch(c.env.VECTORIZE, c.env.AI, body.query, tenantId, { topK: 10 });
    } catch (err) {
      console.error('Vectorize search failed, falling back to keyword:', err);
    }
  }

  // Keyword-based graph traversal (always run as fallback/supplement)
  const matchingEntities = await c.env.DB.prepare(
    'SELECT * FROM graph_entities WHERE tenant_id = ? AND (LOWER(name) LIKE ? OR LOWER(type) LIKE ?) LIMIT 10'
  ).bind(tenantId, `%${query}%`, `%${query}%`).all();

  // Get related entities via relationships
  const entityIds = matchingEntities.results.map((e: Record<string, unknown>) => e.id as string);
  let relatedEntities: Record<string, unknown>[] = [];

  if (entityIds.length > 0) {
    for (const eid of entityIds.slice(0, 5)) {
      const related = await c.env.DB.prepare(
        `SELECT DISTINCT ge.* FROM graph_entities ge 
         JOIN graph_relationships gr ON (ge.id = gr.target_id OR ge.id = gr.source_id) 
         WHERE (gr.source_id = ? OR gr.target_id = ?) AND ge.id != ? AND ge.tenant_id = ?
         LIMIT 10`
      ).bind(eid, eid, eid, tenantId).all();
      relatedEntities = [...relatedEntities, ...related.results];
    }
  }

  // Build context from both vector and keyword matches
  const context = matchingEntities.results.map((e: Record<string, unknown>) =>
    `${e.type}: ${e.name} (${e.properties})`
  ).join('; ');

  const vectorContext = vectorResults.map(r =>
    `[${(r.score * 100).toFixed(0)}%] ${r.metadata.type || 'entity'}: ${r.metadata.name || r.id}`
  ).join('; ');

  // Use Workers AI to generate a contextual answer from the graph data
  let answer = `Found ${matchingEntities.results.length} keyword matches and ${vectorResults.length} semantic matches for "${body.query}".`;

  try {
    const combinedContext = [context, vectorContext].filter(Boolean).join('\n\nSemantic matches: ');
    if (matchingEntities.results.length > 0 || vectorResults.length > 0) {
      const aiResult = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct' as Parameters<Ai['run']>[0], {
        messages: [
          {
            role: 'system',
            content: 'You are a knowledge graph query engine. Given entity data from a business knowledge graph (keyword and semantic search results), provide a concise, insightful answer to the user\'s query. Be specific and reference the entities by name.'
          },
          {
            role: 'user',
            content: `Query: ${body.query}\n\nGraph context:\n${combinedContext}\n\nRelated entities: ${relatedEntities.slice(0, 5).map((e: Record<string, unknown>) => `${e.type}: ${e.name}`).join(', ')}`
          },
        ],
        max_tokens: 512,
        temperature: 0.5,
      });
      const result = aiResult as { response?: string };
      if (result.response) {
        answer = result.response;
      }
    }
  } catch (err) {
    console.error('AI query augmentation failed:', err);
  }

  return c.json({
    query: body.query,
    searchMode: vectorResults.length > 0 ? 'semantic+keyword' : 'keyword',
    directMatches: matchingEntities.results.map((e: Record<string, unknown>) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      properties: JSON.parse(e.properties as string || '{}'),
      confidence: e.confidence,
    })),
    semanticMatches: vectorResults.map(r => ({
      id: r.id,
      score: r.score,
      type: r.metadata.type,
      name: r.metadata.name,
    })),
    relatedEntities: relatedEntities.slice(0, 10).map((e: Record<string, unknown>) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      properties: JSON.parse(e.properties as string || '{}'),
    })),
    context,
    answer,
  });
});

// POST /api/memory/index - Index graph entities into Vectorize for semantic search
memory.post('/index', async (c) => {
  const tenantId = getTenantId(c);

  if (!c.env.VECTORIZE) {
    return c.json({ error: 'Vectorize not configured', message: 'Vector index not available' }, 503);
  }

  const result = await indexGraphEntities(c.env.VECTORIZE, c.env.AI, c.env.DB, tenantId);
  return c.json({ ...result, tenantId });
});

// POST /api/memory/build — auto-build the knowledge graph from real tenant data.
//
// Materializes graph_entities + graph_relationships from the tenant's actual
// catalyst/ERP records (catalyst_clusters, sub_catalyst_kpis, process_metrics,
// anomalies, correlation_events). Every node carries a provenance `source`
// (`auto:<table>:<id>`) so each fact traces back to a real record — no
// fabrication. Relationships are emitted only on real FK / exact-name linkage,
// never keyword inference. Idempotent: prior auto-built rows are cleared and
// rebuilt; manually-authored rows (source='manual') are left untouched.
memory.post('/build', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'No tenant context' }, 400);

  // --- Read real source data (tenant-scoped) ---
  const [clusters, subKpis, metrics, anomalyRows, correlations] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, domain, status, success_rate, trust_score, autonomy_tier FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).all(),
    c.env.DB.prepare('SELECT cluster_id, sub_catalyst_name, success_rate, avg_confidence, exception_rate, status, total_runs FROM sub_catalyst_kpis WHERE tenant_id = ?').bind(tenantId).all(),
    c.env.DB.prepare('SELECT id, name, value, unit, status, source_system, cluster_id, sub_catalyst_name FROM process_metrics WHERE tenant_id = ?').bind(tenantId).all(),
    c.env.DB.prepare('SELECT id, metric, severity, deviation, hypothesis, status FROM anomalies WHERE tenant_id = ?').bind(tenantId).all(),
    c.env.DB.prepare('SELECT source_system, source_event, target_system, target_impact, confidence, lag_days FROM correlation_events WHERE tenant_id = ?').bind(tenantId).all(),
  ]);

  const r = <T = Record<string, unknown>>(x: { results: unknown[] }) => x.results as T[];
  const clusterRows = r<{ id: string; name: string; domain: string; status: string; success_rate: number; trust_score: number; autonomy_tier: string }>(clusters);
  const subRows = r<{ cluster_id: string; sub_catalyst_name: string; success_rate: number; avg_confidence: number; exception_rate: number; status: string; total_runs: number }>(subKpis);
  const metricRows = r<{ id: string; name: string; value: number; unit: string; status: string; source_system: string | null; cluster_id: string | null; sub_catalyst_name: string | null }>(metrics);
  const anomalyList = r<{ id: string; metric: string; severity: string; deviation: number; hypothesis: string | null; status: string }>(anomalyRows);
  const corrRows = r<{ source_system: string; source_event: string; target_system: string; target_impact: string; confidence: number; lag_days: number }>(correlations);

  // --- Build entities (deterministic ids so relationships can reference them) ---
  type Ent = { id: string; type: string; name: string; properties: Record<string, unknown>; confidence: number; source: string };
  const entities: Ent[] = [];
  const sysSlug = (s: string) => `auto:sys:${s.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const clusterEntId = (id: string) => `auto:catalyst:${id}`;
  const subEntId = (clusterId: string, sub: string) => `auto:sub:${clusterId}:${sub}`;
  const metricEntId = (id: string) => `auto:metric:${id}`;
  const anomEntId = (id: string) => `auto:anom:${id}`;

  for (const cl of clusterRows) {
    entities.push({
      id: clusterEntId(cl.id), type: 'catalyst', name: cl.name,
      properties: { domain: cl.domain, status: cl.status, successRate: cl.success_rate, trustScore: cl.trust_score, autonomyTier: cl.autonomy_tier },
      confidence: 1.0, source: `auto:catalyst_clusters:${cl.id}`,
    });
  }
  // sub-catalysts — confidence carries the real avg_confidence signal when present.
  const subSeen = new Set<string>();
  for (const s of subRows) {
    const eid = subEntId(s.cluster_id, s.sub_catalyst_name);
    if (subSeen.has(eid)) continue;
    subSeen.add(eid);
    entities.push({
      id: eid, type: 'sub_catalyst', name: s.sub_catalyst_name,
      properties: { clusterId: s.cluster_id, successRate: s.success_rate, avgConfidence: s.avg_confidence, exceptionRate: s.exception_rate, status: s.status, totalRuns: s.total_runs },
      confidence: s.avg_confidence > 0 ? Math.min(1, s.avg_confidence > 1 ? s.avg_confidence / 100 : s.avg_confidence) : 1.0,
      source: `auto:sub_catalyst_kpis:${s.cluster_id}:${s.sub_catalyst_name}`,
    });
  }
  // metrics + the source-systems they reference.
  const systems = new Set<string>();
  const metricNameToId = new Map<string, string>();
  for (const m of metricRows) {
    entities.push({
      id: metricEntId(m.id), type: 'metric', name: m.name,
      properties: { value: m.value, unit: m.unit, status: m.status, sourceSystem: m.source_system, clusterId: m.cluster_id, subCatalystName: m.sub_catalyst_name },
      confidence: 1.0, source: `auto:process_metrics:${m.id}`,
    });
    metricNameToId.set(m.name, metricEntId(m.id));
    if (m.source_system) systems.add(m.source_system);
  }
  for (const cr of corrRows) { systems.add(cr.source_system); systems.add(cr.target_system); }
  for (const sys of systems) {
    entities.push({ id: sysSlug(sys), type: 'source_system', name: sys, properties: { system: sys }, confidence: 1.0, source: `auto:source_system:${sys}` });
  }
  for (const a of anomalyList) {
    entities.push({
      id: anomEntId(a.id), type: 'anomaly', name: a.metric,
      properties: { severity: a.severity, deviation: a.deviation, hypothesis: a.hypothesis, status: a.status, metric: a.metric },
      confidence: 1.0, source: `auto:anomalies:${a.id}`,
    });
  }

  // --- Build relationships (real linkage only) ---
  type Rel = { id: string; sourceId: string; targetId: string; type: string; properties: Record<string, unknown>; confidence: number };
  const rels: Rel[] = [];
  const entIds = new Set(entities.map(e => e.id));
  const addRel = (rel: Rel) => { if (entIds.has(rel.sourceId) && entIds.has(rel.targetId)) rels.push(rel); };

  // catalyst HAS_SUB_CATALYST sub  (FK: sub_catalyst_kpis.cluster_id)
  for (const eid of subSeen) {
    const s = subRows.find(x => subEntId(x.cluster_id, x.sub_catalyst_name) === eid)!;
    addRel({ id: `auto:rel:has_sub:${eid}`, sourceId: clusterEntId(s.cluster_id), targetId: eid, type: 'HAS_SUB_CATALYST', properties: { auto: true }, confidence: 1.0 });
  }
  for (const m of metricRows) {
    // sub_catalyst PRODUCES metric  (FK: process_metrics.cluster_id + sub_catalyst_name)
    if (m.cluster_id && m.sub_catalyst_name) {
      addRel({ id: `auto:rel:produces:${m.id}`, sourceId: subEntId(m.cluster_id, m.sub_catalyst_name), targetId: metricEntId(m.id), type: 'PRODUCES', properties: { auto: true }, confidence: 1.0 });
    }
    // metric SOURCED_FROM source_system  (process_metrics.source_system)
    if (m.source_system) {
      addRel({ id: `auto:rel:sourced:${m.id}`, sourceId: metricEntId(m.id), targetId: sysSlug(m.source_system), type: 'SOURCED_FROM', properties: { auto: true }, confidence: 1.0 });
    }
  }
  // metric HAS_ANOMALY anomaly  (exact name match — same linkage the schema uses)
  for (const a of anomalyList) {
    const mid = metricNameToId.get(a.metric);
    if (mid) addRel({ id: `auto:rel:anom:${a.id}`, sourceId: mid, targetId: anomEntId(a.id), type: 'HAS_ANOMALY', properties: { auto: true, severity: a.severity }, confidence: 1.0 });
  }
  // source_system CORRELATES_WITH source_system — aggregate, carry real detector confidence.
  const corrAgg = new Map<string, { src: string; tgt: string; conf: number; count: number; lag: number }>();
  for (const cr of corrRows) {
    const key = `${cr.source_system}→${cr.target_system}`;
    const prev = corrAgg.get(key);
    if (!prev) corrAgg.set(key, { src: cr.source_system, tgt: cr.target_system, conf: cr.confidence, count: 1, lag: cr.lag_days });
    else { prev.count += 1; prev.conf = Math.max(prev.conf, cr.confidence); }
  }
  for (const [key, agg] of corrAgg) {
    addRel({
      id: `auto:rel:corr:${sysSlug(agg.src)}:${sysSlug(agg.tgt)}`,
      sourceId: sysSlug(agg.src), targetId: sysSlug(agg.tgt), type: 'CORRELATES_WITH',
      properties: { auto: true, events: agg.count, lagDays: agg.lag, pair: key },
      confidence: agg.conf > 1 ? agg.conf / 100 : agg.conf,
    });
  }

  // Collapse to unique ids before persisting. Case-variant source-system names
  // (e.g. "CRM" vs "crm", "SAP FI" vs "sap fi") slug to the SAME `auto:sys:*`
  // id, so the same node can be emitted twice — an INSERT of two rows with the
  // same PRIMARY KEY aborts the whole batch (500). First occurrence wins; the
  // relationships already resolve through `sysSlug`, so they point at the kept
  // node regardless of which variant name survives.
  const uniqueEntities = Array.from(new Map(entities.map(e => [e.id, e])).values());

  // --- Persist: clear prior auto rows, then insert (manual rows preserved) ---
  await c.env.DB.prepare("DELETE FROM graph_relationships WHERE tenant_id = ? AND json_extract(properties, '$.auto') = 1").bind(tenantId).run();
  await c.env.DB.prepare("DELETE FROM graph_entities WHERE tenant_id = ? AND source LIKE 'auto:%'").bind(tenantId).run();

  const stmts = [
    ...uniqueEntities.map(e => c.env.DB.prepare(
      'INSERT INTO graph_entities (id, tenant_id, type, name, properties, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(e.id, tenantId, e.type, e.name, JSON.stringify(e.properties), e.confidence, e.source)),
    ...rels.map(rel => c.env.DB.prepare(
      'INSERT INTO graph_relationships (id, tenant_id, source_id, target_id, type, properties, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(rel.id, tenantId, rel.sourceId, rel.targetId, rel.type, JSON.stringify(rel.properties), rel.confidence)),
  ];
  // D1 batch cap is generous, but chunk to stay safe on very large tenants.
  for (let i = 0; i < stmts.length; i += 50) {
    await c.env.DB.batch(stmts.slice(i, i + 50));
  }

  const byType: Record<string, number> = {};
  for (const e of uniqueEntities) byType[e.type] = (byType[e.type] || 0) + 1;

  return c.json({
    ok: true,
    tenantId,
    entities: uniqueEntities.length,
    relationships: rels.length,
    entityTypes: byType,
    sources: {
      catalysts: clusterRows.length,
      subCatalysts: subSeen.size,
      metrics: metricRows.length,
      sourceSystems: systems.size,
      anomalies: anomalyList.length,
      correlations: corrRows.length,
    },
  });
});

// GET /api/memory/stats
memory.get('/stats', async (c) => {
  const tenantId = getTenantId(c);

  const entityCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM graph_entities WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>();
  const relationshipCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM graph_relationships WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>();

  const typeBreakdown = await c.env.DB.prepare(
    'SELECT type, COUNT(*) as count FROM graph_entities WHERE tenant_id = ? GROUP BY type ORDER BY count DESC'
  ).bind(tenantId).all();

  const relTypeBreakdown = await c.env.DB.prepare(
    'SELECT type, COUNT(*) as count FROM graph_relationships WHERE tenant_id = ? GROUP BY type ORDER BY count DESC'
  ).bind(tenantId).all();

  return c.json({
    entities: entityCount?.count || 0,
    relationships: relationshipCount?.count || 0,
    entityTypes: typeBreakdown.results,
    relationshipTypes: relTypeBreakdown.results,
  });
});

export default memory;
