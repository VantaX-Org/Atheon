/**
 * Catalyst Run Narrative Service
 *
 * Thin LLM layer on top of a completed `sub_catalyst_runs` row. Given a run
 * id + tenant id, it produces a short natural-language "tl;dr" explaining
 * what the catalyst found and what the operator should do next.
 *
 * Design:
 *   - Reuses the existing LLM stack (`loadLlmConfig` + `llmChatWithFallback`)
 *     so provider/model selection, fallback, and request-id threading all go
 *     through one codepath.
 *   - Reuses the existing budget reservation model (`checkAndReserveBudget` +
 *     `recordLlmUsage`) — no parallel counter. Budget exhaustion is signalled
 *     to the caller via a thrown `BudgetExhaustedError` so the route can map
 *     it cleanly to HTTP 429.
 *   - Reuses `redactPII` on the serialised run output before anything leaves
 *     the worker (emails, phones, SA IDs, credit cards etc. stripped).
 *   - Caches the narrative for 24h in KV under `narrative:<run_id>`, keyed so
 *     the same run returns the same string without re-billing the tenant.
 *
 * The LLM is instructed to return 2–4 factual sentences naming the metric
 * and the recommended action. We deliberately do *not* ask for structured
 * JSON — narratives are prose-first; callers that need structure should use
 * the existing `POST /runs/:id/llm-insights` endpoint.
 */
import { redactPII } from './pii-redaction';
import {
  loadLlmConfig,
  llmChatWithFallback,
  checkAndReserveBudget,
  recordLlmUsage,
  estimateTokensFor,
  type LlmMessage,
} from './llm-provider';

/** Persisted catalyst-run row shape we care about for narrative generation. */
export interface CatalystRunRow {
  id: string;
  tenant_id: string;
  cluster_id: string;
  sub_catalyst_name: string;
  status: string;
  matched: number;
  unmatched_source: number;
  unmatched_target: number;
  discrepancies: number;
  exceptions_raised: number;
  avg_confidence: number;
  total_source_value: number;
  total_discrepancy_value: number;
  total_exception_value: number;
  currency: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  reasoning: string | null;
  recommendations: string | null;
  result_data: string | null;
  cluster_name?: string;
  cluster_domain?: string;
}

/** Shape returned by `generateRunNarrative`. */
export interface RunNarrative {
  narrative: string;
  cached: boolean;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

/** Codes returned in the error payload — routes use these to pick an HTTP status. */
export type NarrativeErrorCode =
  | 'not_found'
  | 'not_finished'
  | 'budget_exhausted'
  | 'llm_failed';

/**
 * Thrown by `generateRunNarrative` when it cannot produce a narrative.
 * The route handler maps `.code` to an HTTP status (404/409/429/500).
 */
export class NarrativeError extends Error {
  constructor(
    public readonly code: NarrativeErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'NarrativeError';
  }
}

/** KV cache key for a run's narrative. Centralised so tests can assert against it. */
export function narrativeCacheKey(runId: string): string {
  return `narrative:${runId}`;
}

/** 24h cache TTL for narratives. */
const CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Rough USD cost estimate from prompt/completion tokens. Uses a conservative
 * blended rate (~$0.50 / 1M tokens) that matches the existing `ai-cost-optimizer`
 * defaults for Ollama Cloud + Workers AI. Exact billing happens elsewhere; this
 * value is advisory for the UI.
 */
function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  const total = Math.max(0, tokensIn) + Math.max(0, tokensOut);
  // $0.50 / 1M tokens — conservative blended rate for Ollama/Workers AI.
  return Math.round((total * 0.0000005) * 1_000_000) / 1_000_000;
}

/** System prompt — kept short, factual, action-oriented. */
const SYSTEM_PROMPT = [
  'You are summarising a single enterprise catalyst run for an operations analyst.',
  'Write 2 to 4 sentences. Be factual. Name the key metric with its number and the recommended next action.',
  'No marketing tone, no emojis, no headings, no bullet points. Plain prose only.',
].join(' ');

