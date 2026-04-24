/**
 * MetricFilterBar — multi-select filter & search bar for the Pulse metrics list.
 *
 * Spec: FRONTEND_ENHANCEMENTS.md §2.2.1
 *  - Fuzzy (case-insensitive substring) search against metric.name
 *  - Multi-select status pills (red | amber | green) — empty = all
 *  - Multi-select category pills derived from source_system — empty = all
 *  - Result count display
 *
 * Styling: matches existing Pulse filter pills (bg-accent/20 for active).
 */
import { Search, Filter, X } from "lucide-react";

export type MetricStatus = "green" | "amber" | "red";

interface MetricFilterBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: MetricStatus[];
  onStatusFilterChange: (next: MetricStatus[]) => void;
  categoryFilter: string[];
  onCategoryFilterChange: (next: string[]) => void;
  availableCategories: string[];
  resultCount: number;
  totalCount: number;
}

const STATUS_OPTIONS: { value: MetricStatus; label: string; dotClass: string }[] = [
  { value: "red", label: "Red", dotClass: "bg-red-500" },
  { value: "amber", label: "Amber", dotClass: "bg-amber-500" },
  { value: "green", label: "Green", dotClass: "bg-emerald-500" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function MetricFilterBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  availableCategories,
  resultCount,
  totalCount,
}: MetricFilterBarProps) {
  const hasActiveFilters =
    searchQuery.length > 0 || statusFilter.length > 0 || categoryFilter.length > 0;

  const clearAll = () => {
    onSearchChange("");
    onStatusFilterChange([]);
    onCategoryFilterChange([]);
  };

  return (
    <div className="space-y-2 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input */}
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            aria-label="Search metrics"
            className="w-full pl-9 pr-8 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary focus:outline-none focus:border-accent/40"
            placeholder="Search metrics..."
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

        {/* Status filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter size={14} className="text-gray-400" aria-hidden="true" />
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

        {/* Result count + clear */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs t-muted whitespace-nowrap">
            Showing <span className="t-primary font-medium">{resultCount}</span> of{" "}
            <span className="t-primary font-medium">{totalCount}</span>{" "}
            metric{totalCount !== 1 ? "s" : ""}
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

      {/* Category filter (source_system) */}
      {availableCategories.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] t-muted uppercase tracking-wider mr-1">
            Category:
          </span>
          {availableCategories.map((cat) => {
            const active = categoryFilter.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onCategoryFilterChange(toggle(categoryFilter, cat))}
                aria-pressed={active}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-all capitalize ${
                  active
                    ? "bg-accent/20 text-accent border border-accent/30"
                    : "bg-[var(--bg-secondary)] border border-[var(--border-card)] t-muted hover:border-gray-400"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
