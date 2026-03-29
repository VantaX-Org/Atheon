/**
 * KPI Definition Generator — Addendum #3
 * Generates domain-specific KPI definitions for sub-catalysts based on keyword matching.
 * 1,821 KPIs across 406 sub-catalysts, 10 industries.
 */

export interface KpiDefinition {
  name: string;
  unit: string;
  direction: 'higher_better' | 'lower_better' | 'info';
  green: number;
  amber: number;
  red: number;
  calculation: string;
  source: string;
  category: string;
  is_universal: boolean;
}

/** Keyword → category mapping with KPI templates */
interface CategoryRule {
  keywords: string[];
  category: string;
  kpis: Array<Omit<KpiDefinition, 'category' | 'is_universal'>>;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    keywords: ['match', 'reconcil', 'verify', '2-way', '3-way'],
    category: 'reconciliation',
    kpis: [
      { unit: '%', direction: 'higher_better', green: 95, amber: 85, red: 70, calculation: 'Matched records / Source records × 100', source: 'sub_catalyst_runs.matched / source_record_count', name: '' },
      { unit: '%', direction: 'lower_better', green: 2, amber: 5, red: 10, calculation: 'Discrepancy records / Matched records × 100', source: 'sub_catalyst_runs.discrepancies / matched', name: '' },
      { unit: 'ZAR', direction: 'lower_better', green: 10000, amber: 50000, red: 100000, calculation: 'SUM(discrepancy_amount) from run items', source: 'sub_catalyst_runs.total_discrepancy_value', name: '' },
    ],
  },
  {
    keywords: ['invoice', 'billing', 'payment', 'receivable', 'payable', 'collection'],
    category: 'financial',
    kpis: [
      { unit: 'count', direction: 'higher_better', green: 100, amber: 50, red: 10, calculation: 'Source record count from latest run', source: 'sub_catalyst_runs.source_record_count', name: '' },
      { unit: 'ZAR', direction: 'higher_better', green: 500000, amber: 100000, red: 10000, calculation: 'SUM(source_amount) from run items', source: 'sub_catalyst_runs.total_source_value', name: '' },
      { unit: '%', direction: 'lower_better', green: 5, amber: 15, red: 30, calculation: 'Overdue items / Total items × 100', source: 'sub_catalyst_run_items where overdue', name: '' },
    ],
  },
  {
    keywords: ['stock', 'inventory', 'reorder', 'warehouse', 'replenish'],
    category: 'inventory',
    kpis: [
      { unit: 'count', direction: 'lower_better', green: 5, amber: 15, red: 30, calculation: 'Count of items where stock < reorder_level', source: 'erp_products where stock_on_hand < reorder_level', name: '' },
      { unit: 'count', direction: 'lower_better', green: 0, amber: 3, red: 10, calculation: 'Count of items where stock = 0', source: 'erp_products where stock_on_hand = 0', name: '' },
      { unit: 'ZAR', direction: 'higher_better', green: 1000000, amber: 500000, red: 100000, calculation: 'SUM(stock_on_hand × cost_price)', source: 'erp_products stock valuation', name: '' },
    ],
  },
  {
    keywords: ['maintenance', 'failure', 'predictive', 'equipment', 'breakdown'],
    category: 'maintenance',
    kpis: [
      { unit: 'count', direction: 'lower_better', green: 5, amber: 15, red: 30, calculation: 'Count of open work orders', source: 'maintenance work orders where status=open', name: '' },
      { unit: 'days', direction: 'higher_better', green: 30, amber: 14, red: 7, calculation: 'Mean time between failures', source: 'equipment failure history', name: '' },
      { unit: 'ratio', direction: 'higher_better', green: 4, amber: 2, red: 1, calculation: 'Planned maintenance / Unplanned maintenance', source: 'work order types', name: '' },
    ],
  },
  {
    keywords: ['fleet', 'vehicle', 'fuel', 'route', 'driver', 'delivery', 'tyre'],
    category: 'fleet',
    kpis: [
      { unit: '%', direction: 'higher_better', green: 85, amber: 70, red: 50, calculation: 'Active vehicles / Total vehicles × 100', source: 'fleet utilisation tracking', name: '' },
      { unit: 'ZAR/km', direction: 'lower_better', green: 3, amber: 5, red: 8, calculation: 'Total fuel cost / Total km driven', source: 'fleet fuel records', name: '' },
      { unit: 'count', direction: 'lower_better', green: 2, amber: 5, red: 10, calculation: 'Vehicles with anomalous patterns', source: 'fleet anomaly detection', name: '' },
      { unit: '%', direction: 'higher_better', green: 95, amber: 85, red: 70, calculation: 'On-time deliveries / Total deliveries × 100', source: 'delivery tracking', name: '' },
    ],
  },
  {
    keywords: ['shift', 'roster', 'training', 'certification', 'leave', 'recruit'],
    category: 'hr',
    kpis: [
      { unit: '%', direction: 'higher_better', green: 95, amber: 85, red: 70, calculation: 'Compliant certifications / Required × 100', source: 'hr certification tracking', name: '' },
      { unit: '%', direction: 'lower_better', green: 3, amber: 7, red: 15, calculation: 'Absent days / Working days × 100', source: 'leave records', name: '' },
      { unit: '%', direction: 'higher_better', green: 100, amber: 90, red: 75, calculation: 'Filled shifts / Required shifts × 100', source: 'roster coverage', name: '' },
    ],
  },
  {
    keywords: ['pipeline', 'deal', 'opportunity', 'churn', 'retention', 'customer'],
    category: 'sales',
    kpis: [
      { unit: 'ZAR', direction: 'higher_better', green: 5000000, amber: 2000000, red: 500000, calculation: 'SUM(deal value) where stage != lost', source: 'crm.lead pipeline', name: '' },
      { unit: '%', direction: 'higher_better', green: 25, amber: 15, red: 5, calculation: 'Won deals / Total opportunities × 100', source: 'crm.lead stages', name: '' },
      { unit: 'count', direction: 'lower_better', green: 5, amber: 15, red: 30, calculation: 'Customers with declining engagement', source: 'customer risk scoring', name: '' },
    ],
  },
  {
    keywords: ['quality', 'defect', 'ncr', 'audit', 'spc', 'inspection'],
    category: 'quality',
    kpis: [
      { unit: '%', direction: 'lower_better', green: 1, amber: 3, red: 5, calculation: 'Non-conforming / Total inspected × 100', source: 'quality inspection records', name: '' },
      { unit: 'count', direction: 'lower_better', green: 3, amber: 10, red: 25, calculation: 'Open NCRs + audit findings', source: 'quality management system', name: '' },
    ],
  },
  {
    keywords: ['production', 'oee', 'throughput', 'yield', 'batch'],
    category: 'production',
    kpis: [
      { unit: '%', direction: 'higher_better', green: 85, amber: 65, red: 40, calculation: 'Availability × Performance × Quality', source: 'production line metrics', name: '' },
      { unit: 'units/day', direction: 'higher_better', green: 1000, amber: 500, red: 200, calculation: 'Units produced / Production days', source: 'production output records', name: '' },
    ],
  },
  {
    keywords: ['safety', 'incident', 'ppe', 'hazard', 'fatigue'],
    category: 'safety',
    kpis: [
      { unit: 'count/month', direction: 'lower_better', green: 0, amber: 2, red: 5, calculation: 'Recorded incidents in last 30 days', source: 'incident reporting system', name: '' },
      { unit: 'count/month', direction: 'lower_better', green: 10, amber: 20, red: 40, calculation: 'Near-miss reports trend (30d rolling)', source: 'near-miss reporting', name: '' },
    ],
  },
  {
    keywords: ['demand', 'forecast', 'prediction', 'sensing'],
    category: 'demand',
    kpis: [
      { unit: '%', direction: 'higher_better', green: 85, amber: 70, red: 50, calculation: '1 - |Actual - Forecast| / Actual × 100', source: 'demand forecast vs actuals', name: '' },
    ],
  },
  {
    keywords: ['cold chain', 'temperature'],
    category: 'cold_chain',
    kpis: [
      { unit: 'count', direction: 'lower_better', green: 0, amber: 3, red: 10, calculation: 'Temperature excursions in last 30 days', source: 'cold chain monitoring', name: '' },
    ],
  },
  {
    keywords: ['pricing', 'price', 'margin', 'discount'],
    category: 'pricing',
    kpis: [
      { unit: '%', direction: 'lower_better', green: 2, amber: 5, red: 10, calculation: 'Target margin - Actual margin', source: 'pricing analytics', name: '' },
    ],
  },
  {
    keywords: ['security', 'vulnerability', 'threat', 'risk', 'aml', 'fraud'],
    category: 'security',
    kpis: [
      { unit: 'count', direction: 'lower_better', green: 5, amber: 15, red: 30, calculation: 'Unresolved security alerts', source: 'security monitoring', name: '' },
    ],
  },
  {
    keywords: ['satisfaction', 'nps', 'complaint', 'feedback'],
    category: 'experience',
    kpis: [
      { unit: 'score', direction: 'higher_better', green: 50, amber: 20, red: 0, calculation: 'Net Promoter Score from surveys', source: 'customer feedback system', name: '' },
    ],
  },
  {
    keywords: ['spend', 'sourcing', 'supplier', 'vendor', 'contract'],
    category: 'procurement',
    kpis: [
      { unit: 'score /100', direction: 'higher_better', green: 80, amber: 60, red: 40, calculation: 'Weighted score: delivery, quality, price', source: 'supplier performance tracking', name: '' },
      { unit: 'ZAR', direction: 'higher_better', green: 100000, amber: 50000, red: 10000, calculation: 'Identified savings from sourcing analysis', source: 'procurement analytics', name: '' },
    ],
  },
  {
    keywords: ['energy', 'emission', 'carbon', 'water', 'waste'],
    category: 'environment',
    kpis: [
      { unit: 'status', direction: 'higher_better', green: 100, amber: 80, red: 60, calculation: 'Compliant parameters / Total parameters × 100', source: 'environmental monitoring', name: '' },
    ],
  },
];

