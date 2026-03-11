import { Button } from "@/components/ui/button";
import { RefreshCw, Inbox } from "lucide-react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

/** Phase 4.8: Reusable empty state component */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center mb-4">
        {icon || <Inbox className="w-6 h-6 text-gray-400" />}
      </div>
      <h3 className="text-sm font-semibold t-primary mb-1">{title}</h3>
      {description && <p className="text-xs t-muted max-w-xs">{description}</p>}
      {action && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={action.onClick} title={action.label}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

interface ErrorRetryProps {
  message?: string;
  onRetry: () => void;
  retrying?: boolean;
}

/** Phase 4.8: Reusable error state with retry button */
export function ErrorRetry({ message, onRetry, retrying }: ErrorRetryProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
      </div>
      <h3 className="text-sm font-semibold t-primary mb-1">Something went wrong</h3>
      <p className="text-xs t-muted max-w-xs mb-4">{message || 'Failed to load data. Please try again.'}</p>
      <Button variant="primary" size="sm" onClick={onRetry} disabled={retrying} title="Retry loading data">
        <RefreshCw size={14} className={retrying ? 'animate-spin' : ''} /> {retrying ? 'Retrying...' : 'Retry'}
      </Button>
    </div>
  );
}
