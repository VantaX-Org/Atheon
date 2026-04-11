/**
 * SPEC-010: Accessibility utilities for WCAG 2.1 AA compliance
 * Focus management, screen reader announcements, keyboard navigation helpers.
 */

/** Announce a message to screen readers via a live region */
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  let announcer = document.getElementById(`atheon-announcer-${priority}`);
  if (!announcer) {
    announcer = document.createElement('div');
    announcer.id = `atheon-announcer-${priority}`;
    announcer.setAttribute('aria-live', priority);
    announcer.setAttribute('aria-atomic', 'true');
    announcer.setAttribute('role', priority === 'assertive' ? 'alert' : 'status');
    Object.assign(announcer.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0',
    });
    document.body.appendChild(announcer);
  }
  // Clear and re-set to trigger announcement
  announcer.textContent = '';
  requestAnimationFrame(() => {
    announcer!.textContent = message;
  });
}

/** Trap focus within a container element (for modals/dialogs) */
export function trapFocus(container: HTMLElement): () => void {
  const focusableSelectors = [
    'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
    'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
    '[contenteditable]',
  ];
  const focusableElements = container.querySelectorAll<HTMLElement>(focusableSelectors.join(', '));
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable?.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable?.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeydown);
  firstFocusable?.focus();

  return () => container.removeEventListener('keydown', handleKeydown);
}

/** Check if user prefers reduced motion */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Get appropriate animation duration based on user preferences */
export function getAnimationDuration(normalMs: number): number {
  return prefersReducedMotion() ? 0 : normalMs;
}

/** Generate a unique ID for ARIA relationships */
let idCounter = 0;
export function generateAriaId(prefix: string = 'atheon'): string {
  return `${prefix}-${++idCounter}`;
}

/** Check contrast ratio between two colors (simplified) */
export function getContrastRatio(fg: string, bg: string): number {
  const getLuminance = (hex: string): number => {
    const rgb = hex.replace('#', '').match(/.{2}/g)?.map(c => {
      const val = parseInt(c, 16) / 255;
      return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
    }) || [0, 0, 0];
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const l1 = getLuminance(fg);
  const l2 = getLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Check if contrast meets WCAG AA requirements (4.5:1 for normal text, 3:1 for large) */
export function meetsContrastAA(fg: string, bg: string, isLargeText: boolean = false): boolean {
  const ratio = getContrastRatio(fg, bg);
  return isLargeText ? ratio >= 3 : ratio >= 4.5;
}
