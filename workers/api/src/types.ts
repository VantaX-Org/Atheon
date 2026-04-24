export interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  DASHBOARD_ROOM: DurableObjectNamespace;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string; // Separate encryption key from JWT_SECRET for enhanced security
  AZURE_AD_CLIENT_SECRET: string;
  AZURE_AD_TENANT_ID: string;
  AZURE_AD_CLIENT_ID: string;
  // Microsoft Graph credentials for contact form and email delivery
  MS_GRAPH_CLIENT_ID: string;
  MS_GRAPH_CLIENT_SECRET: string;
  MS_GRAPH_TENANT_ID: string;
  // SSO redirect URI (optional, defaults to production URL)
  SSO_REDIRECT_URI?: string;
  // Demo login secret (only used in non-production environments)
  DEMO_LOGIN_SECRET?: string;
  OLLAMA_API_KEY: string;
  ENVIRONMENT: string;
  /** One-time setup secret for initial admin provisioning. Must match wrangler secret. */
  SETUP_SECRET?: string;
  SENTRY_DSN?: string;
  /**
   * Queue binding for catalyst execution fan-out + DAG chaining.
   * Optional so local/test environments without the binding still compile.
   * Declared in wrangler.toml as [[queues.producers]] queue="catalyst-tasks".
   */
  CATALYST_QUEUE?: Queue<unknown>;
}

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  permissions: string[];
}

export interface AppBindings {
  Bindings: Env;
  Variables: {
    auth: AuthContext;
    /** Set by requestIdMiddleware (workers/api/src/middleware/requestid.ts) on every request. */
    requestId: string;
  };
}

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string;
  permissions: string[];
  iat: number;
  exp: number;
}

export type DeploymentModel = 'saas' | 'on-premise' | 'hybrid';
export type AutonomyTier = 'read-only' | 'assisted' | 'transactional';
export type AtheonLayer = 'apex' | 'pulse' | 'catalysts' | 'mind' | 'memory';
export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IndustryVertical = 'fmcg' | 'healthcare' | 'mining' | 'general' | 'agriculture' | 'logistics' | 'technology' | 'manufacturing' | 'retail';
