/**
 * SPEC-025: In-App Help & Contextual Documentation
 * Slide-out help panel with contextual docs, search, and keyboard shortcut reference.
 */
import { useState, useEffect, useRef } from 'react';
import { HelpCircle, Search, X, BookOpen, Keyboard, MessageCircle, ExternalLink } from 'lucide-react';

interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
}

const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'getting-started',
    title: 'Getting Started with Atheon',
    summary: 'Learn the basics of navigating and using the platform.',
    content: 'Atheon is an Enterprise Intelligence Platform that helps you monitor business health, run AI-powered catalysts, and make data-driven decisions. Start by connecting your ERP system from the Connectivity page, then run your first catalyst from the Catalysts page.',
    category: 'Getting Started',
    tags: ['onboarding', 'basics', 'first-steps'],
  },
  {
    id: 'health-score',
    title: 'Understanding Health Scores',
    summary: 'How Atheon calculates and presents your business health.',
    content: 'The Atheon Health Score is a composite metric derived from multiple dimensions: Financial Health, Operational Efficiency, Customer Satisfaction, Risk Management, and Growth Trajectory. Each dimension is scored 0-100 based on real-time data from your connected ERP and other data sources. The overall score is a weighted average.',
    category: 'Dashboard',
    tags: ['health', 'score', 'metrics', 'dashboard'],
  },
  {
    id: 'catalysts',
    title: 'Running Catalysts',
    summary: 'How to deploy and monitor AI-powered business catalysts.',
    content: 'Catalysts are AI-powered analysis agents that examine specific aspects of your business. To run a catalyst: 1) Navigate to the Catalysts page. 2) Select a catalyst template or create a custom one. 3) Configure the scope and parameters. 4) Click "Run" to start. Monitor progress in real-time and review generated insights, actions, and recommendations.',
    category: 'Catalysts',
    tags: ['catalysts', 'ai', 'analysis', 'run'],
  },
  {
    id: 'erp-connection',
    title: 'Connecting Your ERP',
    summary: 'How to connect Xero, QuickBooks, or other ERP systems.',
    content: 'Navigate to Connectivity > ERP Adapters to connect your accounting/ERP system. Atheon supports Xero, QuickBooks, Sage, and custom API integrations. The connection uses OAuth 2.0 for secure access. Once connected, Atheon will periodically sync your financial data to build the knowledge graph.',
    category: 'Integrations',
    tags: ['erp', 'xero', 'quickbooks', 'connection', 'sync'],
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    summary: 'Quick reference for keyboard navigation.',
    content: 'Ctrl+K: Open command palette / search\nCtrl+/: Toggle help panel\nCtrl+B: Toggle sidebar\nCtrl+D: Go to Dashboard\nEsc: Close modal/panel\nCtrl+Shift+T: Switch tenant\nCtrl+Shift+R: Refresh data',
    category: 'Navigation',
    tags: ['keyboard', 'shortcuts', 'navigation'],
  },
  {
    id: 'audit-log',
    title: 'Viewing Audit Logs',
    summary: 'Track all actions and changes across your organization.',
    content: 'The Audit page shows a chronological log of all significant actions: user logins, catalyst runs, configuration changes, ERP syncs, and more. Use filters to narrow by user, action type, or date range. Admins can export logs for compliance reporting.',
    category: 'Admin',
    tags: ['audit', 'logs', 'compliance', 'tracking'],
  },
  {
    id: 'pulse-metrics',
    title: 'Pulse Real-Time Metrics',
    summary: 'Understanding real-time operational metrics.',
    content: 'The Pulse page shows live operational metrics streamed from your connected systems. Metrics include financial KPIs, operational throughput, anomaly detection alerts, and trend analysis. Data refreshes automatically every 60 seconds.',
    category: 'Pulse',
    tags: ['pulse', 'metrics', 'real-time', 'kpi'],
  },
  {
    id: 'apex-intelligence',
    title: 'Apex Strategic Intelligence',
    summary: 'AI-powered strategic insights and recommendations.',
    content: 'Apex is Atheon\'s strategic intelligence layer. It synthesizes data from all connected sources to provide executive-level insights, risk assessments, and strategic recommendations. Use the AI Insights button on the Dashboard to generate on-demand analysis.',
    category: 'Apex',
    tags: ['apex', 'strategy', 'ai', 'insights', 'intelligence'],
  },
];

const KEYBOARD_SHORTCUTS = [
  { keys: ['Ctrl', 'K'], description: 'Open search / command palette' },
  { keys: ['Ctrl', '/'], description: 'Toggle help panel' },
  { keys: ['Ctrl', 'B'], description: 'Toggle sidebar' },
  { keys: ['Ctrl', 'D'], description: 'Go to Dashboard' },
  { keys: ['Esc'], description: 'Close modal or panel' },
  { keys: ['Ctrl', 'Shift', 'T'], description: 'Switch tenant' },
  { keys: ['Ctrl', 'Shift', 'R'], description: 'Refresh data' },
];

