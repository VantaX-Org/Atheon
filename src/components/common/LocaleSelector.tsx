import { useAppStore } from '@/stores/appStore';
import { Globe } from 'lucide-react';

const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'af', label: 'Afrikaans' },
];

export function LocaleSelector() {
  const locale = (useAppStore((s) => s) as unknown as Record<string, unknown>).locale as string || 'en';
  const setLocale = (useAppStore((s) => s) as unknown as Record<string, unknown>).setLocale as ((l: string) => void) | undefined;

  return (
    <div className="flex items-center gap-2">
      <Globe size={14} className="t-muted" />
      <select
        value={locale}
        onChange={(e) => setLocale?.(e.target.value)}
        className="text-xs py-1 px-2 rounded-md t-secondary"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
      >
        {LOCALES.map(l => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
    </div>
  );
}
