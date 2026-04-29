/**
 * Frontend heuristic mapper from a Pulse anomaly metric or an Apex risk
 * category to the catalyst cluster + sub-catalyst that resolves it.
 *
 * The backend catalyst engine already does this kind of routing for
 * incoming TaskDefinition (catalyst-{operational,commercial,service,
 * general,cross-cutting}-handlers.ts), but those handlers run at execution
 * time. Here we need a recommendation BEFORE the user clicks — so this
 * mapper is a small parallel of the same matching logic, kept deliberately
 * conservative: when no rule matches we return null and let the caller
 * fall back to a generic "Open Catalysts" navigation.
 *
 * Maintenance: when a new catalyst type is added that should be surfaced
 * for a specific anomaly/risk pattern, add a rule here. Existing rules
 * are ordered most-specific-first.
 */

export interface CatalystRecommendation {
  /** Cluster name as it appears in CATALYST_CATALOG. */
  catalyst: string;
  /** Sub-catalyst name within the cluster. */
  subCatalyst: string;
}

interface Rule {
  /** Match keywords (lowercased, word-boundary on caller side). */
  keywords: string[];
  rec: CatalystRecommendation;
}

/**
 * Anomaly metric → catalyst rules. Keywords are matched against the
 * lowercased metric string. First rule with any matching keyword wins.
 */
const ANOMALY_RULES: Rule[] = [
  // Safety / incident — operational handlers
  { keywords: ['safety', 'incident', 'injury', 'ppe', 'fatality'], rec: { catalyst: 'Safety Compliance Catalyst', subCatalyst: 'Safety Incident Trend' } },
  // Manufacturing
  { keywords: ['production', 'throughput', 'oee', 'defect', 'quality'], rec: { catalyst: 'Operational Excellence Catalyst', subCatalyst: 'Production Quality' } },
  { keywords: ['downtime', 'maintenance', 'equipment'], rec: { catalyst: 'Operational Excellence Catalyst', subCatalyst: 'Machine Downtime' } },
  // Tech / SLO
  { keywords: ['api', 'latency', 'uptime', 'error rate', 'p95', 'p99', 'slo'], rec: { catalyst: 'Operations Catalyst', subCatalyst: 'Operational KPI Anomaly' } },
  // Sales
  { keywords: ['sales', 'revenue', 'conversion', 'pipeline'], rec: { catalyst: 'Sales Intelligence Catalyst', subCatalyst: 'Sales Pipeline Risk' } },
  // Inventory / stock
  { keywords: ['inventory', 'stock', 'oos', 'out-of-stock', 'reorder'], rec: { catalyst: 'Supply Chain Catalyst', subCatalyst: 'Inventory Optimisation' } },
  // Finance / AR / cash
  { keywords: ['invoice', 'payment', 'receivable', 'overdue', 'cash flow', 'ar '], rec: { catalyst: 'Finance Catalyst', subCatalyst: 'AR Collection' } },
  { keywords: ['ap ', 'payable', 'three-way', 'duplicate-pay'], rec: { catalyst: 'Finance Catalyst', subCatalyst: 'AP Processing' } },
  { keywords: ['fx', 'foreign exchange', 'currency'], rec: { catalyst: 'Finance Catalyst', subCatalyst: 'FX Hedge Advisory' } },
  // HR
  { keywords: ['turnover', 'attrition', 'headcount', 'churn', 'retention'], rec: { catalyst: 'HR Catalyst', subCatalyst: 'HR Turnover' } },
  { keywords: ['ghost', 'payroll'], rec: { catalyst: 'HR Catalyst', subCatalyst: 'Payroll Audit' } },
  // Customer experience
  { keywords: ['nps', 'csat', 'customer satisfaction', 'voice-of-customer'], rec: { catalyst: 'Customer Experience Catalyst', subCatalyst: 'Customer Experience NPS' } },
  // Compliance
  { keywords: ['popia', 'gdpr', 'compliance', 'regulatory', 'audit gap'], rec: { catalyst: 'Compliance & Regulatory Catalyst', subCatalyst: 'Compliance Risk' } },
  // Supply / vendor
  { keywords: ['supplier', 'vendor'], rec: { catalyst: 'Procurement Catalyst', subCatalyst: 'Vendor Master Cleanup' } },
  // Logistics / fleet / delivery
  { keywords: ['fleet', 'delivery', 'route', 'shipment', 'carrier'], rec: { catalyst: 'Logistics Catalyst', subCatalyst: 'Delivery Compliance' } },
  // Healthcare
  { keywords: ['readmission', 'patient', 'staffing'], rec: { catalyst: 'Healthcare Operations Catalyst', subCatalyst: 'Staffing Coverage' } },
];

