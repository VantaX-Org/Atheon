import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Plug, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Clock, Loader2, Play, Wifi } from "lucide-react";

interface Connection {
  id: string;
  name: string;
  type: string;
  status: "connected" | "disconnected" | "error" | "syncing";
  lastSync: string | null;
  nextSync: string | null;
  syncSchedule: string;
  recordsSynced: number;
  errorMessage?: string;
}

export function ConnectivityPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const data = await api.get("/api/v1/connectivity/connections") as { connections: Connection[] };
      setConnections(data.connections || []);
    } catch (err) {
      console.error("Failed to load connections", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const testConnection = async (id: string) => {
    setTestingId(id);
    try {
      const result = await api.post(`/api/v1/connectivity/connections/${id}/test`, {}) as { success: boolean; message: string };
      setConnections((prev) =>
        prev.map((c) => c.id === id ? { ...c, status: result.success ? "connected" : "error", errorMessage: result.success ? undefined : result.message } : c)
      );
    } catch (err) {
      setConnections((prev) =>
        prev.map((c) => c.id === id ? { ...c, status: "error", errorMessage: "Connection test failed" } : c)
      );
    } finally {
      setTestingId(null);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "connected": return <CheckCircle2 size={16} className="text-emerald-500" />;
      case "syncing": return <RefreshCw size={16} className="text-blue-500 animate-spin" />;
      case "error": return <XCircle size={16} className="text-red-500" />;
      default: return <AlertTriangle size={16} className="text-amber-500" />;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "connected": return "Connected";
      case "syncing": return "Syncing";
      case "error": return "Error";
      default: return "Disconnected";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Plug size={20} style={{ color: "var(--accent)" }} />
        <h1 className="text-lg font-semibold t-primary">Connectivity - Integration Health</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Connections", value: connections.length, icon: Wifi },
          { label: "Connected", value: connections.filter((c) => c.status === "connected").length, icon: CheckCircle2 },
          { label: "Errors", value: connections.filter((c) => c.status === "error").length, icon: XCircle },
          { label: "Syncing", value: connections.filter((c) => c.status === "syncing").length, icon: RefreshCw },
        ].map((card) => (
          <div key={card.label} className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
            <div className="flex items-center gap-2 mb-2">
              <card.icon size={14} className="t-muted" />
              <span className="text-[10px] t-muted uppercase tracking-wider">{card.label}</span>
            </div>
            <p className="text-xl font-bold t-primary">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Connection health cards */}
      <div className="space-y-3">
        {connections.map((conn) => (
          <div key={conn.id} className="rounded-xl p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {statusIcon(conn.status)}
                <div>
                  <p className="text-sm font-medium t-primary">{conn.name}</p>
                  <p className="text-xs t-muted">{conn.type} &middot; {statusLabel(conn.status)}</p>
                </div>
              </div>
              <button
                onClick={() => testConnection(conn.id)}
                disabled={testingId === conn.id}
                className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              >
                {testingId === conn.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                Test
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] t-muted uppercase">Last Sync</p>
                <p className="text-xs t-secondary flex items-center gap-1"><Clock size={10} /> {conn.lastSync ? new Date(conn.lastSync).toLocaleString() : "Never"}</p>
              </div>
              <div>
                <p className="text-[10px] t-muted uppercase">Schedule</p>
                <p className="text-xs t-secondary">{conn.syncSchedule || "Manual"}</p>
              </div>
              <div>
                <p className="text-[10px] t-muted uppercase">Records Synced</p>
                <p className="text-xs t-secondary">{conn.recordsSynced.toLocaleString()}</p>
              </div>
            </div>

            {conn.errorMessage && (
              <p className="mt-2 text-xs text-red-500">{conn.errorMessage}</p>
            )}
          </div>
        ))}
        {connections.length === 0 && (
          <div className="text-center py-12">
            <Plug size={32} className="mx-auto mb-3 t-muted" />
            <p className="text-sm t-muted">No connections configured yet.</p>
            <p className="text-xs t-muted mt-1">Go to Integrations to set up your first connection.</p>
          </div>
        )}
      </div>
    </div>
  );
}