/**
 * Build the user prompt from a run row. We pass numeric summary fields
 * verbatim and JSON-stringify `result_data` / `recommendations` (redacted)
 * so the model has enough context to pick out the right metric.
 */
function buildUserPrompt(run: CatalystRunRow, redactedResultJson: string): string {
  const parts: string[] = [];
  parts.push(`Catalyst: ${run.sub_catalyst_name}`);
  if (run.cluster_name) parts.push(`Cluster: ${run.cluster_name}${run.cluster_domain ? ` (${run.cluster_domain})` : ''}`);
  parts.push(`Status: ${run.status}`);
  parts.push(`Records: ${run.matched} matched, ${run.discrepancies} discrepancies, ${run.exceptions_raised} exceptions, ${run.unmatched_source} unmatched source, ${run.unmatched_target} unmatched target`);
  const currency = run.currency || 'ZAR';
  if (run.total_source_value) parts.push(`Total source value: ${currency} ${Number(run.total_source_value).toLocaleString()}`);
  if (run.total_discrepancy_value) parts.push(`Total discrepancy value: ${currency} ${Number(run.total_discrepancy_value).toLocaleString()}`);
  if (run.total_exception_value) parts.push(`Total exception value: ${currency} ${Number(run.total_exception_value).toLocaleString()}`);
  if (typeof run.avg_confidence === 'number' && run.avg_confidence > 0) parts.push(`Avg confidence: ${run.avg_confidence.toFixed(2)}`);
  if (run.duration_ms) parts.push(`Duration: ${run.duration_ms}ms`);
  if (run.reasoning) parts.push(`Reasoning: ${run.reasoning.slice(0, 500)}`);
  if (redactedResultJson) parts.push(`Structured output: ${redactedResultJson.slice(0, 2000)}`);
  return parts.join('\n');
}

/**
 * Load a catalyst run by id, scoped to tenant. Returns null if not found.
 * Joins `catalyst_clusters` so the narrative prompt can name the cluster.
 */
async function loadRun(db: D1Database, runId: string, tenantId: string): Promise<CatalystRunRow | null> {
  return db.prepare(
    `SELECT r.id, r.tenant_id, r.cluster_id, r.sub_catalyst_name, r.status,
            r.matched, r.unmatched_source, r.unmatched_target, r.discrepancies,
            r.exceptions_raised, r.avg_confidence, r.total_source_value,
            r.total_discrepancy_value, r.total_exception_value, r.currency,
            r.started_at, r.completed_at, r.duration_ms,
            r.reasoning, r.recommendations, r.result_data,
            c.name AS cluster_name, c.domain AS cluster_domain
       FROM sub_catalyst_runs r
       LEFT JOIN catalyst_clusters c ON c.id = r.cluster_id
      WHERE r.id = ? AND r.tenant_id = ?`,
  ).bind(runId, tenantId).first<CatalystRunRow>();
}

/**
 * Produce a short natural-language summary of a completed catalyst run.
 *
 * Lookup → 404 if not found; 409 if the run is still running (status is not
 * `completed`, `success`, or `failed`). Returns a cached narrative when one
 * exists in KV; otherwise calls the tenant's configured LLM (with fallback)
 * through the existing budget + PII-redaction pipeline.
 *
 * @param db         D1 binding.
 * @param env        Worker env — used for `env.AI` (fallback) and `env.CACHE` (KV).
 * @param runId      Catalyst run id (`sub_catalyst_runs.id`).
 * @param tenantId   Tenant placing the narrative request.
 * @param requestId  Optional inbound X-Request-ID for correlation in `tenant_llm_usage`.
 *
 * @throws NarrativeError — `.code` drives the HTTP status at the route layer.
 */
