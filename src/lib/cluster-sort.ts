/**
 * Catalog domains are prefixed by vertical (mining-safety, health-patient,
 * agri-crop...). Map the tenant's IndustryVertical to that prefix so
 * industry-relevant clusters sort first in the deploy view.
 */
const INDUSTRY_DOMAIN_PREFIX: Record<string, string> = {
  mining: 'mining',
  healthcare: 'health',
  agriculture: 'agri',
  logistics: 'logistics',
  technology: 'tech',
  manufacturing: 'mfg',
  fmcg: 'fmcg',
  retail: 'retail',
};

export function matchesIndustry(domain: string, industry: string): boolean {
  const prefix = INDUSTRY_DOMAIN_PREFIX[industry];
  return !!prefix && (domain === prefix || domain.startsWith(`${prefix}-`));
}

/** Sort: tenant-industry domains first, then by domain, then by name. */
export function sortClustersForDeploy<T extends { domain: string; name: string }>(clusters: T[], industry: string): T[] {
  return [...clusters].sort((a, b) => {
    const ai = matchesIndustry(a.domain, industry) ? 0 : 1;
    const bi = matchesIndustry(b.domain, industry) ? 0 : 1;
    return ai - bi || a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name);
  });
}
