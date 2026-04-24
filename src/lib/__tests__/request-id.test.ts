/**
 * Tests for the client-side request-ID utility (backend PR #222 correlation).
 */
import { describe, it, expect } from 'vitest';
import { generateRequestId, FRONTEND_REQUEST_ID_RE } from '../request-id';

describe('generateRequestId', () => {
  it('produces ids matching the fe-[0-9a-f]{16} shape', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateRequestId();
      expect(id).toMatch(FRONTEND_REQUEST_ID_RE);
      expect(id).toMatch(/^fe-[0-9a-f]{16}$/);
    }
  });

  it('produces 19-character ids (3 for fe- prefix + 16 hex)', () => {
    const id = generateRequestId();
    expect(id.length).toBe(19);
  });

  it('satisfies the backend [a-zA-Z0-9_-]{8,64} regex', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
  });

  it('starts with the fe- prefix so log readers can tell frontend-origin ids from server UUIDs', () => {
    const id = generateRequestId();
    expect(id.startsWith('fe-')).toBe(true);
  });

  it('produces different ids on successive calls', () => {
    // Collect a bunch — even with the Math.random fallback (test env) we should
    // not see duplicates at meaningful rates.
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(generateRequestId());
    expect(ids.size).toBeGreaterThan(45);
  });
});
