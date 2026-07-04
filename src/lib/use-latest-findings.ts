/**
 * useLatestFindings — fetch the value-assessment findings for the newest
 * completed assessment, sorted by financial impact. Shared by the dashboard
 * FindingsReviewTable (compact) and the audit BillingProofFindings (detailed)
 * so the assessment→findings fetch lives in exactly one place.
 *
 * Returns `null` while loading, `[]` when there is nothing to show (fresh
 * tenant, no completed assessment, or a failed fetch — every failure mode
 * collapses to the empty state, never a thrown error that blanks the page).
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ValueAssessmentFinding } from '@/lib/api';
import { latestCompleteAssessment } from '@/lib/latest-assessment';

export function useLatestFindings(limit = 6): ValueAssessmentFinding[] | null {
  const [findings, setFindings] = useState<ValueAssessmentFinding[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { assessments } = await api.assessments.list();
        const latest = latestCompleteAssessment(assessments);
        if (!latest) { if (!cancelled) setFindings([]); return; }
        const { findings } = await api.assessments.findings(latest.id);
        if (cancelled) return;
        setFindings([...findings].sort((a, b) => b.financial_impact - a.financial_impact).slice(0, limit));
      } catch {
        if (!cancelled) setFindings([]);
      }
    })();
    return () => { cancelled = true; };
  }, [limit]);

  return findings;
}
