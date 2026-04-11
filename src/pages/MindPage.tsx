import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { Brain, Settings2, Play, DollarSign, Loader2, ChevronDown, Thermometer, Hash, Zap } from "lucide-react";

interface ModelConfig {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
}

interface CostBreakdown {
  tier: string;
  calls: number;
  tokens: number;
  cost: number;
}

const PROVIDERS = ["OpenAI", "Anthropic", "Google", "Azure OpenAI"];
const MODELS: Record<string, string[]> = {
  "OpenAI": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  "Anthropic": ["claude-3.5-sonnet", "claude-3-opus", "claude-3-haiku"],
  "Google": ["gemini-1.5-pro", "gemini-1.5-flash"],
  "Azure OpenAI": ["gpt-4o", "gpt-4-turbo"],
};

export function MindPage() {
  const user = useAppStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<"config" | "playground" | "costs">("config");

  // Model configuration
  const [config, setConfig] = useState<ModelConfig>({
    provider: "OpenAI",
    model: "gpt-4o",
    temperature: 0.7,
    maxTokens: 4096,
    topP: 1.0,
  });
  const [saving, setSaving] = useState(false);

  // Prompt playground
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [testing, setTesting] = useState(false);

  // Cost breakdown
  const [costs, setCosts] = useState<CostBreakdown[]>([]);
  const [totalCost, setTotalCost] = useState(0);

  useEffect(() => {
    // Load existing config
    api.get("/api/v1/mind/config").then((data: Record<string, unknown>) => {
      if (data && typeof data === "object" && "provider" in data) {
        setConfig(data as unknown as ModelConfig);
      }
    }).catch(() => {});

    // Load cost data
    api.get("/api/v1/mind/costs").then((data: Record<string, unknown>) => {
      if (data && "breakdown" in data) {
        setCosts((data as { breakdown: CostBreakdown[] }).breakdown || []);
        setTotalCost((data as { total: number }).total || 0);
      }
    }).catch(() => {});
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await api.post("/api/v1/mind/config", config);
    } catch (err) {
      console.error("Failed to save config", err);
    } finally {
      setSaving(false);
    }
  };

  const testPrompt = async () => {
    if (!prompt.trim()) return;
    setTesting(true);
    setResponse("");
    try {
      const result = await api.post("/api/v1/mind/test", { prompt, config }) as { response: string };
      setResponse(result.response || "No response received.");
    } catch (err) {
      setResponse("Error: Failed to get response. Check your model configuration.");
    } finally {
      setTesting(false);
    }
  };

  const tabs = [
    { id: "config" as const, label: "Model Config", icon: Settings2 },
    { id: "playground" as const, label: "Prompt Playground", icon: Play },
    { id: "costs" as const, label: "Cost Breakdown", icon: DollarSign },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Brain size={20} style={{ color: "var(--accent)" }} />
        <h1 className="text-lg font-semibold t-primary">Mind - AI Configuration</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: "var(--bg-secondary)" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-all ${activeTab === tab.id ? "t-primary" : "t-muted hover:t-secondary"}`}
            style={activeTab === tab.id ? { background: "var(--bg-card)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" } : undefined}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Model Configuration */}
      {activeTab === "config" && (
        <div className="rounded-xl p-6 space-y-5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <h2 className="text-sm font-semibold t-primary">LLM Provider & Model</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs t-muted mb-1.5 block">Provider</label>
              <select
                value={config.provider}
                onChange={(e) => {
                  const p = e.target.value;
                  setConfig({ ...config, provider: p, model: MODELS[p]?.[0] || "" });
                }}
                className="w-full px-3 py-2 rounded-md text-sm t-primary"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              >
                {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs t-muted mb-1.5 block">Model</label>
              <select
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                className="w-full px-3 py-2 rounded-md text-sm t-primary"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              >
                {(MODELS[config.provider] || []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs t-muted flex items-center gap-1"><Thermometer size={12} /> Temperature</label>
                <span className="text-xs font-mono t-secondary">{config.temperature}</span>
              </div>
              <input
                type="range" min="0" max="2" step="0.1"
                value={config.temperature}
                onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs t-muted flex items-center gap-1"><Hash size={12} /> Max Tokens</label>
                <span className="text-xs font-mono t-secondary">{config.maxTokens}</span>
              </div>
              <input
                type="range" min="256" max="32768" step="256"
                value={config.maxTokens}
                onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value) })}
                className="w-full"
              />
            </div>
          </div>

          <button
            onClick={saveConfig}
            disabled={saving}
            className="px-4 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2"
            style={{ background: "var(--accent)" }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      )}

      {/* Prompt Playground */}
      {activeTab === "playground" && (
        <div className="rounded-xl p-6 space-y-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <h2 className="text-sm font-semibold t-primary">Test Prompts</h2>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter a prompt to test against the current model configuration..."
            rows={4}
            className="w-full px-3 py-2 rounded-md text-sm t-primary resize-y"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
          />
          <button
            onClick={testPrompt}
            disabled={testing || !prompt.trim()}
            className="px-4 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2"
            style={{ background: "var(--accent)", opacity: testing || !prompt.trim() ? 0.6 : 1 }}
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {testing ? "Running..." : "Test Prompt"}
          </button>
          {response && (
            <div className="p-4 rounded-md text-sm t-secondary whitespace-pre-wrap" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}>
              {response}
            </div>
          )}
        </div>
      )}

      {/* Cost Breakdown */}
      {activeTab === "costs" && (
        <div className="rounded-xl p-6 space-y-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold t-primary">Cost Breakdown by Autonomy Tier</h2>
            <span className="text-lg font-bold" style={{ color: "var(--accent)" }}>${totalCost.toFixed(2)}</span>
          </div>
          <div className="space-y-2">
            {costs.length > 0 ? costs.map((c, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 rounded-md" style={{ background: "var(--bg-secondary)" }}>
                <div>
                  <p className="text-xs font-medium t-primary">{c.tier}</p>
                  <p className="text-[11px] t-muted">{c.calls} calls | {c.tokens.toLocaleString()} tokens</p>
                </div>
                <span className="text-sm font-medium t-primary">${c.cost.toFixed(2)}</span>
              </div>
            )) : (
              <p className="text-xs t-muted text-center py-8">No cost data available yet. AI usage will be tracked here.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
