/**
 * SPEC-007: Retry utility with exponential backoff and jitter
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableStatuses?: number[];
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  onRetry: () => {},
};

/** Calculate delay with exponential backoff + jitter */
function calculateDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, maxMs);
}

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a fetch request with exponential backoff.
 * Only retries on network errors and retryable HTTP status codes.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOpts?: RetryOptions,
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...retryOpts };

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Don't retry non-retryable status codes
      if (!opts.retryableStatuses.includes(response.status)) {
        return response;
      }

      // If this was the last attempt, return the response as-is
      if (attempt === opts.maxRetries) {
        return response;
      }

      // Respect Retry-After header if present (supports both seconds and HTTP-date formats)
      const retryAfter = response.headers.get('Retry-After');
      let delayMs: number;
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed)) {
          delayMs = parsed * 1000;
        } else {
          const retryDate = new Date(retryAfter).getTime();
          delayMs = isNaN(retryDate) ? calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs) : Math.max(0, retryDate - Date.now());
        }
      } else {
        delayMs = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      }

      opts.onRetry(attempt + 1, new Error(`HTTP ${response.status}`));
      await sleep(delayMs);
    } catch (error) {
      // Network error — retry if we have attempts left
      if (attempt === opts.maxRetries) {
        throw error;
      }

      const delayMs = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      opts.onRetry(attempt + 1, error instanceof Error ? error : new Error(String(error)));
      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error('Retry loop exhausted');
}

/**
 * Generic retry wrapper for any async function.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retryOpts?: Omit<RetryOptions, 'retryableStatuses'> & { shouldRetry?: (error: Error) => boolean },
): Promise<T> {
  const maxRetries = retryOpts?.maxRetries ?? 3;
  const baseDelayMs = retryOpts?.baseDelayMs ?? 500;
  const maxDelayMs = retryOpts?.maxDelayMs ?? 10000;
  const shouldRetry = retryOpts?.shouldRetry ?? (() => true);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxRetries || !shouldRetry(err)) {
        throw err;
      }
      const delayMs = calculateDelay(attempt, baseDelayMs, maxDelayMs);
      retryOpts?.onRetry?.(attempt + 1, err);
      await sleep(delayMs);
    }
  }

  throw new Error('Retry loop exhausted');
}