export async function generateRunNarrative(
  db: D1Database,
  env: { AI: Ai; CACHE: KVNamespace },
  runId: string,
  tenantId: string,
  requestId?: string,
): Promise<RunNarrative> {
  const run = await loadRun(db, runId, tenantId);
  if (!run) {
    throw new NarrativeError('not_found', `Catalyst run ${runId} not found for this tenant.`);
  }

  // Finished = terminal state. `running`, `queued`, `pending` etc. → 409.
  const status = (run.status || '').toLowerCase();
  const isFinished = status === 'completed' || status === 'success' || status === 'failed';
  if (!isFinished) {
    throw new NarrativeError('not_finished', `Run is still in status '${run.status}'. Wait until it completes.`, {
      status: run.status,
    });
  }

  // KV cache hit — serve immediately, no LLM spend, no redaction work.
  const cacheKey = narrativeCacheKey(runId);
  const cachedRaw = await env.CACHE.get(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as Omit<RunNarrative, 'cached'>;
      if (cached && typeof cached.narrative === 'string' && cached.narrative.length > 0) {
        return { ...cached, cached: true };
      }
    } catch {
      // Corrupt cache entry — fall through and regenerate.
    }
  }

  // Redact the structured output before it leaves the worker. We fold the
  // row's `result_data`, `recommendations`, and `reasoning` into a single
  // JSON string and run one redactor pass over the lot — simpler than
  // redacting each field independently and cheaper than redacting the final
  // prompt string (JSON preserves field boundaries for the model).
  const structured = {
    result_data: safeJsonParse(run.result_data),
    recommendations: safeJsonParse(run.recommendations),
  };
  const structuredJson = JSON.stringify(structured);
  const { redacted: redactedResultJson } = redactPII(structuredJson);

  const config = await loadLlmConfig(db, tenantId);
  const userPrompt = buildUserPrompt(run, redactedResultJson);
  const messages: LlmMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  // Reservation ≈ prompt size + expected completion (300 tokens is plenty
  // for a 4-sentence prose answer).
  const estimatedTokens = estimateTokensFor(messages) + 300;
  const budget = await checkAndReserveBudget(db, tenantId, estimatedTokens);
  if (!budget.allowed) {
    throw new NarrativeError('budget_exhausted', budget.reason || 'Monthly LLM token budget exceeded.', {
      remaining: budget.remaining,
    });
  }

  let tokensIn = 0;
  let tokensOut = 0;
  let narrative = '';
  try {
    const response = await llmChatWithFallback(config, env.AI, messages, {
      maxTokens: 300,
      temperature: 0.2,
      timeoutMs: 12000,
    });
    narrative = (response.text || '').trim();
    tokensIn = response.tokensIn;
    tokensOut = response.tokensOut;
  } catch (err) {
    // Best-effort reconciliation: recordLlmUsage reclaims any overestimate.
    await recordLlmUsage(
      db, tenantId, config.provider, config.model_id || 'default',
      'catalyst.narrative', 0, 0, requestId, estimatedTokens,
    );
    throw new NarrativeError('llm_failed', err instanceof Error ? err.message : 'LLM call failed.');
  }

  // Record actual usage — reuses the existing tenant_llm_usage counter.
  await recordLlmUsage(
    db, tenantId, config.provider, config.model_id || 'default',
    'catalyst.narrative', tokensIn, tokensOut, requestId, estimatedTokens,
  );

  if (!narrative) {
    // The LLM replied with an empty string — surface as llm_failed rather
    // than caching empty output.
    throw new NarrativeError('llm_failed', 'LLM returned an empty narrative.');
  }

  const result: Omit<RunNarrative, 'cached'> = {
    narrative,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: estimateCostUsd(tokensIn, tokensOut),
  };

  // Fire-and-forget cache write. Failures here do not break the response.
  try {
    await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
  } catch (cacheErr) {
    console.error(`narrative cache put failed for ${runId}:`, cacheErr);
  }

  return { ...result, cached: false };
}

/**
 * Safe JSON parse that tolerates null/empty strings and bad payloads.
 * Returns `null` for any non-object value so the final prompt payload is
 * consistent. Callers never see throws from this.
 */
function safeJsonParse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
