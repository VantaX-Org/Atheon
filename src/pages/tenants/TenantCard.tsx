import { Badge } from "@/components/ui/badge";
import { Building2, Users, Calendar } from "lucide-react";

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  industry?: string;
  user_count?: number;
  status: string;
  created_at: string;
}

interface TenantCardProps {
  tenant: TenantInfo;
  onSelect: (id: string) => void;
}

export function TenantCard({ tenant, onSelect }: TenantCardProps) {
  return (
    <button
      onClick={() => onSelect(tenant.id)}
      className="w-full p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] hover:border-accent/30 transition-all text-left"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
          <Building2 size={18} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold t-primary truncate">{tenant.name}</p>
          <p className="text-[10px] t-muted">{tenant.slug}</p>
        </div>
        <Badge variant={tenant.status === 'active' ? 'success' : 'default'} size="sm">{tenant.status}</Badge>
      </div>
      <div className="flex items-center gap-4 text-[10px] t-muted">
        {tenant.industry && <span>{tenant.industry}</span>}
        {tenant.user_count !== undefined && (
          <span className="flex items-center gap-1"><Users size={10} /> {tenant.user_count} users</span>
        )}
        <span className="flex items-center gap-1"><Calendar size={10} /> {new Date(tenant.created_at).toLocaleDateString()}</span>
      </div>
    </button>
  );
}
