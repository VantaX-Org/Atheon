import { describe, it, expect } from 'vitest';
import { latestCompleteAssessment } from '@/lib/latest-assessment';

const a = (id: string, status: string, createdAt: string) => ({ id, status, createdAt });

describe('latestCompleteAssessment', () => {
  it('returns the newest complete assessment by createdAt', () => {
    const list = [a('old', 'complete', '2026-01-01'), a('new', 'complete', '2026-07-01')];
    expect(latestCompleteAssessment(list)?.id).toBe('new');
  });

  it('ignores non-complete assessments even when newer', () => {
    const list = [a('done', 'complete', '2026-01-01'), a('running', 'running', '2026-07-01')];
    expect(latestCompleteAssessment(list)?.id).toBe('done');
  });

  it('returns null when nothing is complete (no fallback to incomplete work)', () => {
    const list = [a('r', 'running', '2026-07-01'), a('p', 'pending', '2026-06-01')];
    expect(latestCompleteAssessment(list)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(latestCompleteAssessment([])).toBeNull();
  });
});
