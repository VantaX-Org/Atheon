import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { ScoreRing } from "@/components/ui/score-ring";
import type { HealthScore, Risk, ActionItem } from "@/lib/api";
import { RefreshCw, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";

export function ExecutiveMobilePage() {
  const user = useAppStore((s) => s.user);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const pullRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const [h, r, a] = await Promise.all([
        api.apex.healthScore(),
        api.apex.risks(),
        api.apex.actions(),
      ]);
      setHealth(h);
      setRisks(r.risks || []);
      setActions(a.actions || []);
    } catch (err) {
      console.error("Executive mobile data fetch failed", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
        </div>

        {/* KPI Cards - horizontal scroll-snap */}
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4" style={{ scrollbarWidth: "none" }}>
          {(health?.dimensions || []).map((dim, i) => (
            <div key={i} className="snap-center flex-shrink-0 w-[140px] rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", minHeight: 44 }}>
              <p className="text-[10px] t-muted uppercase tracking-wider mb-1">{dim.label}</p>
              <p className="text-xl font-bold t-primary">{dim.score}</p>
              <div className="flex items-center gap-1 mt-1">{trendIcon(dim.trend)}<span className="text-xs t-muted">{dim.trend || "stable"}</span></div>
            </div>
          ))}
        </div>

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
                    <div className="flex-1 min-w-0 mr-3"><p className="text-xs t-primary truncate">{action.title || action.description}</p></div>
                    <button className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500" aria-label="Approve"><CheckCircle2 size={18} /></button>
                  </div>
                ))}
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
                  <div key={i} className="flex items-start gap-3 py-2 px-3 rounded-lg" style={{ background: "var(--bg-secondary)" }}>
                    <AlertTriangle size={16} className={risk.severity === "critical" ? "text-red-500" : risk.severity === "high" ? "text-orange-500" : "text-amber-500"} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium t-primary">{risk.title}</p>
                      <p className="text-[11px] t-muted mt-0.5 line-clamp-2">{risk.description}</p>
                    </div>
                    <ArrowRight size={14} className="t-muted flex-shrink-0 mt-0.5" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
