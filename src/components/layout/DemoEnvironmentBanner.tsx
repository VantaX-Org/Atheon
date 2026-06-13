import { useAppStore } from "@/stores/appStore";
import { API_URL } from "@/lib/api";
import { AlertTriangle } from "lucide-react";

function isDemoEnvironment(tenantName: string | null | undefined): boolean {
  try {
    const host = new URL(API_URL).host.toLowerCase();
    if (host.includes("staging") || host.startsWith("localhost") || host.includes("127.0.0.1")) {
      return true;
    }
  } catch {
    /* malformed VITE_API_URL — fall through to tenant check */
  }
  return !!tenantName && tenantName.toLowerCase().includes("vantax");
}

export function DemoEnvironmentBanner() {
  const user = useAppStore((s) => s.user);
  if (!isDemoEnvironment(user?.tenantName)) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 px-3 py-1 text-[11px] font-medium tracking-wide uppercase"
      style={{
        background: "rgb(154 107 31 / 0.18)",
        color: "var(--warning, #c89a3c)",
        borderBottom: "1px solid rgb(154 107 31 / 0.35)",
        backdropFilter: "blur(6px)",
      }}
    >
      <AlertTriangle size={11} aria-hidden="true" />
      <span>Demo environment — data is illustrative; do not enter real customer information.</span>
    </div>
  );
}
