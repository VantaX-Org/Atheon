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
