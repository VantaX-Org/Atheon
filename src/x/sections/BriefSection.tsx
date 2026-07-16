// Brief: the world acting on the business, the business's own health and
// plumbing, and what the detectors found. Confirmed leakage is the headline;
// unverified potential renders separately and is never summed into it.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AssessmentFinding, AssessmentFindingsSummary, ERPConnection, StrategicContext } from '@/lib/api';
import { latestCompleteAssessment } from '@/lib/latest-assessment';
import { useSelectedCompanyId } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import { useTenantCurrency } from '@/stores/appStore';
import type { Persona } from '../persona';

// display subset — older assessments lack findings_summary, so findings can
// also come from the /findings endpoint folded into this shape
type BriefFinding = Pick<AssessmentFinding, 'id' | 'title' | 'severity' | 'value_at_risk_zar' | 'affected_count'> & {
  category: string;
  evidence_quality?: AssessmentFinding['evidence_quality'];
};
type BriefSummary = Pick<AssessmentFindingsSummary, 'total_count' | 'total_value_at_risk_zar' | 'potential_unverified_zar'>;

interface BriefData {
  ctx: StrategicContext | null;
  connections: ERPConnection[] | null;
  findings: BriefFinding[] | null;
  summary: BriefSummary | null;
}

export function BriefSection({ persona, onAskJeff }: { persona: Persona | null; onAskJeff: (ctx: string) => void }) {
  const companyId = useSelectedCompanyId();
  const currency = useTenantCurrency();
  const [data, setData] = useState<BriefData>({ ctx: null, connections: null, findings: null, summary: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [ctx, conns, assessList] = await Promise.allSettled([
        api.radar.context(),
        api.erp.connections(),
        api.assessments.list(),
      ]);
      let findings: BriefFinding[] | null = null;
      let summary: BriefSummary | null = null;
      if (assessList.status === 'fulfilled') {
        const latest = latestCompleteAssessment(assessList.value.assessments);
        if (latest) {
          try {
            const detail = await api.assessments.get(latest.id);
            findings = detail.results?.findings ?? null;
            summary = detail.results?.findings_summary ?? null;
            if (!summary) {
              // older assessments (live demo included) — fold raw findings
              const raw = (await api.assessments.findings(latest.id)).findings;
              if (raw.length) {
                findings = raw.map((f) => ({
                  id: f.id, title: f.title, severity: f.severity,
                  value_at_risk_zar: f.financial_impact || 0,
                  affected_count: f.affected_records || 0,
                  category: f.domain,
                }));
                summary = {
                  total_count: raw.length,
                  total_value_at_risk_zar: raw.reduce((s, f) => s + (f.financial_impact || 0), 0),
                };
              }
            }
          } catch { /* stays null → em-dash */ }
        }
      }
      if (cancelled) return;
      setData({
        ctx: ctx.status === 'fulfilled' ? ctx.value : null,
        connections: conns.status === 'fulfilled' ? conns.value.connections : null,
        findings,
        summary,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const { ctx, connections, findings, summary } = data;
  const money = (v: number | null | undefined) => formatCompactCurrency(v ?? null, currency);

  // Persona lens re-orders findings — opsFirst categories surface first,
  // then by confirmed value. Nothing is hidden.
  const opsFirst = persona?.opsFirst ?? [];
  const topFindings = findings
    ? [...findings].sort((a, b) => {
        const ai = opsFirst.indexOf(a.category); const bi = opsFirst.indexOf(b.category);
        const ar = ai === -1 ? opsFirst.length : ai; const br = bi === -1 ? opsFirst.length : bi;
        return ar !== br ? ar - br : b.value_at_risk_zar - a.value_at_risk_zar;
      }).slice(0, 6)
    : null;

  const broken = connections?.filter((c) => c.status === 'error' || c.status === 'failed') ?? [];
  // deploy-skew guard: older API returned the deadline array itself, not a count
  const regDeadlines = ctx == null ? null
    : Array.isArray(ctx.regulatoryDeadlines) ? (ctx.regulatoryDeadlines as unknown[]).length
    : ctx.regulatoryDeadlines;

  return (
    <section id="brief">
      <div className="head">
        <span className="kicker">Brief</span>
        <h2>What is happening to the business</h2>
      </div>

      <div className="hero">
        <div>
          <span className="kicker">Confirmed leakage detected</span>
          <p className="hero-big num">{loading ? '…' : money(summary?.total_value_at_risk_zar)}</p>
          {summary?.potential_unverified_zar != null && summary.potential_unverified_zar > 0 && (
            <span className="chip-up" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
              + {money(summary.potential_unverified_zar)} potential, unverified — not in the headline
            </span>
          )}
        </div>
        <div className="hero-side">
          <div className="s">
            <button className="num" onClick={() => onAskJeff(`Health score ${ctx?.healthScore ?? '—'} vs industry ${ctx?.industryBenchmark ?? '—'}`)}>
              {ctx ? ctx.healthScore : '—'}<small style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>{ctx?.industryBenchmark != null ? ` vs ${ctx.industryBenchmark}` : ''}</small>
            </button>
            <small>Business health vs industry</small>
          </div>
          <div className="s">
            <button className="num" onClick={() => onAskJeff(`${connections?.length ?? '—'} systems connected, ${broken.length} broken`)}>
              {connections ? connections.length : '—'}
            </button>
            <small>{broken.length > 0 ? `Systems connected · ${broken.length} broken` : 'Systems connected'}</small>
          </div>
          <div className="s">
            <button className="num" onClick={() => onAskJeff(`${regDeadlines ?? '—'} regulatory deadlines approaching`)}>
              {regDeadlines ?? '—'}
            </button>
            <small>Regulatory deadlines</small>
          </div>
        </div>
      </div>

      <div className="cards">
        <div className="card" id="world">
          <h3>The world <span className="meta">external signals</span></h3>
          {ctx ? (
            <>
              {ctx.contextNarrative && <p className="rc-ai">{ctx.contextNarrative}</p>}
              {(ctx.headwinds ?? []).slice(0, 3).map((h) => (
                <div key={h.id} className="rowline">
                  <span className="pill warn">headwind</span>
                  <p><b>{h.healthDimension}</b> — {h.recommendedResponse ?? `${h.impactTimeline} impact`}</p>
                </div>
              ))}
              {(ctx.tailwinds ?? []).slice(0, 2).map((t) => (
                <div key={t.id} className="rowline">
                  <span className="pill ok">tailwind</span>
                  <p><b>{t.healthDimension}</b> — {t.recommendedResponse ?? `${t.impactTimeline} impact`}</p>
                </div>
              ))}
              {(ctx.topSignals ?? []).slice(0, 3).map((s) => (
                <div key={s.id} className="rowline">
                  <p>
                    <b>{s.title}</b>
                    <span className="when">
                      {s.sourceUrl
                        ? <a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.sourceName ?? 'source'}</a>
                        : (s.sourceName ?? '')}
                    </span>
                  </p>
                </div>
              ))}
            </>
          ) : (
            <p className="flow-note">{loading ? 'Loading…' : "— couldn't load external signals"}</p>
          )}
        </div>

        <div className="card" id="plumbing">
          <h3>The plumbing <span className="meta">connected systems</span></h3>
          {connections ? (
            connections.length === 0 ? (
              <p className="flow-note">No systems connected yet.</p>
            ) : (
              connections.map((c) => (
                <div key={c.id} className="rowline">
                  <span className={`pill ${c.status === 'error' || c.status === 'failed' ? 'warn' : c.status === 'connected' || c.status === 'active' ? 'ok' : 'grey'}`}
                    style={c.status === 'error' || c.status === 'failed' ? { color: 'var(--bad)', background: 'var(--bad-soft)' } : undefined}>
                    {c.status}
                  </span>
                  <p><b>{c.name}</b> — {c.adapterName}
                    <span className="when">{c.lastSync ? `Last sync ${new Date(c.lastSync).toLocaleDateString()}` : 'Never synced'} · {c.recordsSynced.toLocaleString()} records</span>
                  </p>
                </div>
              ))
            )
          ) : (
            <p className="flow-note">{loading ? 'Loading…' : "— couldn't load connections"}</p>
          )}
        </div>
      </div>

      <div className="card" id="leaks" style={{ marginTop: '1rem' }}>
        <h3>Where it leaks <span className="meta">{summary ? `${summary.total_count} findings` : ''}</span></h3>
        {topFindings ? (
          topFindings.map((f) => (
            <div key={f.id} className="rowline">
              <button className="amt num" onClick={() => onAskJeff(`Finding "${f.title}" — ${money(f.value_at_risk_zar)} at risk, severity ${f.severity}`)}>
                {money(f.value_at_risk_zar)}
              </button>
              <p>
                <b>{f.title}</b> — {f.affected_count.toLocaleString()} records affected
                <span className="when">{f.category.replace('_', ' ')}{f.evidence_quality ? ` · evidence ${f.evidence_quality}` : ''}</span>
              </p>
              <span className={`pill ${f.severity === 'critical' || f.severity === 'high' ? 'warn' : 'grey'}`}>{f.severity}</span>
            </div>
          ))
        ) : (
          <p className="flow-note">{loading ? 'Loading…' : '— no completed assessment yet'}</p>
        )}
      </div>
    </section>
  );
}
