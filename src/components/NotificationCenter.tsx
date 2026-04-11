// TASK-017: Notification Center Integration
import { useState, useEffect, useCallback } from "react";
import { Bell, X, Check, CheckCheck, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { NotificationItem } from "@/lib/api";


export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.notifications.list();
      setNotifications(result.notifications || []);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadNotifications();
    // Poll for new notifications every 30s
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markRead = async (id: string) => {
    try {
      await api.notifications.markRead([id]);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const markAllRead = async () => {
    try {
      const allIds = notifications.filter(n => !n.read).map(n => n.id);
      if (allIds.length > 0) await api.notifications.markRead(allIds);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  const dismiss = async (id: string) => {
    try {
      await api.notifications.markRead([id]);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (err) {
      console.error("Failed to dismiss notification:", err);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => { setIsOpen(!isOpen); if (!isOpen) loadNotifications(); }}
        className="relative p-2 rounded-lg hover:bg-[var(--bg-secondary)] transition-all"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell size={18} className="t-muted" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto z-50 rounded-xl bg-[var(--bg-card-solid)] border border-[var(--border-card)] shadow-xl">
            <div className="sticky top-0 flex items-center justify-between p-3 border-b border-[var(--border-card)] bg-[var(--bg-card-solid)]">
              <h3 className="text-sm font-semibold t-primary">Notifications</h3>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="p-1 rounded hover:bg-[var(--bg-secondary)]" title="Mark all read">
                    <CheckCheck size={14} className="t-muted" />
                  </button>
                )}
                <button onClick={() => setIsOpen(false)} className="p-1 rounded hover:bg-[var(--bg-secondary)]" title="Close">
                  <X size={14} className="t-muted" />
                </button>
              </div>
            </div>

            {loading && notifications.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-xs t-muted">Loading...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center">
                <Bell size={24} className="t-muted mx-auto mb-2" />
                <p className="text-xs t-muted">No notifications</p>
              </div>
            ) : (
              <div>
                {notifications.map(n => (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 p-3 border-b border-[var(--border-card)] hover:bg-[var(--bg-secondary)] transition-all ${!n.read ? 'bg-accent/5' : ''}`}
                  >
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${!n.read ? 'bg-accent' : 'bg-transparent'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium t-primary">{n.title}</p>
                                  <p className="text-[10px] t-secondary mt-0.5 line-clamp-2">{n.message}</p>
                                  <p className="text-[9px] t-muted mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {!n.read && (
                        <button onClick={() => markRead(n.id)} className="p-1 rounded hover:bg-[var(--bg-card)]" title="Mark read">
                          <Check size={12} className="t-muted" />
                        </button>
                      )}
                      <button onClick={() => dismiss(n.id)} className="p-1 rounded hover:bg-[var(--bg-card)]" title="Dismiss">
                        <Trash2 size={12} className="t-muted" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
