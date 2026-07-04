/**
 * latestCompleteAssessment — the single source of truth for "which assessment
 * do we read from". Every journey surface (Home exposure, /data latest-analysis
 * link, /findings headline + table) must agree on the same assessment, so the
 * selection rule lives here once: the newest COMPLETE assessment by createdAt,
 * or null when none has completed.
 *
 * Deliberately no "fall back to any assessment" clause — an incomplete
 * assessment has no defensible numbers, and surfacing its data while the
 * headline says "no completed analysis yet" is exactly the divergence this
 * helper removes.
 */
export function latestCompleteAssessment<T extends { status: string; createdAt?: string | null }>(
  assessments: T[],
): T | null {
  return (
    [...assessments]
      .filter((a) => a.status === 'complete')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] ?? null
  );
}
