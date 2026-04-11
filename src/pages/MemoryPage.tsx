import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Database, Plus, Search, Upload, Link2, Edit2, Trash2, X, Loader2 } from "lucide-react";

interface Entity {
  id: string;
  name: string;
  type: string;
  description: string;
  properties: Record<string, string>;
}

interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  sourceName?: string;
  targetName?: string;
}

const ENTITY_TYPES = ["Organization", "Process", "System", "Person", "Product", "Department", "Location"];

export function MemoryPage() {
  const [activeTab, setActiveTab] = useState<"entities" | "relationships" | "import">("entities");
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // Entity form state
  const [showForm, setShowForm] = useState(false);
  const [editEntity, setEditEntity] = useState<Entity | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("Organization");
  const [formDesc, setFormDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // Relationship form state
  const [showRelForm, setShowRelForm] = useState(false);
  const [relSource, setRelSource] = useState("");
  const [relTarget, setRelTarget] = useState("");
  const [relType, setRelType] = useState("depends_on");

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [ents, rels] = await Promise.all([
        api.get("/api/v1/memory/entities") as Promise<{ entities: Entity[] }>,
        api.get("/api/v1/memory/relationships") as Promise<{ relationships: Relationship[] }>,
      ]);
      setEntities(ents.entities || []);
      setRelationships(rels.relationships || []);
    } catch (err) {
      console.error("Failed to load memory data", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredEntities = entities.filter((e) => {
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter && e.type !== typeFilter) return false;
    return true;
  });

  const handleSaveEntity = async () => {
    setSaving(true);
    try {
      const payload = { name: formName, type: formType, description: formDesc };
      if (editEntity) {
        await api.put(`/api/v1/memory/entities/${editEntity.id}`, payload);
      } else {
        await api.post("/api/v1/memory/entities", payload);
      }
      await fetchData();
      setShowForm(false);
      setEditEntity(null);
      setFormName(""); setFormType("Organization"); setFormDesc("");
    } catch (err) {
      console.error("Failed to save entity", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntity = async (id: string) => {
    try {
      await api.delete(`/api/v1/memory/entities/${id}`);
      await fetchData();
    } catch (err) {
      console.error("Failed to delete entity", err);
    }
  };

  const handleSaveRelationship = async () => {
    try {
      await api.post("/api/v1/memory/relationships", { sourceId: relSource, targetId: relTarget, type: relType });
      await fetchData();
      setShowRelForm(false);
    } catch (err) {
      console.error("Failed to save relationship", err);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const text = await importFile.text();
      const rows = text.split("\n").filter(Boolean);
      const headers = rows[0].split(",").map(h => h.trim());
      const imported: Array<Record<string, string>> = [];
      for (let i = 1; i < rows.length; i++) {
        const vals = rows[i].split(",").map(v => v.trim());
        const obj: Record<string, string> = {};
        headers.forEach((h, j) => { obj[h] = vals[j] || ""; });
        imported.push(obj);
      }
      await api.post("/api/v1/memory/import", { entities: imported });
      setImportResult(`Successfully imported ${imported.length} entities.`);
      await fetchData();
    } catch {
      setImportResult("Import failed. Please check your CSV format.");
    } finally {
      setImporting(false);
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
        <Database size={20} style={{ color: "var(--accent)" }} />
        <h1 className="text-lg font-semibold t-primary">Memory - Knowledge Graph</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: "var(--bg-secondary)" }}>
        {[
          { id: "entities" as const, label: "Entities" },
          { id: "relationships" as const, label: "Relationships" },
          { id: "import" as const, label: "Import" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-xs font-medium transition-all ${activeTab === tab.id ? "t-primary" : "t-muted hover:t-secondary"}`}
            style={activeTab === tab.id ? { background: "var(--bg-card)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" } : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Entities Tab */}
      {activeTab === "entities" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search entities..."
                className="w-full pl-9 pr-3 py-2 rounded-md text-sm t-primary"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 rounded-md text-sm t-secondary"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
            >
              <option value="">All Types</option>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button
              onClick={() => { setShowForm(true); setEditEntity(null); setFormName(""); setFormType("Organization"); setFormDesc(""); }}
              className="px-3 py-2 rounded-md text-sm font-medium text-white flex items-center gap-1.5"
              style={{ background: "var(--accent)" }}
            >
              <Plus size={14} /> Add Entity
            </button>
          </div>

          <div className="space-y-2">
            {filteredEntities.map((ent) => (
              <div key={ent.id} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                <div>
                  <p className="text-sm font-medium t-primary">{ent.name}</p>
                  <p className="text-xs t-muted">{ent.type} {ent.description ? `- ${ent.description}` : ""}</p>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => { setEditEntity(ent); setFormName(ent.name); setFormType(ent.type); setFormDesc(ent.description); setShowForm(true); }} className="p-1.5 rounded t-muted hover:t-primary"><Edit2 size={14} /></button>
                  <button onClick={() => handleDeleteEntity(ent.id)} className="p-1.5 rounded t-muted hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            {filteredEntities.length === 0 && (
              <p className="text-sm t-muted text-center py-8">No entities found. Add your first entity to get started.</p>
            )}
          </div>

          {/* Entity Form Modal */}
          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="w-full max-w-md rounded-xl p-6 space-y-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold t-primary">{editEntity ? "Edit Entity" : "Add Entity"}</h3>
                  <button onClick={() => setShowForm(false)} className="t-muted hover:t-primary"><X size={16} /></button>
                </div>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Entity name" className="w-full px-3 py-2 rounded-md text-sm t-primary" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }} />
                <select value={formType} onChange={(e) => setFormType(e.target.value)} className="w-full px-3 py-2 rounded-md text-sm t-primary" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}>
                  {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Description" rows={3} className="w-full px-3 py-2 rounded-md text-sm t-primary" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }} />
                <button onClick={handleSaveEntity} disabled={saving || !formName} className="w-full px-4 py-2 rounded-md text-sm font-medium text-white" style={{ background: "var(--accent)", opacity: saving || !formName ? 0.6 : 1 }}>
                  {saving ? "Saving..." : editEntity ? "Update Entity" : "Create Entity"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Relationships Tab */}
      {activeTab === "relationships" && (
        <div className="space-y-4">
          <button onClick={() => setShowRelForm(true)} className="px-3 py-2 rounded-md text-sm font-medium text-white flex items-center gap-1.5" style={{ background: "var(--accent)" }}>
            <Link2 size={14} /> Add Relationship
          </button>
          <div className="space-y-2">
            {relationships.map((rel) => (
              <div key={rel.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                <span className="text-sm t-primary">{rel.sourceName || rel.sourceId}</span>
                <span className="text-xs px-2 py-0.5 rounded-full t-muted" style={{ background: "var(--bg-secondary)" }}>{rel.type}</span>
                <span className="text-sm t-primary">{rel.targetName || rel.targetId}</span>
              </div>
            ))}
            {relationships.length === 0 && (
              <p className="text-sm t-muted text-center py-8">No relationships defined yet.</p>
            )}
          </div>
          {showRelForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="w-full max-w-md rounded-xl p-6 space-y-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold t-primary">Add Relationship</h3>
                  <button onClick={() => setShowRelForm(false)} className="t-muted hover:t-primary"><X size={16} /></button>
                </div>
                <select value={relSource} onChange={(e) => setRelSource(e.target.value)} className="w-full px-3 py-2 rounded-md text-sm t-primary" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}>
                  <option value="">Source Entity</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <select value={relType} onChange={(e) => setRelType(e.target.value)} className="w-full px-3 py-2 rounded-md text-sm t-primary" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}>
                  <option value="depends_on">depends_on</option>
                  <option value="owns">owns</option>
                  <option value="manages">manages</option>
                  <option value="feeds_into">feeds_into</option>
                  <option value="reports_to">reports_to</option>
                </select>
                <select value={relTarget} onChange={(e) => setRelTarget(e.target.value)} className="w-full px-3 py-2 rounded-md text-sm t-primary" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}>
                  <option value="">Target Entity</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <button onClick={handleSaveRelationship} disabled={!relSource || !relTarget} className="w-full px-4 py-2 rounded-md text-sm font-medium text-white" style={{ background: "var(--accent)", opacity: !relSource || !relTarget ? 0.6 : 1 }}>
                  Create Relationship
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Import Tab */}
      {activeTab === "import" && (
        <div className="rounded-xl p-6 space-y-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <h2 className="text-sm font-semibold t-primary">Import Entities from CSV</h2>
          <p className="text-xs t-muted">Upload a CSV file with columns: name, type, description</p>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            className="text-sm t-secondary"
          />
          <button
            onClick={handleImport}
            disabled={!importFile || importing}
            className="px-4 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2"
            style={{ background: "var(--accent)", opacity: !importFile || importing ? 0.6 : 1 }}
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {importing ? "Importing..." : "Import CSV"}
          </button>
          {importResult && <p className="text-xs t-secondary">{importResult}</p>}
        </div>
      )}
    </div>
  );
}
