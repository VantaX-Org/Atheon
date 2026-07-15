import { Sun, Moon, Monitor } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import type { Theme } from '@/stores/appStore';

/** One button that cycles light → dark → auto. Icon = current mode; auto shows
 * the monitor glyph (follows the OS). ponytail: a cycle button beats a 3-way
 * menu for a header control — one tap, no popover. */
const NEXT: Record<Theme, Theme> = { light: 'dark', dark: 'auto', auto: 'light' };
const LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', auto: 'Auto (system)' };

export function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return (
    <button
      onClick={() => setTheme(NEXT[theme])}
      className="p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.92]"
      title={`Theme: ${LABEL[theme]} — click for ${LABEL[NEXT[theme]]}`}
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]]}.`}
    >
      <Icon size={15} />
    </button>
  );
}
