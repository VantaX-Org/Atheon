import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "@/lib/api";
import type { GraphEntity, GraphRelationship, GraphQueryResult } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { AsyncPageContent, statusFrom } from "@/components/ui/async";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabsLayout } from "@/components/ui/page-tabs-layout";
import { KnowledgeGraphViz } from "@/components/memory/KnowledgeGraphViz";
import { SharedSavingsStrip } from "@/components/SharedSavingsStrip";
import {
  Plus,
  Search,
  Link2,
  X,
  Loader2,
  AlertTriangle,
  Sparkles,
  Database,
} from "lucide-react";

/**
 * Memory — Knowledge graph UI (entities, relationships, GraphRAG search).
 *
 * Backend: /api/memory/* (tenant-scoped; no companyId needed — tenant resolution
 * is driven by auth context + optional tenant_id override on the backend).
 *
 * The backend supports:
 *   GET/POST  /api/memory/entities
 *   GET/POST  /api/memory/relationships
 *   GET       /api/memory/graph
 *   POST      /api/memory/query          (GraphRAG)
 *   GET       /api/memory/stats
 *
 * There is no PUT/DELETE for entities, nor a CSV import endpoint — so the UI
 * no longer advertises those operations.
 */

const REL_TYPES = ["depends_on", "owns", "manages", "feeds_into", "reports_to"];

const ENTITY_TYPES = [
  "Organization",
  "Process",
  "System",
  "Person",
  "Product",
  "Department",
  "Location",
];