export function HelpPanel() {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'articles' | 'shortcuts'>('articles');
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut to toggle help
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Focus search when opened
  useEffect(() => {
    if (open && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [open]);

  const filteredArticles = searchQuery
    ? HELP_ARTICLES.filter(a =>
        a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.tags.some(t => t.includes(searchQuery.toLowerCase()))
      )
    : HELP_ARTICLES;

  const categories = [...new Set(filteredArticles.map(a => a.category))];

  return (
    <>
      {/* Help Trigger Button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-accent text-white shadow-lg flex items-center justify-center hover:scale-105 transition-transform z-40"
        aria-label="Open help panel"
        title="Help (Ctrl+/)"
      >
        <HelpCircle size={20} />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-50 transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 h-full w-full max-w-md z-50 transform transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ background: 'var(--bg-primary)', borderLeft: '1px solid var(--border-card)' }}
        role="dialog"
        aria-label="Help panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-card)]">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-accent" />
            <h2 className="text-base font-semibold t-primary">Help & Documentation</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)] t-muted"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="p-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search help articles..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSelectedArticle(null); }}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] t-primary placeholder:t-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pb-3">
          <button
            onClick={() => { setActiveTab('articles'); setSelectedArticle(null); }}
            className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
              activeTab === 'articles' ? 'bg-accent/15 text-accent font-medium' : 't-muted hover:bg-[var(--bg-secondary)]'
            }`}
          >
            <BookOpen size={12} className="inline mr-1" /> Articles
          </button>
          <button
            onClick={() => { setActiveTab('shortcuts'); setSelectedArticle(null); }}
            className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
              activeTab === 'shortcuts' ? 'bg-accent/15 text-accent font-medium' : 't-muted hover:bg-[var(--bg-secondary)]'
            }`}
          >
            <Keyboard size={12} className="inline mr-1" /> Shortcuts
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto px-4 pb-4" style={{ height: 'calc(100% - 200px)' }}>
          {activeTab === 'articles' && !selectedArticle && (
            <div className="space-y-4">
              {categories.map(cat => (
                <div key={cat}>
                  <h4 className="text-[10px] uppercase tracking-wider t-muted mb-2">{cat}</h4>
                  <div className="space-y-2">
                    {filteredArticles.filter(a => a.category === cat).map(article => (
                      <button
                        key={article.id}
                        onClick={() => setSelectedArticle(article)}
                        className="w-full text-left p-3 rounded-lg hover:bg-[var(--bg-secondary)] transition-all border border-transparent hover:border-[var(--border-card)]"
                      >
                        <p className="text-sm font-medium t-primary">{article.title}</p>
                        <p className="text-[11px] t-muted mt-0.5">{article.summary}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {filteredArticles.length === 0 && (
                <div className="text-center py-8 t-muted text-sm">
                  No articles found for "{searchQuery}"
                </div>
              )}
            </div>
          )}

          {activeTab === 'articles' && selectedArticle && (
            <div>
              <button
                onClick={() => setSelectedArticle(null)}
                className="text-xs text-accent hover:underline mb-3 flex items-center gap-1"
              >
                ← Back to articles
              </button>
              <h3 className="text-lg font-semibold t-primary mb-2">{selectedArticle.title}</h3>
              <p className="text-xs t-muted mb-4">{selectedArticle.category}</p>
              <div className="text-sm t-secondary whitespace-pre-line leading-relaxed">
                {selectedArticle.content}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-4">
                {selectedArticle.tags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 text-[10px] rounded-full bg-[var(--bg-secondary)] t-muted">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="space-y-3">
              {KEYBOARD_SHORTCUTS.map((shortcut) => (
                <div
                  key={shortcut.description}
                  className="flex items-center justify-between p-2 rounded-lg"
                >
                  <span className="text-sm t-secondary">{shortcut.description}</span>
                  <div className="flex gap-1">
                    {shortcut.keys.map(key => (
                      <kbd
                        key={key}
                        className="px-2 py-0.5 text-[11px] font-mono rounded bg-[var(--bg-secondary)] border border-[var(--border-card)] t-primary"
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-[var(--border-card)]" style={{ background: 'var(--bg-primary)' }}>
          <div className="flex items-center justify-between">
            <button className="text-xs text-accent hover:underline flex items-center gap-1">
              <MessageCircle size={12} /> Contact Support
            </button>
            <button className="text-xs t-muted hover:underline flex items-center gap-1">
              <ExternalLink size={12} /> Full Documentation
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