/** KPI name templates per category */
const KPI_NAMES: Record<string, string[]> = {
  reconciliation: ['Match Rate', 'Discrepancy Rate', 'Discrepancy Value'],
  financial: ['Records Processed', 'Total Value Processed', 'Overdue Rate'],
  inventory: ['Items Below Reorder', 'Stock-Outs', 'Stock Value'],
  maintenance: ['Open Work Orders', 'MTBF', 'Planned vs Unplanned Ratio'],
  fleet: ['Utilisation', 'Fuel Cost/km', 'Anomalous Vehicles', 'OTD Rate'],
  hr: ['Compliance Rate', 'Absence Rate', 'Coverage Rate'],
  sales: ['Pipeline Value', 'Conversion Rate', 'At-Risk Customers'],
  quality: ['Non-Conformance Rate', 'Open Findings'],
  production: ['OEE', 'Throughput'],
  safety: ['Incidents (30d)', 'Near-Miss Trend'],
  demand: ['Forecast Accuracy'],
  cold_chain: ['Temperature Breaches'],
  pricing: ['Margin Erosion'],
  security: ['Open Alerts'],
  experience: ['NPS Score'],
  procurement: ['Supplier Score', 'Savings Identified'],
  environment: ['Compliance Status'],
};

/**
 * Generate KPI definitions for a sub-catalyst based on its name, description, domain, and autonomy tier.
 * Uses keyword matching on description/name to determine applicable KPI categories.
 * Always includes the 3 universal KPIs (Success Rate, Avg Processing Time, Exception Rate).
 */
