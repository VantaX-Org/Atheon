/**
 * Vectorize Integration Service
 * True vector embeddings and semantic search using Cloudflare Vectorize.
 * Generates embeddings via Workers AI and stores/queries in Vectorize index.
 */

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const VECTOR_DIMENSIONS = 768; // bge-base-en-v1.5 output dimensions
const DEFAULT_TOP_K = 10;

export interface VectorDocument {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

// ── Generate Embeddings via Workers AI ──

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL as Parameters<Ai['run']>[0], {
    text: [text],
  });
  const embedResult = result as { data?: number[][] };
  if (embedResult.data && embedResult.data.length > 0) {
    return embedResult.data[0];
  }
  throw new Error('Failed to generate embedding');
}

// ── Index a document into Vectorize ──

export async function indexDocument(
  vectorize: VectorizeIndex,
  ai: Ai,
  doc: VectorDocument,
): Promise<{ id: string; indexed: boolean }> {
  try {
    // Generate embedding from document content
    const textToEmbed = `${doc.type}: ${doc.name}. ${doc.content}`;
    const values = await generateEmbedding(ai, textToEmbed);

    // Upsert into Vectorize
    await vectorize.upsert([{
      id: doc.id,
      values,
      metadata: {
        tenantId: doc.tenantId,
        type: doc.type,
        name: doc.name,
        ...(doc.metadata || {}),
      },
    }]);

    return { id: doc.id, indexed: true };
  } catch (err) {
    console.error('Vectorize indexing error:', err);
    return { id: doc.id, indexed: false };
  }
}

// ── Semantic Search via Vectorize ──

export async function semanticSearch(
  vectorize: VectorizeIndex,
  ai: Ai,
  query: string,
  tenantId: string,
  options?: { topK?: number; type?: string },
): Promise<SearchResult[]> {
  try {
    const queryVector = await generateEmbedding(ai, query);

    const filter: VectorizeVectorMetadataFilter = {
      tenantId: tenantId,
    };
    if (options?.type) {
      filter.type = options.type;
    }

    const results = await vectorize.query(queryVector, {
      topK: options?.topK || DEFAULT_TOP_K,
      filter,
      returnMetadata: 'all',
    });

    return results.matches.map(match => ({
      id: match.id,
      score: match.score,
      metadata: (match.metadata || {}) as Record<string, unknown>,
    }));
  } catch (err) {
    console.error('Vectorize search error:', err);
    return [];
  }
}

// ── Batch index graph entities for a tenant ──

export async function indexGraphEntities(
  vectorize: VectorizeIndex,
  ai: Ai,
  db: D1Database,
  tenantId: string,
): Promise<{ indexed: number; failed: number }> {
  let indexed = 0;
  let failed = 0;

  // Fetch all entities for the tenant
  const entities = await db.prepare(
    'SELECT id, type, name, properties FROM graph_entities WHERE tenant_id = ? LIMIT 500'
  ).bind(tenantId).all();

  // Process in batches of 10 (Workers AI rate limits)
  const batchSize = 10;
  for (let i = 0; i < entities.results.length; i += batchSize) {
    const batch = entities.results.slice(i, i + batchSize);

    for (const entity of batch) {
      const props = JSON.parse(entity.properties as string || '{}');
      const propsText = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join(', ');
      const content = `${entity.type} entity named ${entity.name}. Properties: ${propsText}`;

      const result = await indexDocument(vectorize, ai, {
        id: entity.id as string,
        tenantId,
        type: entity.type as string,
        name: entity.name as string,
        content,
        metadata: { source: 'graph_entity', properties: propsText },
      });

      if (result.indexed) indexed++;
      else failed++;
    }
  }

  // Also index relationships
  const relationships = await db.prepare(
    `SELECT r.id, r.type, s.name as source_name, s.type as source_type, t.name as target_name, t.type as target_type
     FROM graph_relationships r
     JOIN graph_entities s ON r.source_id = s.id
     JOIN graph_entities t ON r.target_id = t.id
     WHERE r.tenant_id = ? LIMIT 500`
  ).bind(tenantId).all();

  for (let i = 0; i < relationships.results.length; i += batchSize) {
    const batch = relationships.results.slice(i, i + batchSize);

    for (const rel of batch) {
      const content = `${rel.source_type} "${rel.source_name}" ${rel.type} ${rel.target_type} "${rel.target_name}"`;

      const result = await indexDocument(vectorize, ai, {
        id: rel.id as string,
        tenantId,
        type: 'relationship',
        name: `${rel.source_name} → ${rel.target_name}`,
        content,
        metadata: {
          source: 'graph_relationship',
          relationType: rel.type,
          sourceType: rel.source_type,
          targetType: rel.target_type,
        },
      });

      if (result.indexed) indexed++;
      else failed++;
    }
  }

  return { indexed, failed };
}

// ── Delete vectors for a tenant ──

export async function deleteByIds(
  vectorize: VectorizeIndex,
  ids: string[],
): Promise<{ deleted: number }> {
  try {
    await vectorize.deleteByIds(ids);
    return { deleted: ids.length };
  } catch (err) {
    console.error('Vectorize delete error:', err);
    return { deleted: 0 };
  }
}

// ── Export constants for wrangler config ──
export { VECTOR_DIMENSIONS, EMBEDDING_MODEL };