/**
 * Risk category / title → catalyst rules. Risks tend to use structured
 * categories (compliance-popia, sales-pipeline, incident-safety) so this
 * map is more deterministic than the anomaly one.
 */
const RISK_RULES: Rule[] = [
  { keywords: ['safety', 'incident', 'fatality'], rec: { catalyst: 'Safety Compliance Catalyst', subCatalyst: 'Safety Incident Trend' } },
  { keywords: ['popia', 'compliance', 'regulatory', 'audit', 'legal', 'hpcsa'], rec: { catalyst: 'Compliance & Regulatory Catalyst', subCatalyst: 'Compliance Risk' } },
  { keywords: ['security', 'cve', 'vuln', 'breach'], rec: { catalyst: 'Operations Catalyst', subCatalyst: 'Operational KPI Anomaly' } },
  { keywords: ['sales', 'pipeline', 'revenue'], rec: { catalyst: 'Sales Intelligence Catalyst', subCatalyst: 'Sales Pipeline Risk' } },
  { keywords: ['credit', 'concentration', 'portfolio', 'counterparty'], rec: { catalyst: 'Finance Catalyst', subCatalyst: 'Credit Vetting' } },
  { keywords: ['cash flow', 'liquidity'], rec: { catalyst: 'Finance Catalyst', subCatalyst: 'Cash Flow Forecast' } },
  { keywords: ['supplier', 'vendor', 'sourcing'], rec: { catalyst: 'Procurement Catalyst', subCatalyst: 'Vendor Master Cleanup' } },
  { keywords: ['turnover', 'attrition', 'workforce'], rec: { catalyst: 'HR Catalyst', subCatalyst: 'HR Turnover' } },
  { keywords: ['inventory', 'stockout', 'oos'], rec: { catalyst: 'Supply Chain Catalyst', subCatalyst: 'Inventory Optimisation' } },
];

function matchRules(rules: Rule[], haystack: string): CatalystRecommendation | null {
  if (!haystack) return null;
  const lower = haystack.toLowerCase();
  for (const rule of rules) {
    if (rule.keywords.some(k => lower.includes(k))) return rule.rec;
  }
  return null;
}

/** Recommendation from a Pulse anomaly's metric string. */
export function recommendForAnomaly(metric: string): CatalystRecommendation | null {
  return matchRules(ANOMALY_RULES, metric);
}

/** Recommendation from an Apex risk's category + title. */
export function recommendForRisk(input: { category?: string; title?: string }): CatalystRecommendation | null {
  const cat = matchRules(RISK_RULES, input.category || '');
  if (cat) return cat;
  return matchRules(RISK_RULES, input.title || '');
}

/**
 * Recommendation from a peer-benchmark dimension name (e.g. "Finance",
 * "Operations", "Procurement"). Used by the Apex Peer Benchmarks tab to
 * surface a Deploy CTA when the tenant is below the median in a dimension.
 *
 * Falls back to the risk rules first since dimensions overlap with risk
 * categories (e.g. "Finance" risk rules match "Finance" dimension), then
 * the anomaly rules so generic phrases like "Quality" or "Maintenance"
 * still resolve.
 */
export function recommendForDimension(dimension: string): CatalystRecommendation | null {
  if (!dimension) return null;
  return matchRules(RISK_RULES, dimension) || matchRules(ANOMALY_RULES, dimension);
}

/**
 * Build the /catalysts navigation URL with a pre-selected cluster + sub.
 * The CatalystsPage reads these query params on mount to scroll-to and
 * highlight the matched row.
 */
export function catalystDeployUrl(rec: CatalystRecommendation): string {
  const params = new URLSearchParams({ cluster: rec.catalyst, sub: rec.subCatalyst });
  return `/catalysts?${params.toString()}`;
}
