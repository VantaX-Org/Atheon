/**
 * RunItemsFilterBar — search & multi-filter bar for the CatalystRunDetail page.
 *
 * Spec: FRONTEND_ENHANCEMENTS.md §2.4.1
 *  - Search input for item refs / entities / discrepancy reasons
 *  - Multi-select status pills (matched | discrepancy | unmatched | exception)
 *  - Multi-select review pills (pending | approved | rejected | deferred)
 *  - Severity pills (low | medium | high | critical) — only show when discrepancies exist
 *  - "Showing X of Y" result count
 *
 * Styling follows MetricFilterBar (accent/20 active pills).
 */
import { Search, Filter, X } from "lucide-react";

export type ItemStatus = "matched" | "discrepancy" | "unmatched_source" | "unmatched_target" | "exception";
export type ReviewStatus = "pending" | "approved" | "rejected" | "deferred";
export type Severity = "low" | "medium" | "high" | "critical";

interface RunItemsFilterBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: ItemStatus[];
  onStatusFilterChange: (next: ItemStatus[]) => void;
  reviewFilter: ReviewStatus[];
  onReviewFilterChange: (next: ReviewStatus[]) => void;
  severityFilter: Severity[];
  onSeverityFilterChange: (next: Severity[]) => void;
  resultCount: number;
  totalCount: number;
}

const STATUS_OPTIONS: { value: ItemStatus; label: string; dotClass: string }[] = [
  { value: "matched", label: "Matched", dotClass: "bg-emerald-500" },
  { value: "discrepancy", label: "Discrepancy", dotClass: "bg-amber-500" },
  { value: "unmatched_source", label: "Unmatched (Source)", dotClass: "bg-gray-400" },
  { value: "unmatched_target", label: "Unmatched (Target)", dotClass: "bg-gray-400" },
  { value: "exception", label: "Exception", dotClass: "bg-red-500" },
];

const REVIEW_OPTIONS: { value: ReviewStatus; label: string; dotClass: string }[] = [
  { value: "pending", label: "Pending", dotClass: "bg-blue-400" },
  { value: "approved", label: "Approved", dotClass: "bg-emerald-500" },
  { value: "rejected", label: "Rejected", dotClass: "bg-red-500" },
  { value: "deferred", label: "Deferred", dotClass: "bg-amber-500" },
];

const SEVERITY_OPTIONS: { value: Severity; label: string; dotClass: string }[] = [
  { value: "low", label: "Low", dotClass: "bg-emerald-400" },
  { value: "medium", label: "Medium", dotClass: "bg-amber-400" },
  { value: "high", label: "High", dotClass: "bg-orange-500" },
  { value: "critical", label: "Critical", dotClass: "bg-red-500" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function RunItemsFilterBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  reviewFilter,
  onReviewFilterChange,
  severityFilter,
  onSeverityFilterChange,
  resultCount,
  totalCount,
}: RunItemsFilterBarProps) {
  const hasActiveFilters =
    searchQuery.length > 0 ||
    statusFilter.length > 0 ||
    reviewFilter.length > 0 ||
    severityFilter.length > 0;

  const clearAll = () => {
    onSearchChange("");
    onStatusFilterChange([]);
    onReviewFilterChange([]);
    onSeverityFilterChange([]);
  };

  return (
    <div className="space-y-2 mb-4">
      {/* Search + result count */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48 max-w-md">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            aria-label="Search items"
            className="w-full pl-9 pr-8 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary focus:outline-none focus:border-accent/40"
            placeholder="Search by ref, entity, or discrepancy reason..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:t-primary"
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs t-muted whitespace-nowrap">
            Showing <span className="t-primary font-medium">{resultCount}</span> of{" "}
            <span className="t-primary font-medium">{totalCount}</span>{" "}
            item{totalCount !== 1 ? "s" : ""}
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[10px] text-accent hover:text-accent/80 transition-colors"
              title="Clear all filters"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter size={14} className="text-gray-400" aria-hidden="true" />
        <span className="text-[10px] t-muted uppercase tracking-wider mr-1">Status:</span>
        {STATUS_OPTIONS.map((opt) => {
          const active = statusFilter.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onStatusFilterChange(toggle(statusFilter, opt.value))}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                active
                  ? "bg-accent/20 text-accent border border-accent/30"
                  : "bg-[var(--bg-secondary)] border border-[var(--border-card)] t-muted hover:border-gray-400"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${opt.dotClass}`} aria-hidden="true" />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Review filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] t-muted uppercase tracking-wider mr-1 ml-[18px]">
          Review:
        </span>
        {REVIEW_OPTIONS.map((opt) => {
          const active = reviewFilter.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onReviewFilterChange(toggle(reviewFilter, opt.value))}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                active
                  ? "bg-accent/20 text-accent border border-accent/30"
                  : "bg-[var(--bg-secondary)] border border-[var(--border-card)] t-muted hover:border-gray-400"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${opt.dotClass}`} aria-hidden="true" />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Severity filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] t-muted uppercase tracking-wider mr-1 ml-[18px]">
          Severity:
        </span>
        {SEVERITY_OPTIONS.map((opt) => {
          const active = severityFilter.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSeverityFilterChange(toggle(severityFilter, opt.value))}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium transition-all ${
                active
                  ? "bg-accent/20 text-accent border border-accent/30"
                  : "bg-[var(--bg-secondary)] border border-[var(--border-card)] t-muted hover:border-gray-400"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${opt.dotClass}`} aria-hidden="true" />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
