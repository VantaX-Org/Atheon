// Session-drop regression: a transient failure (429/5xx) on /api/auth/refresh
// must NOT destroy the session. Only a 401/403 from the refresh endpoint
// (dead refresh token) may clear tokens and redirect to login.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, setToken, getToken, ApiError } from '../api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockFetch(routes: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => routes(String(input))));
}

describe('401 interceptor refresh outcomes', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setToken('access-token', 'refresh-token');
  });

  it('keeps tokens when refresh is rate-limited (transient)', async () => {
    mockFetch((url) =>
      url.includes('/api/auth/refresh')
        ? json(429, { error: 'Rate limit exceeded' })
        : json(401, { error: 'Unauthorized' }),
    );
    await expect(api.tenants.list()).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe('access-token'); // session survives
    expect(localStorage.getItem('atheon_refresh_token')).toBe('refresh-token');
  });

  it('clears tokens when the refresh token itself is dead (fatal)', async () => {
    mockFetch((url) =>
      url.includes('/api/auth/refresh')
        ? json(401, { error: 'Invalid or expired refresh token' })
        : json(401, { error: 'Unauthorized' }),
    );
    await expect(api.tenants.list()).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
    expect(localStorage.getItem('atheon_token')).toBeNull();
  });

  it('retries the original request after a successful refresh', async () => {
    let first = true;
    mockFetch((url) => {
      if (url.includes('/api/auth/refresh'))
        return json(200, { token: 'new-access', refreshToken: 'new-refresh' });
      if (first) { first = false; return json(401, { error: 'Unauthorized' }); }
      return json(200, { tenants: [], total: 0 });
    });
    await expect(api.tenants.list()).resolves.toEqual({ tenants: [], total: 0 });
    expect(getToken()).toBe('new-access');
  });
});
