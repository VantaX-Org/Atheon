// TASK-024: Contextual help integration
import { useState, useEffect } from 'react';
import { HelpCircle, X, ChevronRight, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface HelpTopic {
  id: string;
  title: string;
  content: string;
}

const helpTopics: Record<string, HelpTopic[]> = {
  dashboard: [
    { id: 'health-score', title: 'Health Score', content: 'The health score is a composite metric (0-100) calculated from financial, operational, compliance, strategic, and technology dimensions.' },
    { id: 'kpi-cards', title: 'KPI Cards', content: 'Each card shows a key metric with current value, trend indicator, and sparkline. Click to drill down.' },
    { id: 'quick-actions', title: 'Quick Actions', content: 'Shortcuts to common tasks like running catalysts, viewing reports, and managing settings.' },
  ],
  catalysts: [
    { id: 'clusters', title: 'Clusters', content: 'A cluster groups related sub-catalysts by business domain (e.g., Finance, HR, Procurement).' },
    { id: 'sub-catalysts', title: 'Sub-Catalysts', content: 'Each sub-catalyst handles a specific automated task with configurable autonomy tiers.' },
    { id: 'execution', title: 'Execution', content: 'Catalysts can run automatically on schedule or be triggered manually.' },
    { id: 'analytics', title: 'Analytics', content: 'View run history, KPI trends, success rates, and performance metrics.' },
  ],
  settings: [
    { id: 'security', title: 'Security', content: 'Manage your password, MFA, and API keys from the security section.' },
    { id: 'notifications', title: 'Notifications', content: 'Configure which events trigger notifications and your preferred delivery method.' },
    { id: 'appearance', title: 'Appearance', content: 'Switch between light/dark mode and select your preferred language.' },
  ],
};

interface ContextualHelpProps {
  page: string;
}

export function ContextualHelp({ page }: ContextualHelpProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<HelpTopic | null>(null);
  const topics = helpTopics[page] || [];

  if (topics.length === 0) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-40 rounded-full w-10 h-10 p-0 shadow-lg bg-accent text-white hover:bg-accent-hover"
        aria-label="Help"
      >
        <HelpCircle size={20} />
      </Button>

      {isOpen && (
        <Card className="fixed bottom-16 right-4 z-50 w-80 max-h-96 overflow-y-auto shadow-xl border border-[var(--border-card)]">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold t-primary flex items-center gap-2">
                <BookOpen size={16} /> Help
              </h3>
              <button onClick={() => { setIsOpen(false); setSelectedTopic(null); }} className="p-1 rounded hover:bg-[var(--bg-secondary)]" aria-label="Close help">
                <X size={16} />
              </button>
            </div>

            {selectedTopic ? (
              <div>
                <button onClick={() => setSelectedTopic(null)} className="text-sm text-accent hover:underline mb-2 flex items-center gap-1">
                  &larr; Back
                </button>
                <h4 className="font-medium t-primary mb-2">{selectedTopic.title}</h4>
                <p className="text-sm t-secondary leading-relaxed">{selectedTopic.content}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {topics.map(topic => (
                  <button
                    key={topic.id}
                    onClick={() => setSelectedTopic(topic)}
                    className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[var(--bg-secondary)] text-left"
                  >
                    <span className="text-sm t-primary">{topic.title}</span>
                    <ChevronRight size={14} className="t-muted" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
