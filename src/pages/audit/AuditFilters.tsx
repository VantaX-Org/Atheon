import { Search, Filter, Calendar, Download } from "lucide-react";

interface AuditFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  dateRange: { from: string; to: string };
  onDateRangeChange: (range: { from: string; to: string }) => void;
  eventType: string;
  onEventTypeChange: (type: string) => void;
  onExport: () => void;
}

const EVENT_TYPES = [
  { value: '', label: 'All Events' },
  { value: 'auth', label: 'Authentication' },
  { value: 'catalyst', label: 'Catalyst Execution' },
  { value: 'user', label: 'User Management' },
  { value: 'settings', label: 'Settings Changes' },
  { value: 'data', label: 'Data Operations' },
  { value: 'api', label: 'API Access' },
];

export function AuditFilters({ search, onSearchChange, dateRange, onDateRangeChange, eventType, onEventTypeChange, onExport }: AuditFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Search size={14} className="t-muted flex-shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search audit logs..."
          className="flex-1 bg-transparent text-sm t-primary placeholder:t-muted outline-none"
          aria-label="Search audit logs"
        />
      </div>
      <div className="flex items-center gap-2">
        <Filter size={14} className="t-muted" />
        <select
          value={eventType}
          onChange={(e) => onEventTypeChange(e.target.value)}
          className="text-xs bg-[var(--bg-secondary)] t-primary rounded-lg px-2 py-1.5 border border-[var(--border-card)] outline-none"
          aria-label="Filter by event type"
        >
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Calendar size={14} className="t-muted" />
        <input
          type="date"
          value={dateRange.from}
          onChange={(e) => onDateRangeChange({ ...dateRange, from: e.target.value })}
          className="text-xs bg-[var(--bg-secondary)] t-primary rounded-lg px-2 py-1.5 border border-[var(--border-card)] outline-none"
          aria-label="Start date"
        />
        <span className="text-xs t-muted">to</span>
        <input
          type="date"
          value={dateRange.to}
          onChange={(e) => onDateRangeChange({ ...dateRange, to: e.target.value })}
          className="text-xs bg-[var(--bg-secondary)] t-primary rounded-lg px-2 py-1.5 border border-[var(--border-card)] outline-none"
          aria-label="End date"
        />
      </div>
      <button
        onClick={onExport}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-all"
        aria-label="Export audit logs"
      >
        <Download size={12} /> Export
      </button>
    </div>
  );
}
