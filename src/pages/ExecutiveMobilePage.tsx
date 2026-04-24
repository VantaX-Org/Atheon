/**
 * §11.8 Executive Mobile View — lightweight executive dashboard.
 *
 * This page is the responsive/mobile companion to ApexPage. ApexPage now carries
 * all the deep analysis (dimension comparison, trend chart, risk heat map, scenario
 * compare). This page is the quick-glance summary: overall score, KPI dimensions,
 * pending actions, and top risks — with drill-down links into Apex for detail.
 *
 * Data sources (all verified against workers/api/src/routes):
 *   - GET /api/apex/health?company_id=...                       (apex.ts)
 *   - GET /api/apex/risks?company_id=...                        (apex.ts)
 *   - GET /api/catalysts/governance?company_id=...              (catalysts.ts) — pending actions
 *
 * CONSOLIDATION NOTE: ApexPage is already responsive and now carries richer
 * analytics; this page duplicates the summary block. Candidate for merger in a
 * future PR (see docs/FEATURE_AUDIT.md §5). We keep it alive because it adds
 * pull-to-refresh, a horizontal snap KPI strip, and a fast path to drill-downs
 * that isn't duplicated on Apex.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAppStore, useSelectedCompanyId } from "@/stores/appStore";
import { useToast } from "@/components/ui/toast";
import { ScoreRing } from "@/components/ui/score-ring";
import type { HealthScore, Risk, ActionItem } from "@/lib/api";
import { RefreshCw, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, ArrowRight, ExternalLink } from "lucide-react";

export function ExecutiveMobilePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAppStore((s) => s.user);
  const companyId = useSelectedCompanyId();
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const pullRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [h, r] = await Promise.all([
        api.apex.health(undefined, undefined, companyId || undefined),
        api.apex.risks(undefined, undefined, companyId || undefined),
      ]);
      setHealth(h);
      setRisks(r.risks || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load executive summary";
      setError(message);
      toast.error("Failed to load executive summary", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }
    // Governance (pending catalyst actions) is optional — its absence shouldn't
    // block the rest of the page.
    try {
      const actData = await api.catalysts.governance(undefined, undefined, companyId || undefined);
      const pending = (actData as { actions?: ActionItem[] }).actions || [];
      setActions(pending);
    } catch {
      setActions([]);
    }
    setLoading(false);
    setRefreshing(false);
  }, [companyId, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (pullRef.current && pullRef.current.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0 && pullRef.current && pullRef.current.scrollTop === 0) {
      setPullDistance(Math.min(diff * 0.5, 80));
    }
  };
  const handleTouchEnd = () => {
    if (pullDistance > 50) { setRefreshing(true); fetchData(); }
    setPullDistance(0);
  };

  const trendIcon = (trend?: string) => {
    if (trend === "up" || trend === "improving") return <TrendingUp className="w-4 h-4 text-emerald-500" />;
    if (trend === "down" || trend === "declining") return <TrendingDown className="w-4 h-4 text-red-500" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="animate-pulse space-y-4 w-full max-w-sm px-4">
          <div className="h-48 rounded-2xl bg-[var(--bg-secondary)]" />
          <div className="flex gap-3 overflow-hidden">
            {[1,2,3].map(i => <div key={i} className="h-24 w-32 flex-shrink-0 rounded-xl bg-[var(--bg-secondary)]" />)}
          </div>
          <div className="h-32 rounded-xl bg-[var(--bg-secondary)]" />
        </div>
      </div>
    );
  }

  if (error && !health) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-primary)" }}>
        <div className="text-center space-y-3 max-w-sm">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-sm t-primary">{error}</p>
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors"
          >
            Retry
          </button>
          <p className="text-[10px] t-muted">
            Need the full view? <button onClick={() => navigate('/apex')} className="underline text-accent">Open Apex</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={pullRef} className="min-h-screen overflow-y-auto" style={{ background: "var(--bg-primary)" }} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {pullDistance > 0 && (
        <div className="flex justify-center py-2" style={{ height: pullDistance }}>
          <RefreshCw className={`w-5 h-5 t-muted ${pullDistance > 50 ? "text-accent" : ""}`} style={{ transform: `rotate(${pullDistance * 3}deg)` }} />
        </div>
      )}
      {refreshing && <div className="flex justify-center py-3"><RefreshCw className="w-5 h-5 text-accent animate-spin" /></div>}

      <div className="px-4 pt-6 pb-8 max-w-lg mx-auto space-y-5">
        <div className="text-center">
          <p className="text-sm t-muted mb-3">
            {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, {user?.name?.split(" ")[0] || "there"}
          </p>
          <div className="flex justify-center mb-3"><ScoreRing score={health?.overall || 0} size="xl" /></div>
          <p className="text-xs t-muted">Business Health Score</p>
          <button
            onClick={() => navigate('/apex')}
            className="mt-3 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
            aria-label="Open Apex for full analytics"
          >
            View full analytics <ExternalLink size={11} />
          </button>
        </div>

        {/* KPI Cards - horizontal scroll-snap. Tapping drills into Apex. */}
        {health?.dimensions && Object.keys(health.dimensions).length > 0 && (
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4" style={{ scrollbarWidth: "none" }}>
            {Object.entries(health.dimensions).map(([key, dim], i) => (
              <button
                key={i}
                onClick={() => navigate('/apex')}
                className="snap-center flex-shrink-0 w-[140px] rounded-xl p-4 text-left hover:bg-[var(--bg-secondary)] transition-colors"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", minHeight: 44 }}
                aria-label={`${key} dimension — open Apex for detail`}
              >
                <p className="text-[10px] t-muted uppercase tracking-wider mb-1">{key.replace(/[-_]/g, ' ')}</p>
                <p className="text-xl font-bold t-primary">{dim.score}</p>
                <div className="flex items-center gap-1 mt-1">{trendIcon(dim.trend)}<span className="text-xs t-muted">{dim.trend || "stable"}</span></div>
              </button>
            ))}
          </div>
        )}

        {actions.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
            <button onClick={() => setExpandedSection(expandedSection === "actions" ? null : "actions")} className="w-full flex items-center justify-between min-h-[44px]">
              <h3 className="text-sm font-semibold t-primary">Pending Actions ({actions.length})</h3>
              {expandedSection === "actions" ? <ChevronUp size={16} className="t-muted" /> : <ChevronDown size={16} className="t-muted" />}
            </button>
            {expandedSection === "actions" && (
              <div className="mt-3 space-y-2">
                {actions.slice(0, 5).map((action, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: "var(--bg-secondary)" }}>
                    <div className="flex-1 min-w-0 mr-3"><p className="text-xs t-primary truncate">{action.action || action.catalystName}</p></div>
                    <button
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500"
                      aria-label="Review action in Catalysts"
                      onClick={() => navigate('/catalysts')}
                    >
                      <CheckCircle2 size={18} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => navigate('/catalysts')}
                  className="w-full text-[11px] text-accent hover:underline py-1"
                >
                  Open Catalysts governance →
                </button>
              </div>
            )}
          </div>
        )}

        {risks.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
            <button onClick={() => setExpandedSection(expandedSection === "risks" ? null : "risks")} className="w-full flex items-center justify-between min-h-[44px]">
              <h3 className="text-sm font-semibold t-primary">Risk Alerts ({risks.length})</h3>
              {expandedSection === "risks" ? <ChevronUp size={16} className="t-muted" /> : <ChevronDown size={16} className="t-muted" />}
            </button>
            {expandedSection === "risks" && (
              <div className="mt-3 space-y-2">
                {risks.slice(0, 5).map((risk, i) => (
                  <button
                    key={i}
                    onClick={() => navigate('/apex')}
                    className="w-full flex items-start gap-3 py-2 px-3 rounded-lg text-left hover:bg-[var(--bg-primary)] transition-colors"
                    style={{ background: "var(--bg-secondary)" }}
                    aria-label={`Open risk ${risk.title} in Apex`}
                  >
                    <AlertTriangle size={16} className={risk.severity === "critical" ? "text-red-500" : risk.severity === "high" ? "text-orange-500" : "text-amber-500"} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium t-primary">{risk.title}</p>
                      <p className="text-[11px] t-muted mt-0.5 line-clamp-2">{risk.description}</p>
                    </div>
                    <ArrowRight size={14} className="t-muted flex-shrink-0 mt-0.5" />
                  </button>
                ))}
                <button
                  onClick={() => navigate('/apex')}
                  className="w-full text-[11px] text-accent hover:underline py-1"
                >
                  Open full risk register →
                </button>
              </div>
            )}
          </div>
        )}

        {risks.length === 0 && actions.length === 0 && (
          <div className="rounded-xl p-6 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-medium t-primary">All clear</p>
            <p className="text-xs t-muted mt-1">No pending actions or risk alerts right now.</p>
          </div>
        )}
      </div>
    </div>
  );
}
