/**
 * LLM Provider Abstraction Layer
 * 
 * Supports configurable LLM providers at the superadmin level:
 * - Claude (Anthropic)
 * - ChatGPT (OpenAI)
 * - Ollama Cloud (custom models)
 * - Internal/self-hosted (any OpenAI-compatible endpoint)
 * - Cloudflare Workers AI (built-in fallback)
 * 
 * IMPORTANT: The platform NEVER exposes which model/provider is being used.
 * This is a trade secret. All responses are attributed to "Atheon Intelligence".
 */

export type LlmProviderType = 'claude' | 'openai' | 'ollama' | 'internal' | 'workers_ai';

export interface LlmProviderConfig {
  provider: LlmProviderType;
  api_key?: string;
  api_base_url?: string;
  model_id?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.4;

/**
 * Load the tenant's LLM configuration from the database.
 * Falls back to Workers AI if no config is found.
 */
export async function loadLlmConfig(db: D1Database, tenantId: string): Promise<LlmProviderConfig> {
  try {
    const row = await db.prepare(
      "SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'llm_provider_config'"
    ).bind(tenantId).first<{ value: string }>();
    if (row?.value) {
      return JSON.parse(row.value) as LlmProviderConfig;
    }
  } catch {
    // Fall through to default
  }
  // Check for global (superadmin) config
  try {
    const globalRow = await db.prepare(
      "SELECT value FROM tenant_settings WHERE tenant_id = '__global__' AND key = 'llm_provider_config'"
    ).first<{ value: string }>();
    if (globalRow?.value) {
      return JSON.parse(globalRow.value) as LlmProviderConfig;
    }
  } catch {
    // Fall through to default
  }
  return { provider: 'workers_ai' };
}

/**
 * Save LLM provider configuration (superadmin only).
 * Use tenantId = '__global__' for platform-wide config.
 */
export async function saveLlmConfig(db: D1Database, tenantId: string, config: LlmProviderConfig): Promise<void> {
  await db.prepare(
    `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
     VALUES (?, ?, 'llm_provider_config', ?, datetime('now'))
     ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(`ts-${crypto.randomUUID()}`, tenantId, JSON.stringify(config)).run();
}

/**
 * Universal chat function — routes to the configured provider.
 * Never exposes provider/model details in the response.
 */
export async function llmChat(
  config: LlmProviderConfig,
  ai: Ai,
  messages: LlmMessage[],
  options?: { maxTokens?: number; temperature?: number },
): Promise<LlmResponse> {
  const maxTokens = options?.maxTokens || config.max_tokens || DEFAULT_MAX_TOKENS;
  const temperature = options?.temperature ?? config.temperature ?? DEFAULT_TEMPERATURE;

  switch (config.provider) {
    case 'claude':
      return callClaude(config, messages, maxTokens, temperature);
    case 'openai':
      return callOpenAI(config, messages, maxTokens, temperature);
    case 'ollama':
      return callOllama(config, messages, maxTokens, temperature);
    case 'internal':
      return callInternal(config, messages, maxTokens, temperature);
    case 'workers_ai':
    default:
      return callWorkersAI(ai, messages, maxTokens, temperature);
  }
}

/**
 * Chat with automatic fallback — tries configured provider, falls back to Workers AI.
 */
export async function llmChatWithFallback(
  config: LlmProviderConfig,
  ai: Ai,
  messages: LlmMessage[],
  options?: { maxTokens?: number; temperature?: number; timeoutMs?: number },
): Promise<LlmResponse> {
  const timeoutMs = options?.timeoutMs || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await llmChat(config, ai, messages, options);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    console.error(`LLM provider ${config.provider} failed, falling back to Workers AI:`, err);
    // Fallback to Workers AI
    return callWorkersAI(ai, messages, options?.maxTokens || DEFAULT_MAX_TOKENS, options?.temperature ?? DEFAULT_TEMPERATURE);
  }
}

// ── Provider Implementations ──

async function callClaude(config: LlmProviderConfig, messages: LlmMessage[], maxTokens: number, temperature: number): Promise<LlmResponse> {
  const apiKey = config.api_key;
  if (!apiKey) throw new Error('Claude API key not configured');

  const baseUrl = config.api_base_url || 'https://api.anthropic.com';
  const model = config.model_id || 'claude-sonnet-4-20250514';

  // Extract system message
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemMsg,
      messages: chatMessages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    content?: Array<{ type: string; text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const text = data.content?.map(c => c.text).join('') || '';
  return {
    text,
    tokensIn: data.usage?.input_tokens || estimateTokens(messages),
    tokensOut: data.usage?.output_tokens || Math.ceil(text.length / 4),
  };
}

async function callOpenAI(config: LlmProviderConfig, messages: LlmMessage[], maxTokens: number, temperature: number): Promise<LlmResponse> {
  const apiKey = config.api_key;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const baseUrl = config.api_base_url || 'https://api.openai.com';
  const model = config.model_id || 'gpt-4o';

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const text = data.choices?.[0]?.message?.content || '';
  return {
    text,
    tokensIn: data.usage?.prompt_tokens || estimateTokens(messages),
    tokensOut: data.usage?.completion_tokens || Math.ceil(text.length / 4),
  };
}

async function callOllama(config: LlmProviderConfig, messages: LlmMessage[], maxTokens: number, temperature: number): Promise<LlmResponse> {
  const apiKey = config.api_key;
  if (!apiKey) throw new Error('Ollama API key not configured');

  const baseUrl = config.api_base_url || 'https://ollama.com/api';
  const model = config.model_id || 'Reshigan/atheon';

  const res = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: { num_predict: maxTokens, temperature },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Ollama API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };

  const text = data.message?.content || '';
  return {
    text,
    tokensIn: data.prompt_eval_count || estimateTokens(messages),
    tokensOut: data.eval_count || Math.ceil(text.length / 4),
  };
}

async function callInternal(config: LlmProviderConfig, messages: LlmMessage[], maxTokens: number, temperature: number): Promise<LlmResponse> {
  const baseUrl = config.api_base_url;
  if (!baseUrl) throw new Error('Internal LLM endpoint not configured');

  const model = config.model_id || 'default';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.api_key) headers['Authorization'] = `Bearer ${config.api_key}`;

  // OpenAI-compatible format (most internal deployments support this)
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Internal LLM API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const text = data.choices?.[0]?.message?.content || '';
  return {
    text,
    tokensIn: data.usage?.prompt_tokens || estimateTokens(messages),
    tokensOut: data.usage?.completion_tokens || Math.ceil(text.length / 4),
  };
}

async function callWorkersAI(ai: Ai, messages: LlmMessage[], maxTokens: number, temperature: number): Promise<LlmResponse> {
  const model = '@cf/meta/llama-3.1-8b-instruct' as Parameters<Ai['run']>[0];
  const result = await ai.run(model, {
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens: maxTokens,
    temperature,
  });

  const aiResult = result as { response?: string };
  const text = aiResult.response || '';
  return {
    text,
    tokensIn: estimateTokens(messages),
    tokensOut: Math.ceil(text.length / 4),
  };
}

function estimateTokens(messages: LlmMessage[]): number {
  return Math.ceil(messages.reduce((acc, m) => acc + m.content.length, 0) / 4);
}

/**
 * Strip markdown code fences from LLM responses before JSON parsing.
 * LLMs often wrap JSON in ```json ... ``` which breaks JSON.parse().
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

// ═══ Per-Tenant LLM Token Budget ═══
//
// Per-tenant monthly spend cap to prevent a buggy or malicious tenant from
// running up unbounded LLM bills. Budget is stored in `tenant_llm_budget`
// (one row per tenant) with a reservation model:
//
//   1. Before the LLM call, `checkAndReserveBudget` atomically increments
//      `tokens_used_this_month` by an estimate and returns `allowed: false`
//      if that would exceed `monthly_token_budget`.
//   2. After the call, `recordLlmUsage` writes the actual usage to the
//      `tenant_llm_usage` audit table and reconciles the reservation
//      (refund if actual < estimated; over-spend is logged but allowed).
//
// Tenants with `monthly_token_budget = NULL` (or no budget row) are unlimited.

export interface BudgetCheckResult {
  /** Whether the request is allowed to proceed. */
  allowed: boolean;
  /** Tokens remaining in the month after the reservation. Infinity if unlimited. */
  remaining: number;
  /** Human-readable reason when denied. */
  reason?: string;
}

/** Shape of a row in `tenant_llm_budget`. */
interface TenantLlmBudgetRow {
  tenant_id: string;
  monthly_token_budget: number | null;
  tokens_used_this_month: number;
  tokens_reset_at: string | null;
  llm_redaction_enabled: number;
}

/** Return the first day of the current UTC month as ISO (YYYY-MM-01T00:00:00.000Z). */
function currentMonthStartIso(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  return d.toISOString();
}

/** Check whether `reset_at` is in an earlier month than `now`. */
function isPastMonth(resetAtIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!resetAtIso) return true;
  const r = new Date(resetAtIso);
  if (Number.isNaN(r.getTime())) return true;
  // Strictly "earlier month" — same month, any day, is current
  return (
    r.getUTCFullYear() < now.getUTCFullYear() ||
    (r.getUTCFullYear() === now.getUTCFullYear() && r.getUTCMonth() < now.getUTCMonth())
  );
}

/**
 * Load (or lazily create) the budget row for a tenant.
 *
 * Lazily creates a row with NULL budget (= unlimited) on first access so that
 * existing tenants continue to work without migration. Also performs the
 * monthly reset if `tokens_reset_at` is in a past month.
 *
 * @internal
 */
async function loadOrInitBudget(db: D1Database, tenantId: string): Promise<TenantLlmBudgetRow> {
  const row = await db.prepare(
    'SELECT tenant_id, monthly_token_budget, tokens_used_this_month, tokens_reset_at, llm_redaction_enabled FROM tenant_llm_budget WHERE tenant_id = ?',
  ).bind(tenantId).first<TenantLlmBudgetRow>();

  if (!row) {
    const nowIso = currentMonthStartIso();
    await db.prepare(
      `INSERT OR IGNORE INTO tenant_llm_budget (tenant_id, monthly_token_budget, tokens_used_this_month, tokens_reset_at, llm_redaction_enabled, updated_at)
       VALUES (?, NULL, 0, ?, 1, datetime('now'))`,
    ).bind(tenantId, nowIso).run();
    return {
      tenant_id: tenantId,
      monthly_token_budget: null,
      tokens_used_this_month: 0,
      tokens_reset_at: nowIso,
      llm_redaction_enabled: 1,
    };
  }

  // Monthly rollover — reset counter if last reset was in a past month.
  if (isPastMonth(row.tokens_reset_at)) {
    const nowIso = currentMonthStartIso();
    await db.prepare(
      `UPDATE tenant_llm_budget SET tokens_used_this_month = 0, tokens_reset_at = ?, updated_at = datetime('now') WHERE tenant_id = ?`,
    ).bind(nowIso, tenantId).run();
    return { ...row, tokens_used_this_month: 0, tokens_reset_at: nowIso };
  }

  return row;
}

/**
 * Budget check + reservation.
 *
 * If the tenant has a `monthly_token_budget` set and the incoming
 * `estimatedTokens` would push usage over the cap, the request is denied and
 * no reservation is made. Otherwise `tokens_used_this_month` is incremented
 * by `estimatedTokens` up-front (reservation model).
 *
 * Call `recordLlmUsage` after the LLM call to reconcile actual usage.
 *
 * @param db               D1 binding.
 * @param tenantId         Tenant placing the LLM call.
 * @param estimatedTokens  Pre-call token estimate (prompt + expected completion).
 */
export async function checkAndReserveBudget(
  db: D1Database,
  tenantId: string,
  estimatedTokens: number,
): Promise<BudgetCheckResult> {
  const est = Math.max(0, Math.ceil(estimatedTokens));
  try {
    const row = await loadOrInitBudget(db, tenantId);

    // Null budget = unlimited; still reserve tokens so usage stats are accurate.
    if (row.monthly_token_budget === null || row.monthly_token_budget === undefined) {
      await db.prepare(
        `UPDATE tenant_llm_budget SET tokens_used_this_month = tokens_used_this_month + ?, updated_at = datetime('now') WHERE tenant_id = ?`,
      ).bind(est, tenantId).run();
      return { allowed: true, remaining: Number.POSITIVE_INFINITY };
    }

    const projected = row.tokens_used_this_month + est;
    if (projected > row.monthly_token_budget) {
      return {
        allowed: false,
        remaining: Math.max(0, row.monthly_token_budget - row.tokens_used_this_month),
        reason: `Monthly LLM token budget exceeded (${row.tokens_used_this_month}/${row.monthly_token_budget} used, requested ${est})`,
      };
    }

    await db.prepare(
      `UPDATE tenant_llm_budget SET tokens_used_this_month = tokens_used_this_month + ?, updated_at = datetime('now') WHERE tenant_id = ?`,
    ).bind(est, tenantId).run();

    return {
      allowed: true,
      remaining: row.monthly_token_budget - projected,
    };
  } catch (err) {
    // Fail-open: if the budget table is broken, never block the LLM call —
    // we'd rather over-spend than take down the product.
    console.error(`checkAndReserveBudget error for tenant ${tenantId}:`, err);
    return { allowed: true, remaining: Number.POSITIVE_INFINITY };
  }
}

/**
 * Record actual LLM usage after a call completes.
 *
 * Writes a row to `tenant_llm_usage` for audit/analytics and reconciles the
 * reservation made by `checkAndReserveBudget`:
 *   - actual < estimated → refund the delta to the monthly counter.
 *   - actual > estimated → the overspend already happened; log a warning and
 *     add the delta to the counter so future checks reflect the true spend.
 *
 * @param db                 D1 binding.
 * @param tenantId           Tenant.
 * @param provider           Provider that served the request.
 * @param model              Model ID (free-form).
 * @param endpoint           App feature that drove the call (e.g. 'mind.query').
 * @param prompt_tokens      Actual prompt tokens billed.
 * @param completion_tokens  Actual completion tokens billed.
 * @param requestId          Optional correlation ID.
 * @param estimatedTokens    Original reservation — if provided, the counter is reconciled.
 */
export async function recordLlmUsage(
  db: D1Database,
  tenantId: string,
  provider: string,
  model: string,
  endpoint: string,
  prompt_tokens: number,
  completion_tokens: number,
  requestId?: string,
  estimatedTokens?: number,
): Promise<void> {
  const pIn = Math.max(0, Math.ceil(prompt_tokens));
  const pOut = Math.max(0, Math.ceil(completion_tokens));
  const total = pIn + pOut;

  try {
    await db.prepare(
      `INSERT INTO tenant_llm_usage (id, tenant_id, provider, model, prompt_tokens, completion_tokens, total_tokens, endpoint, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      `llu-${crypto.randomUUID()}`,
      tenantId,
      provider,
      model || null,
      pIn,
      pOut,
      total,
      endpoint || null,
      requestId || null,
    ).run();

    // Reconcile reservation (if one was made).
    if (typeof estimatedTokens === 'number') {
      const est = Math.max(0, Math.ceil(estimatedTokens));
      const delta = total - est; // >0 over-spent, <0 refund
      if (delta !== 0) {
        await db.prepare(
          `UPDATE tenant_llm_budget SET tokens_used_this_month = MAX(0, tokens_used_this_month + ?), updated_at = datetime('now') WHERE tenant_id = ?`,
        ).bind(delta, tenantId).run();
        if (delta > 0) {
          console.warn(
            `LLM over-spend for tenant ${tenantId} on ${endpoint}: est=${est} actual=${total} delta=+${delta}`,
          );
        }
      }
    }
  } catch (err) {
    // Non-fatal — usage logging must never break the user's request.
    console.error(`recordLlmUsage error for tenant ${tenantId}:`, err);
  }
}

/**
 * Whether this tenant has opted out of PII redaction. Defaults to true
 * (redaction ON) for any tenant without an explicit setting — safer default.
 */
export async function isRedactionEnabled(db: D1Database, tenantId: string): Promise<boolean> {
  try {
    const row = await db.prepare(
      'SELECT llm_redaction_enabled FROM tenant_llm_budget WHERE tenant_id = ?',
    ).bind(tenantId).first<{ llm_redaction_enabled: number }>();
    if (!row) return true;
    return row.llm_redaction_enabled !== 0;
  } catch {
    return true;
  }
}

/**
 * Set the tenant's monthly token budget (superadmin only — caller must gate
 * this). Pass `null` for unlimited. Creates the row if missing.
 */
export async function setTenantTokenBudget(
  db: D1Database,
  tenantId: string,
  monthlyTokenBudget: number | null,
): Promise<void> {
  // Ensure row exists (rollover-aware).
  await loadOrInitBudget(db, tenantId);
  await db.prepare(
    `UPDATE tenant_llm_budget SET monthly_token_budget = ?, updated_at = datetime('now') WHERE tenant_id = ?`,
  ).bind(monthlyTokenBudget, tenantId).run();
}

/**
 * Set the tenant's PII redaction opt-in flag (superadmin only). Default true.
 */
export async function setTenantRedactionEnabled(
  db: D1Database,
  tenantId: string,
  enabled: boolean,
): Promise<void> {
  await loadOrInitBudget(db, tenantId);
  await db.prepare(
    `UPDATE tenant_llm_budget SET llm_redaction_enabled = ?, updated_at = datetime('now') WHERE tenant_id = ?`,
  ).bind(enabled ? 1 : 0, tenantId).run();
}

/** Estimate token count from a string or chat messages array. ~4 chars/token. */
export function estimateTokensFor(input: string | LlmMessage[]): number {
  if (typeof input === 'string') return Math.ceil(input.length / 4);
  return Math.ceil(input.reduce((acc, m) => acc + (m.content?.length || 0), 0) / 4);
}
