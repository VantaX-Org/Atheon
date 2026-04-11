// TASK-004: Global Error Handling with exponential backoff, rate limit handling, offline detection

type RequestInit2 = RequestInit & { _retryCount?: number };

interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
  onOffline?: () => void;
  onRateLimited?: (retryAfter: number) => void;
  maxRetries?: number;
}

class ApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;

  constructor(message: string, status: number, code: string = 'UNKNOWN') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = status >= 500 || status === 429;
  }
}

// Offline detection
let isOffline = !navigator.onLine;
const offlineListeners = new Set<(offline: boolean) => void>();

window.addEventListener('online', () => {
  isOffline = false;
  offlineListeners.forEach(fn => fn(false));
});
window.addEventListener('offline', () => {
  isOffline = true;
  offlineListeners.forEach(fn => fn(true));
});

export function onOfflineChange(fn: (offline: boolean) => void): () => void {
  offlineListeners.add(fn);
  return () => offlineListeners.delete(fn);
}

export function getIsOffline(): boolean {
  return isOffline;
}

// Exponential backoff with jitter
function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = delay * 0.5 * Math.random();
  return delay + jitter;
}

export function createApiClient(config: ApiClientConfig) {
  const { baseUrl, getToken, onUnauthorized, onOffline, onRateLimited, maxRetries = 3 } = config;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestInit2 = {},
  ): Promise<T> {
    const retryCount = options._retryCount || 0;

    // Check offline
    if (isOffline) {
      onOffline?.();
      throw new ApiError('You are currently offline. Please check your internet connection and try again.', 0, 'OFFLINE');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const tenantId = localStorage.getItem('tenant_id');
    if (tenantId) {
      headers['X-Tenant-ID'] = tenantId;
    }

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        ...options,
      });

      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        onRateLimited?.(retryAfter);
        
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          return request<T>(method, path, body, { ...options, _retryCount: retryCount + 1 });
        }
        throw new ApiError(
          'Too many requests. Please wait a moment and try again.',
          429,
          'RATE_LIMITED'
        );
      }

      // Handle unauthorized (401)
      if (response.status === 401) {
        onUnauthorized?.();
        throw new ApiError('Your session has expired. Please log in again.', 401, 'UNAUTHORIZED');
      }

      // Handle forbidden (403)
      if (response.status === 403) {
        throw new ApiError('You do not have permission to perform this action.', 403, 'FORBIDDEN');
      }

      // Handle server errors with retry
      if (response.status >= 500 && retryCount < maxRetries) {
        const delay = backoffDelay(retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return request<T>(method, path, body, { ...options, _retryCount: retryCount + 1 });
      }

      // Handle other errors
      if (!response.ok) {
        let errorMessage = 'An unexpected error occurred. Please try again.';
        try {
          const errorData = await response.json() as { message?: string; error?: string };
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          // Response not JSON
        }
        throw new ApiError(errorMessage, response.status);
      }

      // Handle empty responses
      if (response.status === 204) {
        return undefined as T;
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;

      // Network errors - retry with backoff
      if (error instanceof TypeError && error.message.includes('fetch')) {
        if (retryCount < maxRetries) {
          const delay = backoffDelay(retryCount);
          await new Promise(resolve => setTimeout(resolve, delay));
          return request<T>(method, path, body, { ...options, _retryCount: retryCount + 1 });
        }
        throw new ApiError(
          'Unable to connect to the server. Please check your internet connection.',
          0,
          'NETWORK_ERROR'
        );
      }

      throw error;
    }
  }

  return {
    get: <T>(path: string, options?: RequestInit2) => request<T>('GET', path, undefined, options),
    post: <T>(path: string, body?: unknown, options?: RequestInit2) => request<T>('POST', path, body, options),
    put: <T>(path: string, body?: unknown, options?: RequestInit2) => request<T>('PUT', path, body, options),
    delete: <T>(path: string, options?: RequestInit2) => request<T>('DELETE', path, undefined, options),
    patch: <T>(path: string, body?: unknown, options?: RequestInit2) => request<T>('PATCH', path, body, options),
  };
}

export { ApiError };
export type { ApiClientConfig };