export function MemoryPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"graph" | "entities" | "relationships" | "search">("graph");

  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [relationships, setRelationships] = useState<GraphRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // Entity form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("Organization");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Relationship form
  const [showRelForm, setShowRelForm] = useState(false);
  const [relSource, setRelSource] = useState("");
  const [relTarget, setRelTarget] = useState("");
  const [relType, setRelType] = useState("depends_on");
  const [relSaving, setRelSaving] = useState(false);
  const [relFormError, setRelFormError] = useState<string | null>(null);

  // Auto-build from data
  const [building, setBuilding] = useState(false);

  // GraphRAG search
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<GraphQueryResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoadError(null);
    try {
      const [ents, rels] = await Promise.all([
        api.memory.entities(undefined, typeFilter || undefined),
        api.memory.relationships(),
      ]);
      setEntities(ents.entities || []);
      setRelationships(rels.relationships || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load knowledge graph";
      setLoadError(message);
      toast.error("Failed to load knowledge graph", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [toast, typeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredEntities = entities.filter((e) => {
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleSaveEntity = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await api.memory.createEntity({ type: formType, name: formName });
      await fetchData();
      setShowForm(false);
      setFormName("");
      setFormType("Organization");
      toast.success("Entity created");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create entity";
      setFormError(message);
      toast.error("Failed to create entity", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRelationship = async () => {
    setRelSaving(true);
    setRelFormError(null);
    try {
      await api.memory.createRelationship({
        source_id: relSource,
        target_id: relTarget,
        type: relType,
      });
      await fetchData();
      setShowRelForm(false);
      setRelSource("");
      setRelTarget("");
      setRelType("depends_on");
      toast.success("Relationship created");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create relationship";
      setRelFormError(message);
      toast.error("Failed to create relationship", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setRelSaving(false);
    }
  };

  const handleBuild = async () => {
    setBuilding(true);
    try {
      const res = await api.memory.build();
      await fetchData();
      toast.success("Memory rebuilt from data", {
        message: `${res.entities} entities, ${res.relationships} relationships from ${res.sources.catalysts} catalysts, ${res.sources.metrics} metrics, ${res.sources.correlations} correlations.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to rebuild memory";
      toast.error("Rebuild failed", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setBuilding(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearchResult(null);
    try {
      const result = await api.memory.query(searchQuery);
      setSearchResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run graph query";
      setSearchError(message);
      toast.error("Graph query failed", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setSearching(false);
    }
  };

  const status = statusFrom({ loading, error: null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        loadingVariant="cards"
        loadingCount={4}
      >
        {null}
      </AsyncPageContent>
    );
  }

  const tabs = [
    { id: "graph", label: "Graph" },
    { id: "entities", label: "Entities" },
    { id: "relationships", label: "Relationships" },
    { id: "search", label: "GraphRAG Search" },
  ];

  // Confidence → RAG status (presentation only; healthy/watch/risk pill in the
  // mockup's "data voice"). Mirrors the existing confidence rendering.
  const confidenceRag = (confidence?: number): { label: string; color: string } | null => {
    if (typeof confidence !== "number") return null;
    if (confidence >= 0.85) return { label: "Healthy", color: "var(--rag-healthy)" };
    if (confidence >= 0.6) return { label: "Watch", color: "var(--rag-watch)" };
    return { label: "At Risk", color: "var(--rag-risk)" };
  };

  return (
    <div className="space-y-6">
      <SharedSavingsStrip />
      <PageTabsLayout
        variant="segmented"
        ariaLabel="Memory sections"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as typeof activeTab)}
        header={
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <PageHeader
                eyebrow="Memory Store"
                title="Memory"
                dek="Knowledge Graph & Semantic Retrieval"
              />
              <button
                onClick={handleBuild}
                disabled={building}
                className="flex-shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-sm font-medium text-[var(--text-on-accent)] disabled:opacity-60"
                style={{ background: "var(--accent)" }}
                title="Rebuild the graph from real catalyst, metric, anomaly and correlation data. Manual entries are preserved."
              >
                {building ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                {building ? "Building…" : "Rebuild from data"}
              </button>
            </div>
            {loadError && !loading && (
              <div className="flex items-center gap-2 p-3 rounded-md border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.25)' }}>
                <AlertTriangle size={14} className="flex-shrink-0" style={{ color: 'var(--neg)' }} />
                <p className="text-xs flex-1" style={{ color: 'var(--neg)' }}>{loadError}</p>
                <button onClick={fetchData} className="text-xs underline" style={{ color: 'var(--neg)' }}>
                  Retry
                </button>
              </div>
            )}
          </div>
        }
      >
      {/* Graph Tab — Stitch "Knowledge Graph" force-directed canvas */}
      {activeTab === "graph" && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 t-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Highlight entities by name..."
                className="w-full pl-10 pr-3 py-2.5 rounded-lg text-body-sm t-primary"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              />
            </div>
            <div className="flex items-center gap-5 flex-shrink-0">
              <div className="flex flex-col items-end leading-none">
                <span className="font-mono text-lg font-bold t-primary tabular-nums">{entities.length}</span>
                <span className="text-label mt-1">Entities</span>
              </div>
              <div className="h-8 w-px" style={{ background: "var(--border-card)" }} aria-hidden="true" />
              <div className="flex flex-col items-end leading-none">
                <span className="font-mono text-lg font-bold t-primary tabular-nums">{relationships.length}</span>
                <span className="text-label mt-1">Relationships</span>
              </div>
            </div>
          </div>
          <KnowledgeGraphViz
            entities={entities}
            relationships={relationships}
            highlight={search}
            onSelect={() => { /* future: open side-panel for detail */ }}
          />
        </div>
      )}

      {/* Entities Tab */}
      {activeTab === "entities" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-label">Stored Facts</p>
            <span className="font-mono text-caption t-muted tabular-nums">
              {filteredEntities.length} of {entities.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 t-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search facts by name..."
                className="w-full pl-10 pr-3 py-2.5 rounded-lg text-sm t-primary"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2.5 rounded-lg text-sm t-secondary"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              title="Filter by entity type"
            >
              <option value="">All Types</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setShowForm(true);
                setFormName("");
                setFormType("Organization");
                setFormError(null);
              }}
              className="px-3.5 py-2.5 rounded-lg text-sm font-medium text-[var(--text-on-accent)] flex items-center gap-1.5"
              style={{ background: "var(--accent)" }}
              title="Create a new entity"
            >
              <Plus size={14} /> Add Entity
            </button>
          </div>

          <div className="space-y-3">
            {filteredEntities.map((ent) => {
              const rag = confidenceRag(ent.confidence);
              return (
                <div
                  key={ent.id}
                  className="rounded-xl p-5"
                  style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-label">{ent.type}</span>
                    {rag ? (
                      <span
                        className="text-label flex items-center gap-1.5"
                        style={{ color: rag.color }}
                      >
                        {rag.label}
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: rag.color }}
                          aria-hidden="true"
                        />
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-lg font-semibold t-primary leading-snug">{ent.name}</p>
                  <div
                    className="mt-4 pt-3 flex items-center justify-between gap-3"
                    style={{ borderTop: "1px solid var(--border-card)" }}
                  >
                    <span className="font-mono text-caption t-muted truncate">
                      <span className="t-muted">SOURCE:</span>{" "}
                      <span className="t-secondary">{ent.source || "—"}</span>
                    </span>
                    {typeof ent.confidence === "number" ? (
                      <span className="font-mono text-caption t-muted tabular-nums flex-shrink-0">
                        <span className="t-muted">CONFIDENCE:</span>{" "}
                        <span className="t-secondary">{Math.round(ent.confidence * 100)}%</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {filteredEntities.length === 0 && (
              <p className="text-sm t-muted text-center py-8">
                {entities.length === 0
                  ? "No entities yet. Add your first entity to start building the knowledge graph."
                  : "No entities match the current filters."}
              </p>
            )}
          </div>

          {/* Entity Form Modal */}
          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div
                className="w-full max-w-md rounded-md p-6 space-y-4"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold t-primary">Add Entity</h3>
                  <button onClick={() => setShowForm(false)} className="t-muted hover:t-primary" title="Close">
                    <X size={16} />
                  </button>
                </div>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Entity name"
                  className="w-full px-3 py-2 rounded-md text-sm t-primary"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                />
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-sm t-primary"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                >
                  {ENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {formError && (
                  <div className="flex items-center gap-2 p-2 rounded-md border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.25)' }}>
                    <AlertTriangle size={12} className="flex-shrink-0" style={{ color: 'var(--neg)' }} />
                    <p className="text-xs" style={{ color: 'var(--neg)' }}>{formError}</p>
                  </div>
                )}
                <button
                  onClick={handleSaveEntity}
                  disabled={saving || !formName.trim()}
                  className="w-full px-4 py-2 rounded-md text-sm font-medium text-[var(--text-on-accent)] flex items-center justify-center gap-2"
                  style={{ background: "var(--accent)", opacity: saving || !formName.trim() ? 0.6 : 1 }}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {saving ? "Creating..." : "Create Entity"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Relationships Tab */}
      {activeTab === "relationships" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-label">Linked Facts</p>
            <button
              onClick={() => {
                setShowRelForm(true);
                setRelFormError(null);
              }}
              className="px-3.5 py-2.5 rounded-lg text-sm font-medium text-[var(--text-on-accent)] flex items-center gap-1.5"
              style={{ background: "var(--accent)" }}
              title="Create a new relationship"
              disabled={entities.length < 2}
            >
              <Link2 size={14} /> Add Relationship
            </button>
          </div>
          {entities.length < 2 && (
            <p className="text-xs t-muted">Add at least two entities first to create a relationship.</p>
          )}

          <div className="space-y-3">
            {relationships.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center gap-4 rounded-xl p-4"
                style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}
              >
                <span className="flex-1 text-sm font-medium t-primary truncate" title={rel.sourceName}>
                  {rel.sourceName || rel.sourceId}
                </span>
                <span
                  className="font-mono text-label flex-shrink-0 px-2.5 py-1 rounded-md"
                  style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
                >
                  {rel.type}
                </span>
                <span className="flex-1 text-sm font-medium t-primary truncate text-right" title={rel.targetName}>
                  {rel.targetName || rel.targetId}
                </span>
              </div>
            ))}
            {relationships.length === 0 && (
              <p className="text-sm t-muted text-center py-8">No relationships defined yet.</p>
            )}
          </div>

          {showRelForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div
                className="w-full max-w-md rounded-md p-6 space-y-4"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold t-primary">Add Relationship</h3>
                  <button
                    onClick={() => setShowRelForm(false)}
                    className="t-muted hover:t-primary"
                    title="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
                <select
                  value={relSource}
                  onChange={(e) => setRelSource(e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-sm t-primary"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                >
                  <option value="">Source Entity</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.type})
                    </option>
                  ))}
                </select>
                <select
                  value={relType}
                  onChange={(e) => setRelType(e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-sm t-primary"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                >
                  {REL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  value={relTarget}
                  onChange={(e) => setRelTarget(e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-sm t-primary"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                >
                  <option value="">Target Entity</option>
                  {entities
                    .filter((e) => e.id !== relSource)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.type})
                      </option>
                    ))}
                </select>
                {relFormError && (
                  <div className="flex items-center gap-2 p-2 rounded-md border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.25)' }}>
                    <AlertTriangle size={12} className="flex-shrink-0" style={{ color: 'var(--neg)' }} />
                    <p className="text-xs" style={{ color: 'var(--neg)' }}>{relFormError}</p>
                  </div>
                )}
                <button
                  onClick={handleSaveRelationship}
                  disabled={relSaving || !relSource || !relTarget}
                  className="w-full px-4 py-2 rounded-md text-sm font-medium text-[var(--text-on-accent)] flex items-center justify-center gap-2"
                  style={{ background: "var(--accent)", opacity: relSaving || !relSource || !relTarget ? 0.6 : 1 }}
                >
                  {relSaving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                  {relSaving ? "Creating..." : "Create Relationship"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* GraphRAG Search Tab */}
      {activeTab === "search" && (
        <div className="rounded-xl p-7 space-y-6" style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}>
          <div className="space-y-2">
            <p className="text-label flex items-center gap-2">
              <Sparkles size={13} style={{ color: "var(--accent)" }} /> Knowledge Graph Query
            </p>
            <p className="text-sm t-secondary">
              Ask a natural-language question; results combine vector similarity and keyword matches over your graph.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="e.g. Which processes depend on SAP?"
              className="flex-1 px-3.5 py-2.5 rounded-lg text-sm t-primary"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
            />
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-[var(--text-on-accent)] flex items-center gap-2"
              style={{ background: "var(--accent)", opacity: searching || !searchQuery.trim() ? 0.6 : 1 }}
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {searching ? "Searching..." : "Search"}
            </button>
          </div>

          {searchError && (
            <div className="flex items-center gap-2 p-3 rounded-lg border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.25)' }}>
              <AlertTriangle size={14} className="flex-shrink-0" style={{ color: 'var(--neg)' }} />
              <p className="text-xs flex-1" style={{ color: 'var(--neg)' }}>{searchError}</p>
            </div>
          )}

          {searchResult && (
            <div className="space-y-6">
              {searchResult.answer && (
                <div
                  className="p-5 rounded-lg text-sm t-secondary leading-relaxed whitespace-pre-wrap"
                  style={{ background: "var(--accent-subtle)", border: "1px solid var(--border-card)" }}
                >
                  {searchResult.answer}
                </div>
              )}

              <div>
                <p className="text-label mb-3">
                  Direct Matches ({searchResult.directMatches?.length || 0})
                </p>
                {searchResult.directMatches && searchResult.directMatches.length > 0 ? (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {searchResult.directMatches.map((e) => (
                      <div
                        key={e.id}
                        className="rounded-lg p-3.5"
                        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                      >
                        <span className="text-label">{e.type}</span>
                        <p className="mt-1.5 text-sm font-medium t-primary truncate">{e.name}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs t-muted">No direct matches.</p>
                )}
              </div>

              {searchResult.relatedEntities && searchResult.relatedEntities.length > 0 && (
                <div>
                  <p className="text-label mb-3">
                    Linked Related Facts ({searchResult.relatedEntities.length})
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {searchResult.relatedEntities.map((e) => (
                      <div
                        key={e.id}
                        className="rounded-lg p-3.5"
                        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                      >
                        <span className="text-label">{e.type}</span>
                        <p className="mt-1.5 text-sm font-medium t-primary truncate">{e.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!searchResult && !searching && !searchError && (
            <p className="text-xs t-muted text-center py-6">Enter a query above to search the knowledge graph.</p>
          )}
        </div>
      )}
      </PageTabsLayout>
    </div>
  );
}
