/**
 * §9.8 Error Card with retry button
 * Reusable error state component for sections that fail to load.
 */
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorCardProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorCard({ title = 'Something went wrong', message = 'Failed to load data. Please try again.', onRetry, className = '' }: ErrorCardProps) {
  return (
    <div
      className={`rounded-xl p-6 text-center ${className}`}
      style={{ background: 'var(--bg-card-solid)', border: '1px solid rgba(239, 68, 68, 0.15)' }}
    >
      <AlertTriangle className="w-8 h-8 text-red-400/60 mx-auto mb-3" />
      <p className="text-sm font-medium t-primary mb-1">{title}</p>
      <p className="text-xs t-muted mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}
