// Shared right-hand drawer — the one expansion surface for drill-throughs and
// action review across the console. Mount it only when open; it slides in on
// the next frame and closes on scrim click or Escape. Focus moves in on open,
// stays trapped while open, and returns to the opener on close.
import { useEffect, useRef, useState, type ReactNode } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function SideDrawer({ label, head, onClose, children }: {
  label: string;
  head?: ReactNode; // left side of the header: seal pill, kicker, whatever the surface needs
  onClose: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      setOpen(true);
      ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', key);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <>
      <div className={`scrim${open ? ' show' : ''}`} onClick={onClose} />
      <aside ref={ref} className={`drawer${open ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        <div className="drawer-head">
          {head ?? <span />}
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </aside>
    </>
  );
}
