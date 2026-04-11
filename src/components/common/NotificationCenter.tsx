/**
 * SPEC-014: Notification Center Enhancement
 * Real-time notification bell with dropdown, mark-as-read, preferences, and toast integration.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, Check, CheckCheck, Settings, X, AlertTriangle, Info, CheckCircle2, Zap } from 'lucide-react';
import { api, NotificationItem } from '@/lib/api';

const ICON_MAP: Record<string, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertTriangle,
  action: Zap,
};

const COLOR_MAP: Record<string, string> = {
  info: 'text-sky-500',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
  action: 'text-accent',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.notifications.list();
      setNotifications(data.notifications || []);
    } catch {
      // Use empty list on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const markAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    try { await api.notifications.markRead([id]); } catch { /* silent */ }
  };

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    const ids = notifications.filter(n => !n.read).map(n => n.id);
    if (ids.length > 0) { try { await api.notifications.markRead(ids); } catch { /* silent */ } }
  };

  const filtered = filter === 'unread' ? notifications.filter(n => !n.read) : notifications;

  return (
    <div ref={ref} className="relative">
      {/* Bell Button */}
      <button
        onClick={() => { setOpen(!open); if (!open) fetchNotifications(); }}
        className="relative p-2 rounded-lg transition-all hover:bg-[var(--bg-secondary)]"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell size={18} className="t-secondary" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center min-w-[18px] h-[18px]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-96 max-h-[480px] rounded-xl overflow-hidden shadow-xl z-50"
          style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
          role="dialog"
          aria-label="Notifications"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-card)]">
            <h3 className="text-sm font-semibold t-primary">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-accent hover:underline flex items-center gap-1"
                >
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-[var(--bg-secondary)] t-muted"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-1 px-4 py-2 border-b border-[var(--border-card)]">
            {(['all', 'unread'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[11px] rounded-full transition-all ${
                  filter === f
                    ? 'bg-accent/20 text-accent font-medium'
                    : 't-muted hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {f === 'all' ? 'All' : `Unread (${unreadCount})`}
              </button>
            ))}
          </div>

          {/* Notification List */}
          <div className="overflow-y-auto max-h-[360px]">
            {loading && filtered.length === 0 ? (
              <div className="p-8 text-center t-muted text-xs">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center t-muted text-xs">
                {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              </div>
            ) : (
              filtered.map(n => {
                const Icon = ICON_MAP[n.type] || Info;
                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 px-4 py-3 border-b border-[var(--border-card)] transition-all hover:bg-[var(--bg-secondary)] cursor-pointer ${
                      !n.read ? 'bg-accent/5' : ''
                    }`}
                    onClick={() => {
                      if (!n.read) markAsRead(n.id);
                      if (n.actionUrl) window.location.href = n.actionUrl;
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className={`flex-shrink-0 mt-0.5 ${COLOR_MAP[n.type]}`}>
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs leading-tight ${!n.read ? 'font-semibold t-primary' : 't-secondary'}`}>
                          {n.title}
                        </p>
                        {!n.read && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }}
                            className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--bg-secondary)] t-muted"
                            title="Mark as read"
                          >
                            <Check size={12} />
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] t-muted mt-0.5 line-clamp-2">{n.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] t-muted">{timeAgo(n.createdAt)}</span>
                        {n.actionUrl && (
                          <span className="text-[10px] text-accent">View</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border-card)]">
            <button className="text-[11px] text-accent hover:underline flex items-center gap-1">
              <Settings size={11} /> Preferences
            </button>
            <button className="text-[11px] t-muted hover:underline">View all</button>
          </div>
        </div>
      )}
    </div>
  );
}