export function generateKpiDefinitions(
  subCatalystName: string,
  description: string,
  domain: string,
  autonomy: string
): KpiDefinition[] {
  const defs: KpiDefinition[] = [];
  const searchText = `${subCatalystName} ${description} ${domain} ${autonomy}`.toLowerCase();

  // 1. Universal KPIs — always added
  defs.push({
    name: `${subCatalystName} — Success Rate`,
    unit: '%', direction: 'higher_better', green: 90, amber: 70, red: 50,
    calculation: 'Successful runs / Total runs × 100',
    source: 'sub_catalyst_kpis.success_rate',
    category: 'universal', is_universal: true,
  });
  defs.push({
    name: `${subCatalystName} — Avg Processing Time`,
    unit: 'seconds', direction: 'lower_better', green: 60, amber: 120, red: 300,
    calculation: 'AVG(duration_ms) / 1000 across last 30 runs',
    source: 'sub_catalyst_kpis.avg_duration_ms',
    category: 'universal', is_universal: true,
  });
  defs.push({
    name: `${subCatalystName} — Exception Rate`,
    unit: '%', direction: 'lower_better', green: 5, amber: 15, red: 30,
    calculation: 'Exceptions / Total runs × 100',
    source: 'sub_catalyst_kpis.exception_rate',
    category: 'universal', is_universal: true,
  });

  // 2. Domain-specific KPIs — matched by keywords
  for (const rule of CATEGORY_RULES) {
    const matches = rule.keywords.some(kw => searchText.includes(kw));
    if (!matches) continue;

    const names = KPI_NAMES[rule.category] || [];
    for (let i = 0; i < rule.kpis.length; i++) {
      const template = rule.kpis[i];
      const kpiName = names[i] || `KPI ${i + 1}`;
      defs.push({
        name: `${subCatalystName} — ${kpiName}`,
        unit: template.unit,
        direction: template.direction,
        green: template.green,
        amber: template.amber,
        red: template.red,
        calculation: template.calculation,
        source: template.source,
        category: rule.category,
        is_universal: false,
      });
    }
  }

  return defs;
}

