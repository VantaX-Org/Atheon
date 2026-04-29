/**
 * BrandProvider — applies per-tenant whitelabel to the document.
 *
 * Watches `user.brand` from appStore and:
 *   - Sets CSS var `--brand-accent` on :root from `primaryColor` (hex without #)
 *   - Falls back to the platform default (`--accent`) when unset
 *
 * Components that want the brand color override should read
 * `var(--brand-accent, var(--accent))` so unbranded tenants stay on the
 * platform default. Logo + name override are applied in the components
 * that render them (Header, Login).
 */
import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";

function applyAccent(hex: string | null | undefined): void {
  const root = document.documentElement;
  if (!hex) {
    root.style.removeProperty('--brand-accent');
    return;
  }
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(normalized)) {
    // Defensive: server validates, but a stale localStorage value could slip
    // through. Don't crash — just clear the override.
    root.style.removeProperty('--brand-accent');
    return;
  }
  root.style.setProperty('--brand-accent', `#${normalized}`);
}

export function BrandProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const brandColor = useAppStore(s => s.user?.brand?.primaryColor ?? null);

  useEffect(() => {
    applyAccent(brandColor);
    return () => applyAccent(null);
  }, [brandColor]);

  return <>{children}</>;
}