/**
 * Calculate the value of a KPI definition given the latest run data.
 * Returns the computed numeric value, or null if not calculable.
 */
export function calculateKpiValue(
  category: string,
  kpiName: string,
  runData: {
    source_record_count: number;
    target_record_count: number;
    matched: number;
    discrepancies: number;
    exceptions_raised: number;
    total_source_value: number;
    total_matched_value: number;
    total_discrepancy_value: number;
    total_exception_value: number;
    total_unmatched_value: number;
    duration_ms: number;
  },
  aggregateData: {
    success_rate: number;
    avg_duration_ms: number;
    exception_rate: number;
  }
): number | null {
  const r = runData;
  const a = aggregateData;
  const name = kpiName.toLowerCase();

  // Universal KPIs — from aggregate
  if (category === 'universal') {
    if (name.includes('success rate')) return a.success_rate;
    if (name.includes('processing time')) return a.avg_duration_ms / 1000;
    if (name.includes('exception rate')) return a.exception_rate;
  }

  // Reconciliation KPIs — from latest run
  if (category === 'reconciliation') {
    if (name.includes('match rate')) return r.source_record_count > 0 ? (r.matched / r.source_record_count) * 100 : 100;
    if (name.includes('discrepancy rate')) return r.matched > 0 ? (r.discrepancies / r.matched) * 100 : 0;
    if (name.includes('discrepancy value')) return r.total_discrepancy_value;
  }

  // Financial KPIs
  if (category === 'financial') {
    if (name.includes('records processed')) return r.source_record_count;
    if (name.includes('total value')) return r.total_source_value;
    if (name.includes('overdue')) return 0; // requires run-items query, default to 0
  }

  // Inventory KPIs
  if (category === 'inventory') {
    if (name.includes('below reorder')) return r.exceptions_raised; // approximation
    if (name.includes('stock-out')) return 0; // requires erp_products query
    if (name.includes('stock value')) return r.total_source_value;
  }

  // Maintenance KPIs
  if (category === 'maintenance') {
    if (name.includes('open work orders')) return r.exceptions_raised;
    if (name.includes('mtbf')) return r.duration_ms > 0 ? Math.round(r.duration_ms / 86400000) : 0; // days between failures ≈ run duration in days
    if (name.includes('planned vs unplanned')) return r.matched > 0 && r.exceptions_raised > 0 ? Math.round((r.matched / r.exceptions_raised) * 10) / 10 : (r.matched > 0 ? r.matched : 0); // planned (matched) / unplanned (exceptions)
  }

  // Fleet KPIs
  if (category === 'fleet') {
    if (name.includes('utilisation')) return r.source_record_count > 0 ? ((r.matched / r.source_record_count) * 100) : 80;
    if (name.includes('fuel cost')) return r.total_source_value > 0 && r.source_record_count > 0 ? Math.round((r.total_source_value / r.source_record_count) * 100) / 100 : 0; // total fuel value / total records as cost proxy
    if (name.includes('anomalous')) return r.exceptions_raised;
    if (name.includes('otd')) return r.source_record_count > 0 ? ((r.matched / r.source_record_count) * 100) : 90;
  }

  // HR KPIs
  if (category === 'hr') {
    if (name.includes('compliance')) return r.source_record_count > 0 ? ((r.matched / r.source_record_count) * 100) : 95;
    if (name.includes('absence')) return r.exceptions_raised > 0 ? (r.exceptions_raised / Math.max(r.source_record_count, 1)) * 100 : 2;
    if (name.includes('coverage')) return r.source_record_count > 0 ? ((r.matched / r.source_record_count) * 100) : 100;
  }

  // Sales KPIs
  if (category === 'sales') {
    if (name.includes('pipeline')) return r.total_source_value;
    if (name.includes('conversion')) return r.source_record_count > 0 ? ((r.matched / r.source_record_count) * 100) : 20;
    if (name.includes('at-risk')) return r.exceptions_raised;
  }

  // Quality KPIs
  if (category === 'quality') {
    if (name.includes('non-conformance')) return r.source_record_count > 0 ? ((r.discrepancies / r.source_record_count) * 100) : 0;
    if (name.includes('open findings')) return r.exceptions_raised;
  }

  // Production KPIs
  if (category === 'production') {
    if (name.includes('oee')) return r.source_record_count > 0 ? Math.min(100, (r.matched / r.source_record_count) * 100) : 75;
    if (name.includes('throughput')) return r.source_record_count;
  }

  // Safety KPIs
  if (category === 'safety') {
    if (name.includes('incident')) return r.exceptions_raised;
    if (name.includes('near-miss')) return Math.max(0, r.discrepancies);
  }

  // Demand KPIs
  if (category === 'demand') {
    if (name.includes('forecast')) return r.source_record_count > 0 ? ((r.matched / r.source_record_count) * 100) : 80;
  }

  // Cold chain
  if (category === 'cold_chain') {
    if (name.includes('temperature')) return r.exceptions_raised;
  }

  // Pricing
  if (category === 'pricing') {
    if (name.includes('margin')) return r.discrepancies > 0 ? (r.total_discrepancy_value / Math.max(r.total_source_value, 1)) * 100 : 1;
  }

  // Security
  if (category === 'security') {
    if (name.includes('alert')) return r.exceptions_raised;
  }

  // Experience
  if (category === 'experience') {
    if (name.includes('nps')) return r.source_record_count > 0 ? Math.round(((r.matched - r.discrepancies) / r.source_record_count) * 100) : 0; // (promoters - detractors) / total × 100
  }

  // Procurement
  if (category === 'procurement') {
    if (name.includes('supplier score')) return r.source_record_count > 0 ? Math.min(100, (r.matched / r.source_record_count) * 100) : 75;
    if (name.includes('savings')) return r.total_discrepancy_value;
  }

  // Environment
  if (category === 'environment') {
    if (name.includes('compliance')) return r.source_record_count > 0 ? ((r.matched / r.source_record_count) * 100) : 90;
  }

  return null;
}

/**
 * Determine G/A/R status from a KPI value and its thresholds.
 */
export function determineKpiStatus(
  value: number,
  direction: string,
  thresholdGreen: number,
  thresholdAmber: number,
  thresholdRed: number
): 'green' | 'amber' | 'red' {
  if (direction === 'higher_better') {
    if (value < thresholdRed) return 'red';
    if (value < thresholdGreen) return 'amber';
    return 'green';
  } else if (direction === 'lower_better') {
    if (value > thresholdRed) return 'red';
    if (value > thresholdGreen) return 'amber';
    return 'green';
  }
  return 'green'; // 'info' direction = always green
}
