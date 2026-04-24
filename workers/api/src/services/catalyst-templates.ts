/**
 * Catalyst Catalog
 *
 * A single, flat catalog of catalyst clusters — available to every tenant.
 *
 * This module used to segment catalysts into 10 industry buckets (mining,
 * agriculture, healthcare, logistics, technology, manufacturing, financial
 * services, fmcg, retail, general). The segmentation created a lot of
 * duplication (34 named sub-catalysts appeared 2-6 times each, and
 * "Procurement Catalyst" existed 8 separate times with mostly-overlapping
 * sub-catalysts) and caused tenants to only ever see one vertical's
 * catalysts during deployment.
 *
 * We now expose a single {@link CATALYST_CATALOG} that deduplicates by
 * name and carries multi-dimension tags (function / vertical /
 * criticality / maturity). Industry filtering migrates to tag-based
 * lookups via {@link getClustersByTag}.
 *
 * Backwards compatibility: the {@link INDUSTRY_TEMPLATES} export and the
 * {@link getTemplateForIndustry} helper are preserved (derived from the
 * flat catalog, grouped on a primary tag) so the existing `/templates`
 * and `/deploy-template` endpoints continue to work unchanged while the
 * frontend is updated. The original un-prefixed tag values
 * (e.g. `'finance'`, `'mining'`) are kept on every cluster alongside
 * the new prefixed dimensions so `getClustersByTag('finance')` and the
 * industry derivation continue to function.
 *
 * Tag taxonomy (added in the catalog polish pass):
 *
 *   function:finance | function:procurement | function:supply-chain |
 *   function:sales   | function:hr          | function:operations   |
 *   function:compliance | function:it       | function:customer
 *
 *   vertical:mining | vertical:agriculture | vertical:healthcare |
 *   vertical:logistics | vertical:technology-saas |
 *   vertical:manufacturing | vertical:financial-services |
 *   vertical:fmcg | vertical:retail | vertical:general
 *
 *   criticality:compliance-critical | criticality:revenue-impacting |
 *   criticality:cost-impacting      | criticality:operational
 *
 *   maturity:starter | maturity:core | maturity:advanced |
 *   maturity:experimental
 *
 * Every cluster carries exactly one `function:*` tag, at least one
 * `vertical:*` tag, one `criticality:*` tag, and one `maturity:*` tag.
 */

export interface SubCatalystTemplate {
  name: string;
  enabled: boolean;
  description: string;
  schedule?: {
    frequency: 'manual' | 'daily' | 'weekly' | 'monthly';
    day_of_week?: number;   // 0=Sun..6=Sat (for weekly)
    day_of_month?: number;  // 1-31 (for monthly)
    time_of_day?: string;   // HH:MM in UTC
  };
}

export interface CatalystTemplate {
  name: string;
  domain: string;
  description: string;
  autonomy_tier: string;
  /**
   * Tags replace the old industry segmentation. Clusters can carry
   * multiple tags — e.g. ['function:finance', 'vertical:mining',
   * 'criticality:cost-impacting', 'maturity:core', 'finance', 'mining']
   * — so callers can filter by function, vertical, criticality or
   * maturity, while the un-prefixed aliases keep the legacy
   * industry-derived filters working.
   */
  tags: string[];
  sub_catalysts: SubCatalystTemplate[];
}

/**
 * @deprecated Use {@link CATALYST_CATALOG} with tag filtering via
 * {@link getClustersByTag}. Kept for backwards compatibility during the
 * flatten rollout so existing consumers (the `/templates` endpoint and
 * the frontend Tenants page) keep working until they are updated.
 */
export interface IndustryTemplate {
  industry: string;
  label: string;
  description: string;
  clusters: CatalystTemplate[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CATALYST CATALOG — single flat catalog, no industry segmentation
// ═══════════════════════════════════════════════════════════════════════════
// All cluster names from the previous 10-industry catalog are preserved
// here so existing deployments (which use `name` as the tenant-unique key)
// and frontend references continue to resolve. Where the same name appeared
// in multiple industries (e.g. "Procurement Catalyst" × 8), we kept ONE
// canonical definition and tagged it with every industry it originated
// from. Where an industry published its own named variant (e.g.
// "Retail Finance Catalyst" vs "SaaS Finance Catalyst"), we kept the
// variant as a distinct cluster so the specialised sub-catalysts are
// still available.
// ═══════════════════════════════════════════════════════════════════════════

export const CATALYST_CATALOG: CatalystTemplate[] = [
  // ───────────────────────────────────────────────────────────────────────
  // Cross-cutting / universal clusters (merged from multiple industries)
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'Finance Catalyst',
    domain: 'finance',
    description: 'Accounts payable, receivable, reconciliation, cash flow, and reporting across the business',
    autonomy_tier: 'assisted',
    tags: [
      'function:finance',
      'vertical:general', 'vertical:agriculture', 'vertical:fmcg',
      'criticality:cost-impacting',
      'maturity:starter',
      // Legacy aliases
      'general', 'agriculture', 'fmcg', 'finance',
    ],
    sub_catalysts: [
      { name: 'Accounts Payable', enabled: true, description: 'Invoice processing and payment scheduling automation' },
      { name: 'Accounts Receivable', enabled: true, description: 'Invoicing and collections management' },
      { name: 'Reconciliation', enabled: true, description: 'Bank and account reconciliation automation' },
      { name: 'Cash Flow Forecast', enabled: true, description: '12-week rolling cash flow projection' },
      { name: 'Financial Reporting', enabled: false, description: 'Automated financial statement generation' },
      { name: 'Budget Management', enabled: true, description: 'Budget tracking and variance reporting' },
      { name: 'Seasonal Budget Planning', enabled: false, description: 'Cycle-aligned budget forecasting and variance tracking' },
      { name: 'Grant & Subsidy Tracking', enabled: false, description: 'Grant applications and compliance monitoring' },
    ],
  },
  {
    name: 'Finance Operations Catalyst',
    domain: 'finance',
    description: 'Automated journal entries, budget vs actual monitoring, cost allocation, and inventory valuation',
    autonomy_tier: 'transactional',
    tags: [
      'function:finance',
      'vertical:mining', 'vertical:manufacturing',
      'criticality:cost-impacting',
      'maturity:core',
      // Legacy aliases
      'mining', 'manufacturing', 'finance',
    ],
    sub_catalysts: [
      { name: 'Accounts Receivable', enabled: true, description: 'Automated AR aging and collection workflows' },
      { name: 'Accounts Payable', enabled: true, description: 'Invoice matching and payment scheduling' },
      // Renamed from "Invoice Reconciliation"
      { name: '3-Way Matching & Exception Handling', enabled: true, description: 'Automated 3-way match across Purchase Order (PO), Goods Receipt Note (GRN), and supplier Invoice, with exception routing for mismatches' },
      { name: 'Cost Allocation', enabled: false, description: 'Activity-based costing across cost centers' },
      // Renamed from "Variance Analysis"
      { name: 'Budget vs Actual Monitoring', enabled: true, description: 'Budget versus actual variance detection and reporting' },
      // Renamed from "Production Costing"
      { name: 'Standard Cost Variance & Product Profitability', enabled: true, description: 'Standard versus actual cost variance by product and work center, with per-product margin analysis' },
      { name: 'Inventory Valuation', enabled: true, description: 'FIFO/weighted average inventory valuation automation' },
      { name: 'Budget Forecasting', enabled: false, description: 'Volume-linked budget and cash flow forecasting' },
    ],
  },
  {
    name: 'Procurement Catalyst',
    domain: 'procurement',
    description: 'Supplier management, PO automation, sourcing, and spend analytics',
    autonomy_tier: 'assisted',
    tags: [
      'function:procurement',
      'vertical:general', 'vertical:mining', 'vertical:agriculture', 'vertical:logistics',
      'vertical:technology-saas', 'vertical:manufacturing', 'vertical:financial-services', 'vertical:fmcg',
      'criticality:cost-impacting',
      'maturity:starter',
      // Legacy aliases
      'general', 'mining', 'agriculture', 'logistics', 'technology', 'manufacturing', 'financial_services', 'fmcg',
    ],
    sub_catalysts: [
      { name: 'Supplier Management', enabled: true, description: 'Vendor qualification, performance rating, and relationship management' },
      { name: 'Supplier Scoring', enabled: true, description: 'Automated supplier risk and performance rating' },
      { name: 'PO Automation', enabled: true, description: 'Purchase order creation and multi-level approval workflows' },
      { name: 'Strategic Sourcing', enabled: false, description: 'Sourcing event management and competitive bidding coordination' },
      { name: 'Spend Analytics', enabled: false, description: 'Category-level spend analysis and savings identification' },
      { name: 'Contract Management', enabled: true, description: 'Automated contract renewal alerts and compliance tracking' },
      // Renamed from "Supplier Risk"
      { name: 'Supplier Financial Health Monitoring', enabled: true, description: 'Supplier financial stability monitoring and supply disruption risk scoring' },
      { name: 'Vendor Scoring', enabled: false, description: 'Supplier reliability and pricing benchmarking' },
      { name: 'Tender Management', enabled: false, description: 'Tender creation, evaluation, and awarding' },
      { name: 'Input Procurement', enabled: false, description: 'Raw input (seed/fertilizer/chemical) purchasing and price comparison' },
      { name: 'Cooperative Buying', enabled: false, description: 'Cooperative bulk purchasing coordination for volume discounts' },
      { name: 'Equipment Purchasing', enabled: false, description: 'Machinery sourcing, leasing, and total cost of ownership analysis' },
      { name: 'Contract Farming', enabled: false, description: 'Buyer contract management and compliance for off-take agreements' },
      { name: 'Fuel Procurement', enabled: false, description: 'Bulk fuel purchasing and depot price optimization' },
      { name: 'Parts Purchasing', enabled: false, description: 'Automated spare parts reordering based on maintenance schedules' },
      { name: 'SaaS License Management', enabled: false, description: 'Software license utilization tracking and optimization' },
      { name: 'Vendor Consolidation', enabled: false, description: 'Overlapping tool identification and consolidation opportunities' },
      { name: 'Contract Negotiation', enabled: false, description: 'Benchmark-based pricing intelligence for vendor negotiations' },
      { name: 'Budget Forecasting', enabled: false, description: 'Technology/category spend forecasting by department and category' },
      { name: 'IT Vendor Management', enabled: false, description: 'Technology vendor performance and contract management' },
      { name: 'Outsourcing Governance', enabled: false, description: 'BPO and outsourcing service level compliance monitoring and cost tracking' },
      { name: 'Cost Optimization', enabled: false, description: 'Operational cost benchmarking and reduction opportunity identification' },
      { name: 'RFP Management', enabled: false, description: 'Request for proposal lifecycle automation' },
      { name: 'Ingredient Sourcing', enabled: false, description: 'Raw material supplier qualification and price benchmarking' },
      { name: 'Co-Packer Management', enabled: false, description: 'Third-party manufacturer performance tracking and quality compliance' },
      { name: 'Packaging Procurement', enabled: false, description: 'Packaging material sourcing and minimum order quantity optimization' },
    ],
  },
  {
    name: 'Supply Chain Catalyst',
    domain: 'supply-chain',
    description: 'Inventory management, logistics, demand forecasting, and supplier coordination',
    autonomy_tier: 'assisted',
    tags: [
      'function:supply-chain',
      'vertical:general', 'vertical:mining', 'vertical:agriculture',
      'vertical:technology-saas', 'vertical:manufacturing', 'vertical:fmcg',
      'criticality:operational',
      'maturity:starter',
      // Legacy aliases
      'general', 'mining', 'agriculture', 'technology', 'manufacturing', 'fmcg',
    ],
    sub_catalysts: [
      { name: 'Inventory Management', enabled: true, description: 'Stock level monitoring and reorder optimization' },
      { name: 'Inventory Optimization', enabled: true, description: 'Safety stock calculation and reorder point optimization' },
      { name: 'Demand Forecasting', enabled: true, description: 'Statistical demand prediction and planning' },
      { name: 'Demand Planning', enabled: true, description: 'Statistical and promotional demand forecasting' },
      { name: 'Logistics Tracking', enabled: true, description: 'Shipment tracking and delivery management' },
      { name: 'Logistics Management', enabled: false, description: 'Inbound and outbound freight management and cost optimization' },
      { name: 'Warehouse Operations', enabled: true, description: 'Warehouse efficiency and pick/pack optimization' },
      { name: 'Warehouse Optimization', enabled: false, description: 'Layout optimization and material flow' },
      { name: 'Warehouse Management', enabled: false, description: 'DC inventory optimization and order fulfillment' },
      { name: 'MRP Planning', enabled: false, description: 'Material requirements planning based on production schedule' },
      { name: 'Supplier Coordination', enabled: true, description: 'Supplier delivery scheduling and performance tracking' },
      { name: 'Supplier Lead Time Tracking', enabled: false, description: 'Monitor and predict supplier delivery performance' },
      { name: 'Production Scheduling', enabled: false, description: 'Factory production plan optimization' },
      { name: 'S&OP Coordination', enabled: false, description: 'Sales and operations planning process automation' },
      { name: 'Transportation', enabled: false, description: 'Route optimization and carrier management' },
      { name: 'Ore Inventory Management', enabled: false, description: 'Real-time iron ore, coke, and flux inventory tracking' },
      { name: 'Inbound Logistics', enabled: false, description: 'Rail and truck scheduling for raw material delivery' },
      { name: 'Harvest Planning', enabled: false, description: 'Seasonal yield forecasting and resource allocation' },
      { name: 'Cold Chain Monitor', enabled: false, description: 'Temperature and humidity tracking in transit' },
      { name: 'Distributor Coordination', enabled: false, description: 'Automated order fulfillment and delivery scheduling' },
      { name: 'Traceability', enabled: false, description: 'End-to-end traceability for certification and recalls' },
      { name: 'Packaging Optimization', enabled: false, description: 'Optimal pack size and material selection based on buyer requirements' },
      { name: 'Hardware Lifecycle', enabled: false, description: 'Employee device tracking, refresh cycles, and disposal management' },
      { name: 'License Compliance', enabled: false, description: 'Software audit readiness and entitlement tracking' },
      { name: 'Resource Planning', enabled: false, description: 'Professional services resource allocation and utilization optimization' },
    ],
  },
  // Renamed from "Operations Catalyst" — differentiates this cross-industry
  // cluster from the manufacturing/ops variants.
  {
    name: 'General Operations Excellence Catalyst',
    domain: 'supply-chain',
    description: 'Straight-through processing, service level compliance, and operational efficiency',
    autonomy_tier: 'assisted',
    tags: [
      'function:operations',
      'vertical:financial-services', 'vertical:general',
      'criticality:operational',
      'maturity:starter',
      // Legacy aliases
      'financial_services', 'general',
    ],
    sub_catalysts: [
      // Renamed from "Process Automation"
      { name: 'Straight-Through Processing', enabled: true, description: 'Straight-through processing rate monitoring and improvement' },
      // Renamed from "SLA Monitoring"
      { name: 'Service Level Compliance', enabled: true, description: 'Service level agreement tracking and breach alerting' },
      // Renamed from "Capacity Planning"
      { name: 'Resource Demand Planning', enabled: false, description: 'Transaction volume forecasting and resource planning' },
      { name: 'Quality Assurance', enabled: true, description: 'Transaction accuracy monitoring and error rate tracking' },
    ],
  },
  {
    name: 'HR & Workforce Catalyst',
    domain: 'hr',
    description: 'Employee management, scheduling, and compliance',
    autonomy_tier: 'read-only',
    tags: [
      'function:hr',
      'vertical:general',
      'criticality:operational',
      'maturity:starter',
      // Legacy aliases
      'general',
    ],
    sub_catalysts: [
      { name: 'Leave Management', enabled: true, description: 'Leave request processing and balance tracking' },
      { name: 'Scheduling', enabled: true, description: 'Employee shift scheduling and availability management' },
      { name: 'Compliance Training', enabled: true, description: 'Mandatory training completion tracking' },
      { name: 'Performance Reviews', enabled: false, description: 'Review cycle management and goal tracking' },
    ],
  },
  {
    name: 'Workforce Management Catalyst',
    domain: 'hr',
    description: 'Shift scheduling, skills tracking, and safety compliance across operational workforces',
    autonomy_tier: 'read-only',
    tags: [
      'function:hr',
      'vertical:mining', 'vertical:manufacturing', 'vertical:retail',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'mining', 'manufacturing', 'retail',
    ],
    sub_catalysts: [
      { name: 'Shift Scheduling', enabled: true, description: 'Automated roster generation considering skills, fatigue, and leave' },
      // Renamed from "Smart Scheduling"
      { name: 'AI-Driven Scheduling', enabled: false, description: 'Traffic/demand-driven staff scheduling with skills and availability matching' },
      { name: 'Skills Matrix', enabled: true, description: 'Competency tracking and gap analysis' },
      { name: 'Training Compliance', enabled: true, description: 'Safety and product certification tracking and renewal reminders' },
      { name: 'Safety Compliance', enabled: true, description: 'PPE compliance, safety induction, and incident tracking' },
      { name: 'Overtime Management', enabled: false, description: 'Overtime pattern analysis, cost tracking, and authorization workflow' },
      { name: 'Succession Planning', enabled: false, description: 'Critical role identification and talent pipeline management' },
      { name: 'Labor Cost Control', enabled: false, description: 'Labor-to-sales ratio monitoring and overtime management' },
      { name: 'Attrition Prediction', enabled: false, description: 'Employee flight risk scoring and retention intervention triggers' },
      { name: 'Onboarding Automation', enabled: false, description: 'New hire onboarding workflow automation and checklist management' },
    ],
  },
  {
    name: 'Workforce Catalyst',
    domain: 'hr',
    description: 'Branch/field workforce staffing, training compliance, and performance management',
    autonomy_tier: 'read-only',
    tags: [
      'function:hr',
      'vertical:financial-services', 'vertical:fmcg',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'financial_services', 'fmcg',
    ],
    sub_catalysts: [
      { name: 'Branch Staffing', enabled: true, description: 'Optimal branch headcount planning based on transaction volumes' },
      { name: 'Sales Force Effectiveness', enabled: true, description: 'Sales rep productivity and territory coverage analysis' },
      { name: 'Merchandiser Scheduling', enabled: false, description: 'Store visit scheduling and route optimization for merchandisers' },
      { name: 'Compliance Training', enabled: true, description: 'Regulatory training completion tracking and certification management' },
      { name: 'Training Management', enabled: false, description: 'Product knowledge and selling skills training completion tracking' },
      { name: 'Performance Management', enabled: true, description: 'KPI-based performance tracking and incentive calculation' },
      { name: 'Talent Pipeline', enabled: false, description: 'Succession planning and high-potential identification' },
      { name: 'Incentive Calculation', enabled: false, description: 'Commission and bonus calculation automation' },
    ],
  },
  {
    name: 'Sales Catalyst',
    domain: 'sales',
    description: 'Customer management, pipeline tracking, and order processing',
    autonomy_tier: 'assisted',
    tags: [
      'function:sales',
      'vertical:general',
      'criticality:revenue-impacting',
      'maturity:starter',
      // Legacy aliases
      'general',
    ],
    sub_catalysts: [
      { name: 'Pipeline Management', enabled: true, description: 'Sales pipeline tracking and forecasting' },
      { name: 'Order Processing', enabled: true, description: 'Customer order intake and fulfillment tracking' },
      { name: 'Customer Scoring', enabled: false, description: 'Customer value scoring and segmentation' },
      { name: 'Quote Management', enabled: true, description: 'Quotation generation and follow-up automation' },
    ],
  },
  {
    name: 'Sales & Distribution Catalyst',
    domain: 'sales',
    description: 'Customer order management, pricing optimization, and delivery scheduling',
    autonomy_tier: 'assisted',
    tags: [
      'function:sales',
      'vertical:mining', 'vertical:agriculture', 'vertical:manufacturing',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'mining', 'agriculture', 'manufacturing',
    ],
    sub_catalysts: [
      { name: 'Order Management', enabled: true, description: 'Automated order intake, confirmation, and prioritization' },
      { name: 'Dynamic Pricing', enabled: false, description: 'Market-based pricing recommendation' },
      { name: 'Pricing Engine', enabled: false, description: 'Volume-based and customer-specific pricing management' },
      { name: 'Delivery Scheduling', enabled: true, description: 'Optimized dispatch planning linked to production schedule' },
      { name: 'Delivery Coordination', enabled: false, description: 'Dispatch planning and proof of delivery tracking' },
      { name: 'Customer Credit Scoring', enabled: false, description: 'Real-time credit limit monitoring and risk assessment' },
      { name: 'Route-to-Market', enabled: false, description: 'Optimal delivery route and schedule planning' },
      { name: 'Retailer Scorecarding', enabled: false, description: 'Buyer performance tracking and relationship health scoring' },
      { name: 'Seasonal Promotions', enabled: false, description: 'Availability-linked promotional campaign coordination' },
      { name: 'Customer Portal', enabled: false, description: 'Self-service order tracking and invoice access' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // Mining & steel manufacturing
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'Equipment Health Catalyst',
    domain: 'mining-equipment',
    description: 'Predictive maintenance for blast furnaces, rolling mills, and cranes',
    autonomy_tier: 'assisted',
    tags: [
      'function:operations',
      'vertical:mining',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'mining',
    ],
    sub_catalysts: [
      { name: 'Predictive Maintenance', enabled: true, description: 'ML-based failure prediction for heavy equipment' },
      { name: 'Vibration Analysis', enabled: true, description: 'Real-time vibration monitoring on rotating equipment' },
      { name: 'Thermal Imaging', enabled: false, description: 'IR camera analysis for refractory and electrical systems' },
      { name: 'Lubrication Scheduling', enabled: true, description: 'Automated lubrication intervals based on operating hours and conditions' },
      { name: 'Spare Parts Forecasting', enabled: false, description: 'Demand prediction for critical spares to minimize downtime' },
    ],
  },
  {
    name: 'Safety Compliance Catalyst',
    domain: 'mining-safety',
    description: 'Real-time safety monitoring, incident prediction, and compliance tracking',
    autonomy_tier: 'read-only',
    tags: [
      'function:compliance',
      'vertical:mining',
      'criticality:compliance-critical',
      'maturity:core',
      // Legacy aliases
      'mining',
    ],
    sub_catalysts: [
      { name: 'Incident Prediction', enabled: true, description: 'Near-miss and incident trend analysis' },
      { name: 'PPE Compliance', enabled: true, description: 'Computer vision PPE detection at entry points' },
      { name: 'Environmental Monitoring', enabled: true, description: 'Gas, dust, and noise level tracking' },
      { name: 'Fatigue Management', enabled: true, description: 'Shift pattern analysis and fatigue risk scoring' },
      { name: 'Emergency Response', enabled: false, description: 'Automated emergency protocol triggering and coordination' },
    ],
  },
  {
    name: 'Ore Processing Catalyst',
    domain: 'mining-ore',
    description: 'Smelting optimization, ore grade tracking, and yield maximization',
    autonomy_tier: 'assisted',
    tags: [
      'function:operations',
      'vertical:mining',
      'criticality:operational',
      'maturity:advanced',
      // Legacy aliases
      'mining',
    ],
    sub_catalysts: [
      { name: 'Grade Control', enabled: true, description: 'Real-time ore grade monitoring and blending optimization' },
      { name: 'Smelting Optimization', enabled: true, description: 'Blast furnace parameter tuning for yield maximization' },
      { name: 'Quality Prediction', enabled: true, description: 'ML-based steel quality prediction from input parameters' },
      { name: 'Energy Optimization', enabled: false, description: 'Minimize energy consumption per ton of steel produced' },
      { name: 'Slag Management', enabled: true, description: 'Slag chemistry optimization and recycling tracking' },
    ],
  },
  {
    name: 'Environmental Compliance Catalyst',
    domain: 'mining-environment',
    description: 'Emissions monitoring, water management, waste tracking',
    autonomy_tier: 'read-only',
    tags: [
      'function:compliance',
      'vertical:mining',
      'criticality:compliance-critical',
      'maturity:core',
      // Legacy aliases
      'mining',
    ],
    sub_catalysts: [
      { name: 'Emissions Monitoring', enabled: true, description: 'CO2, SO2, and particulate matter continuous monitoring' },
      { name: 'Water Management', enabled: true, description: 'Cooling water quality, recycling rates, and discharge compliance' },
      { name: 'Waste Tracking', enabled: true, description: 'Hazardous and non-hazardous waste classification and disposal tracking' },
      { name: 'Regulatory Reporting', enabled: false, description: 'Automated DMRE and DWS regulatory report generation' },
      { name: 'Carbon Credit Tracking', enabled: false, description: 'Carbon offset calculation and trading opportunity identification' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // Agriculture
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'Crop Intelligence Catalyst',
    domain: 'agri-crop',
    description: 'Soil analysis, crop health monitoring, pest prediction, and yield optimization',
    autonomy_tier: 'assisted',
    tags: [
      'function:operations',
      'vertical:agriculture',
      'criticality:operational',
      'maturity:advanced',
      // Legacy aliases
      'agriculture',
    ],
    sub_catalysts: [
      { name: 'Soil Health Monitoring', enabled: true, description: 'Real-time soil moisture, pH, and nutrient level tracking' },
      { name: 'Pest & Disease Prediction', enabled: true, description: 'ML-based pest outbreak prediction using weather and historical data' },
      { name: 'Crop Rotation Planning', enabled: true, description: 'Optimal rotation schedules for soil health and yield maximization' },
      { name: 'Satellite Imagery Analysis', enabled: false, description: 'NDVI and multispectral analysis for crop health assessment' },
      { name: 'Weather Impact Modeling', enabled: true, description: 'Micro-climate forecasting and frost/hail risk assessment' },
    ],
  },
  {
    name: 'Irrigation Management Catalyst',
    domain: 'agri-irrigation',
    description: 'Smart irrigation scheduling, water usage optimization, and borehole management',
    autonomy_tier: 'assisted',
    tags: [
      'function:operations',
      'vertical:agriculture',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'agriculture',
    ],
    sub_catalysts: [
      // Renamed from "Smart Scheduling"
      { name: 'AI-Driven Scheduling', enabled: true, description: 'Soil moisture-driven irrigation scheduling' },
      { name: 'Water Budget Management', enabled: true, description: 'Farm-level water allocation and usage tracking' },
      { name: 'Borehole Monitoring', enabled: true, description: 'Groundwater level tracking and pump efficiency monitoring' },
      { name: 'Drip System Health', enabled: false, description: 'Leak detection and pressure monitoring on drip irrigation lines' },
      { name: 'Rainwater Harvesting', enabled: false, description: 'Rainwater capture optimization and storage management' },
    ],
  },
  {
    name: 'Quality Assurance Catalyst',
    domain: 'agri-quality',
    description: 'Organic certification compliance, produce grading, and quality testing',
    autonomy_tier: 'read-only',
    tags: [
      'function:compliance',
      'vertical:agriculture',
      'criticality:compliance-critical',
      'maturity:core',
      // Legacy aliases
      'agriculture',
    ],
    sub_catalysts: [
      { name: 'Organic Certification', enabled: true, description: 'SAOSO certification requirement tracking and documentation' },
      { name: 'Produce Grading', enabled: true, description: 'Automated visual grading and size classification' },
      { name: 'Pesticide Residue Testing', enabled: true, description: 'Lab test scheduling and result tracking for compliance' },
      { name: 'Shelf Life Prediction', enabled: false, description: 'ML model predicting shelf life based on harvest conditions' },
      { name: 'GAP Compliance', enabled: true, description: 'Good Agricultural Practices audit checklist automation' },
    ],
  },
  {
    name: 'Market Intelligence Catalyst',
    domain: 'agri-market',
    description: 'Fresh produce pricing, buyer demand signals, and market access',
    autonomy_tier: 'read-only',
    tags: [
      'function:sales',
      'vertical:agriculture',
      'criticality:revenue-impacting',
      'maturity:advanced',
      // Legacy aliases
      'agriculture',
    ],
    sub_catalysts: [
      { name: 'Price Monitoring', enabled: true, description: 'Daily fresh produce market price tracking across major markets' },
      { name: 'Demand Forecasting', enabled: true, description: 'Retailer order pattern analysis and demand prediction' },
      { name: 'Export Opportunity', enabled: false, description: 'International market access and phytosanitary compliance' },
      { name: 'Competitor Benchmarking', enabled: false, description: 'Regional yield and pricing benchmarking' },
    ],
  },
  {
    name: 'Farm Workforce Catalyst',
    domain: 'hr',
    description: 'Seasonal labor planning, worker safety, and skills tracking',
    autonomy_tier: 'read-only',
    tags: [
      'function:hr',
      'vertical:agriculture',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'agriculture',
    ],
    sub_catalysts: [
      { name: 'Seasonal Labor Planning', enabled: true, description: 'Harvest labor demand forecasting and recruitment scheduling' },
      { name: 'Worker Safety', enabled: true, description: 'Heat stress monitoring and chemical handling compliance' },
      { name: 'Skills & Certification', enabled: true, description: 'Pesticide applicator licenses and equipment operator certifications' },
      { name: 'Payroll Integration', enabled: false, description: 'Piece-rate and hourly payroll calculation automation' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // Healthcare
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'Patient Flow Catalyst',
    domain: 'health-patient',
    description: 'Patient scheduling, ward allocation, discharge planning, readmission prediction',
    autonomy_tier: 'assisted',
    tags: [
      'function:operations',
      'vertical:healthcare',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'healthcare',
    ],
    sub_catalysts: [
      { name: 'Scheduling', enabled: true, description: 'Automated patient appointment scheduling' },
      { name: 'Ward Allocation', enabled: true, description: 'Real-time bed management and allocation' },
      { name: 'Discharge Planning', enabled: true, description: 'Coordinated discharge with follow-up scheduling' },
      { name: 'Readmission Prediction', enabled: false, description: 'ML model predicting 30-day readmission risk' },
      { name: 'Triage Prioritization', enabled: true, description: 'AI-assisted triage scoring and queue optimization' },
      { name: 'Theatre Scheduling', enabled: false, description: 'Operating theatre slot optimization and conflict resolution' },
    ],
  },
  {
    name: 'Healthcare Compliance Catalyst',
    domain: 'health-compliance',
    description: 'NDoH reporting, POPIA compliance, clinical audit preparation',
    autonomy_tier: 'read-only',
    tags: [
      'function:compliance',
      'vertical:healthcare',
      'criticality:compliance-critical',
      'maturity:core',
      // Legacy aliases
      'healthcare',
    ],
    sub_catalysts: [
      { name: 'NDoH Reporting', enabled: true, description: 'Automated National Department of Health submissions' },
      { name: 'POPIA Compliance', enabled: true, description: 'Patient data privacy compliance checks' },
      { name: 'Clinical Audit', enabled: false, description: 'Automated clinical audit trail preparation' },
      { name: 'Infection Control', enabled: true, description: 'HAI tracking and prevention protocol compliance' },
      { name: 'HPCSA Compliance', enabled: true, description: 'Health Professions Council registration and CPD tracking' },
    ],
  },
  {
    name: 'Healthcare Finance Catalyst',
    domain: 'finance',
    description: 'Medical aid billing, claims management, revenue cycle optimization',
    autonomy_tier: 'assisted',
    tags: [
      'function:finance',
      'vertical:healthcare',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'healthcare', 'finance',
    ],
    sub_catalysts: [
      { name: 'Medical Aid Billing', enabled: true, description: 'Automated medical aid claim submission' },
      { name: 'Claims Management', enabled: true, description: 'Claim tracking, follow-up, and rejection handling' },
      // Renamed from "Invoice Reconciliation"
      { name: '3-Way Matching & Exception Handling', enabled: true, description: 'Statement versus claim reconciliation with exception handling' },
      { name: 'Revenue Cycle', enabled: false, description: 'End-to-end revenue cycle optimization' },
      { name: 'Tariff Code Optimization', enabled: true, description: 'ICD-10 and NAPPI code accuracy checking and optimization' },
    ],
  },
  {
    name: 'Clinical Staffing Catalyst',
    domain: 'health-staffing',
    description: 'Nurse scheduling, locum management, skills-mix optimization',
    autonomy_tier: 'assisted',
    tags: [
      'function:hr',
      'vertical:healthcare',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'healthcare',
    ],
    sub_catalysts: [
      { name: 'Nurse Rostering', enabled: true, description: 'Automated shift scheduling considering skills, ward acuity, and leave' },
      { name: 'Locum Management', enabled: true, description: 'Temporary staff sourcing, onboarding, and cost tracking' },
      { name: 'Skills-Mix Optimization', enabled: true, description: 'Ward-level staff composition optimization for patient safety' },
      { name: 'Burnout Detection', enabled: false, description: 'Early warning system for staff burnout using work pattern analysis' },
      { name: 'Agency Cost Control', enabled: true, description: 'Locum agency spend tracking and rate benchmarking' },
    ],
  },
  {
    name: 'Medical Supply Chain Catalyst',
    domain: 'health-supply',
    description: 'Pharmaceutical inventory, medical device tracking, supply chain resilience',
    autonomy_tier: 'assisted',
    tags: [
      'function:supply-chain',
      'vertical:healthcare',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'healthcare',
    ],
    sub_catalysts: [
      { name: 'Pharmaceutical Inventory', enabled: true, description: 'Drug stock level monitoring and expiry date management' },
      { name: 'Formulary Management', enabled: true, description: 'Preferred drug list compliance and generic substitution tracking' },
      { name: 'Medical Device Tracking', enabled: true, description: 'Equipment maintenance schedules and calibration tracking' },
      { name: 'Supplier Diversity', enabled: false, description: 'Multi-source procurement for supply chain resilience' },
      { name: 'Cold Chain Compliance', enabled: true, description: 'Temperature-sensitive medication storage and transport monitoring' },
    ],
  },
  {
    name: 'Patient Experience Catalyst',
    domain: 'health-experience',
    description: 'Patient satisfaction tracking, feedback analysis, service recovery',
    autonomy_tier: 'read-only',
    tags: [
      'function:customer',
      'vertical:healthcare',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'healthcare',
    ],
    sub_catalysts: [
      { name: 'Satisfaction Surveys', enabled: true, description: 'Automated post-visit survey distribution and scoring' },
      { name: 'Complaint Management', enabled: true, description: 'Patient complaint logging, routing, and resolution tracking' },
      { name: 'Service Recovery', enabled: false, description: 'Automated escalation and resolution for negative experiences' },
      { name: 'Wait Time Communication', enabled: true, description: 'Real-time patient wait time updates via SMS' },
      { name: 'Net Promoter Tracking', enabled: true, description: 'NPS trend analysis and detractor follow-up automation' },
    ],
  },
  {
    name: 'Healthcare HR Catalyst',
    domain: 'hr',
    description: 'Medical professional recruitment, credentialing, and CPD',
    autonomy_tier: 'read-only',
    tags: [
      'function:hr',
      'vertical:healthcare',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'healthcare',
    ],
    sub_catalysts: [
      { name: 'Recruitment Pipeline', enabled: true, description: 'Medical professional vacancy tracking and sourcing' },
      { name: 'Credentialing', enabled: true, description: 'License verification and practice number validation' },
      { name: 'CPD Management', enabled: true, description: 'Continuing professional development hour tracking' },
      { name: 'Performance Reviews', enabled: false, description: '360-degree feedback and competency assessment automation' },
      { name: 'Onboarding Workflow', enabled: true, description: 'New hire orientation, IT access, and compliance training checklist' },
    ],
  },
  {
    name: 'Healthcare Procurement Catalyst',
    domain: 'procurement',
    description: 'Medical supply procurement, tender management, and vendor evaluation',
    autonomy_tier: 'assisted',
    tags: [
      'function:procurement',
      'vertical:healthcare',
      'criticality:cost-impacting',
      'maturity:core',
      // Legacy aliases
      'healthcare',
    ],
    sub_catalysts: [
      { name: 'Tender Management', enabled: true, description: 'Medical supply tender creation, evaluation, and awarding' },
      { name: 'Vendor Evaluation', enabled: true, description: 'Supplier quality, delivery, and pricing scorecarding' },
      { name: 'Contract Compliance', enabled: true, description: 'Supplier contract service level compliance monitoring and penalty tracking' },
      { name: 'Group Purchasing', enabled: false, description: 'Multi-clinic bulk purchasing coordination for volume discounts' },
    ],
  },
  {
    name: 'Healthcare Sales & Revenue Catalyst',
    domain: 'sales',
    description: 'Patient acquisition, referral management, and service line growth',
    autonomy_tier: 'assisted',
    tags: [
      'function:sales',
      'vertical:healthcare',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'healthcare',
    ],
    sub_catalysts: [
      { name: 'Referral Management', enabled: true, description: 'GP and specialist referral tracking and relationship management' },
      { name: 'Service Line Analytics', enabled: true, description: 'Revenue and volume analysis per clinical service line' },
      { name: 'Patient Acquisition', enabled: true, description: 'New patient source tracking and marketing ROI measurement' },
      { name: 'Corporate Health Contracts', enabled: false, description: 'Employer health program sales pipeline and contract management' },
      { name: 'Medical Aid Negotiations', enabled: true, description: 'Tariff negotiation tracking and medical aid relationship management' },
    ],
  },
  {
    name: 'Healthcare Supply Chain Catalyst',
    domain: 'supply-chain',
    description: 'End-to-end medical supply chain from order to bedside delivery',
    autonomy_tier: 'assisted',
    tags: [
      'function:supply-chain',
      'vertical:healthcare',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'healthcare',
    ],
    sub_catalysts: [
      { name: 'Demand Planning', enabled: true, description: 'Patient volume-driven medical supply demand forecasting' },
      { name: 'Inventory Optimization', enabled: true, description: 'Par level management and automated replenishment for wards' },
      { name: 'Distribution Management', enabled: true, description: 'Multi-facility supply distribution and inter-facility transfers' },
      { name: 'Expiry Management', enabled: true, description: 'FEFO tracking and near-expiry product redistribution' },
      { name: 'Emergency Stock', enabled: false, description: 'Critical supply buffer management and emergency sourcing protocols' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // Logistics & transport
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'Route Optimization Catalyst',
    domain: 'supply-chain',
    description: 'Real-time route planning, fuel optimization, fleet scheduling',
    autonomy_tier: 'assisted',
    tags: [
      'function:supply-chain',
      'vertical:logistics',
      'criticality:cost-impacting',
      'maturity:core',
      // Legacy aliases
      'logistics',
    ],
    sub_catalysts: [
      { name: 'Route Planning', enabled: true, description: 'Dynamic route optimization with traffic and weather' },
      { name: 'Fuel Optimization', enabled: true, description: 'Fuel consumption tracking and efficiency coaching' },
      { name: 'Fleet Scheduling', enabled: true, description: 'Vehicle and driver assignment optimization' },
      { name: 'Load Optimization', enabled: false, description: 'Weight distribution and capacity planning' },
      { name: 'Cross-Docking', enabled: true, description: 'Hub transfer optimization to minimize handling time' },
    ],
  },
  {
    name: 'Transport Finance Catalyst',
    domain: 'finance',
    description: 'Fuel cost tracking, trip costing, customer billing automation',
    autonomy_tier: 'assisted',
    tags: [
      'function:finance',
      'vertical:logistics',
      'criticality:cost-impacting',
      'maturity:core',
      // Legacy aliases
      'logistics', 'finance',
    ],
    sub_catalysts: [
      { name: 'Trip Costing', enabled: true, description: 'Automated per-trip cost calculation' },
      { name: 'Customer Billing', enabled: true, description: 'POD-based automated invoice generation' },
      { name: 'Accounts Receivable', enabled: true, description: 'Debtor aging and follow-up automation' },
      { name: 'Fuel Surcharge Calculator', enabled: true, description: 'Automated fuel surcharge adjustment based on diesel price index' },
      { name: 'Fleet Depreciation', enabled: false, description: 'Vehicle depreciation tracking and replacement forecasting' },
    ],
  },
  {
    name: 'Fleet Maintenance Catalyst',
    domain: 'logistics-fleet',
    description: 'Predictive vehicle maintenance, tyre management, and compliance tracking',
    autonomy_tier: 'assisted',
    tags: [
      'function:operations',
      'vertical:logistics',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'logistics',
    ],
    sub_catalysts: [
      { name: 'Predictive Maintenance', enabled: true, description: 'Engine telemetry-based maintenance prediction and scheduling' },
      { name: 'Tyre Management', enabled: true, description: 'Tyre wear tracking, rotation scheduling, and retread optimization' },
      { name: 'COF Compliance', enabled: true, description: 'Certificate of Fitness expiry tracking and renewal management' },
      { name: 'Brake Testing', enabled: true, description: 'Automated brake performance tracking and replacement scheduling' },
      { name: 'Fuel System Health', enabled: false, description: 'Injector and pump performance monitoring for fuel efficiency' },
    ],
  },
  {
    name: 'Driver Management Catalyst',
    domain: 'hr',
    description: 'Driver scheduling, licensing compliance, fatigue management',
    autonomy_tier: 'read-only',
    tags: [
      'function:hr',
      'vertical:logistics',
      'criticality:compliance-critical',
      'maturity:core',
      // Legacy aliases
      'logistics',
    ],
    sub_catalysts: [
      { name: 'Driver Scheduling', enabled: true, description: 'Automated driver rostering considering hours-of-service regulations' },
      { name: 'License Tracking', enabled: true, description: 'Code 14 EC license expiry and renewal management' },
      { name: 'Fatigue Management', enabled: true, description: 'Drive time monitoring and mandatory rest enforcement' },
      { name: 'Performance Scorecarding', enabled: true, description: 'Driver safety, fuel efficiency, and on-time delivery scoring' },
      { name: 'Training & Certification', enabled: false, description: 'Hazmat, defensive driving, and first aid certification tracking' },
    ],
  },
  {
    name: 'Transport Compliance Catalyst',
    domain: 'logistics-compliance',
    description: 'RTMS compliance, cross-border permits, and regulatory reporting',
    autonomy_tier: 'read-only',
    tags: [
      'function:compliance',
      'vertical:logistics',
      'criticality:compliance-critical',
      'maturity:core',
      // Legacy aliases
      'logistics',
    ],
    sub_catalysts: [
      { name: 'RTMS Compliance', enabled: true, description: 'Road Transport Management System accreditation tracking' },
      { name: 'Cross-Border Permits', enabled: true, description: 'SADC cross-border permit management and customs documentation' },
      { name: 'Overload Prevention', enabled: true, description: 'Real-time axle weight monitoring and load compliance' },
      { name: 'Incident Reporting', enabled: true, description: 'Accident and incident regulatory reporting automation' },
      { name: 'Insurance Management', enabled: false, description: 'Fleet insurance policy tracking and claims management' },
    ],
  },
  {
    name: 'Warehouse Operations Catalyst',
    domain: 'logistics-warehouse',
    description: 'Depot operations optimization, inventory management, dock scheduling',
    autonomy_tier: 'assisted',
    tags: [
      'function:operations',
      'vertical:logistics',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'logistics',
    ],
    sub_catalysts: [
      { name: 'Dock Scheduling', enabled: true, description: 'Loading bay allocation and truck queuing optimization' },
      { name: 'Inventory Tracking', enabled: true, description: 'Cross-dock and break-bulk inventory visibility' },
      { name: 'Damage Prevention', enabled: false, description: 'Load securing compliance and damage trend analysis' },
      { name: 'Yard Management', enabled: true, description: 'Trailer parking, staging, and movement tracking' },
    ],
  },
  {
    name: 'Customer Service Catalyst',
    domain: 'sales',
    description: 'Customer service level compliance, delivery visibility, and relationship management',
    autonomy_tier: 'assisted',
    tags: [
      'function:customer',
      'vertical:logistics',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'logistics',
    ],
    sub_catalysts: [
      // Renamed from "SLA Monitoring"
      { name: 'Service Level Compliance', enabled: true, description: 'Real-time delivery service level tracking per customer contract' },
      { name: 'Track & Trace', enabled: true, description: 'Customer-facing shipment visibility and ETA updates' },
      { name: 'Claims Management', enabled: true, description: 'Delivery damage and loss claim processing automation' },
      { name: 'Rate Management', enabled: false, description: 'Customer-specific rate card management and quoting' },
      { name: 'Contract Renewal', enabled: true, description: 'Contract expiry tracking and renewal opportunity alerts' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // Technology / SaaS
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'Revenue Operations Catalyst',
    domain: 'sales',
    description: 'Churn prediction, upsell identification, pipeline health, renewal management',
    autonomy_tier: 'transactional',
    tags: [
      'function:sales',
      'vertical:technology-saas',
      'criticality:revenue-impacting',
      'maturity:advanced',
      // Legacy aliases
      'technology',
    ],
    sub_catalysts: [
      { name: 'Churn Prediction', enabled: true, description: 'ML model predicting customer churn probability' },
      { name: 'Upsell Engine', enabled: true, description: 'Cross-sell and upsell opportunity identification' },
      { name: 'Pipeline Health', enabled: true, description: 'Deal velocity and win-rate tracking' },
      { name: 'Renewal Management', enabled: false, description: 'Automated renewal reminders and processing' },
      { name: 'Win/Loss Analysis', enabled: true, description: 'Post-deal analysis to improve conversion strategies' },
      { name: 'Territory Planning', enabled: false, description: 'Account territory assignment optimization using revenue potential' },
    ],
  },
  {
    name: 'SaaS Finance Catalyst',
    domain: 'finance',
    description: 'Revenue recognition, ARR tracking, cash flow forecasting',
    autonomy_tier: 'assisted',
    tags: [
      'function:finance',
      'vertical:technology-saas',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'technology', 'finance',
    ],
    sub_catalysts: [
      { name: 'Revenue Recognition', enabled: true, description: 'ASC 606 compliant revenue recognition' },
      { name: 'ARR Tracking', enabled: true, description: 'Real-time ARR, MRR, and expansion metrics' },
      // Renamed from "Invoice Reconciliation"
      { name: '3-Way Matching & Exception Handling', enabled: true, description: 'Subscription billing reconciliation with exception handling' },
      { name: 'Cost Optimization', enabled: false, description: 'Cloud and vendor spend optimization' },
      { name: 'Unit Economics', enabled: true, description: 'CAC, LTV, and payback period tracking per cohort' },
    ],
  },
  {
    name: 'Talent Intelligence Catalyst',
    domain: 'hr',
    description: 'Retention prediction, compensation benchmarking, hiring pipeline',
    autonomy_tier: 'read-only',
    tags: [
      'function:hr',
      'vertical:technology-saas',
      'criticality:operational',
      'maturity:advanced',
      // Legacy aliases
      'technology',
    ],
    sub_catalysts: [
      { name: 'Retention Prediction', enabled: true, description: 'Employee flight risk scoring' },
      { name: 'Compensation Benchmarking', enabled: true, description: 'Market rate comparison and equity analysis' },
      { name: 'Hiring Pipeline', enabled: false, description: 'Candidate funnel optimization and sourcing' },
      { name: 'Diversity Analytics', enabled: true, description: 'Workforce diversity metrics and inclusive hiring tracking' },
      { name: 'Engineering Capacity', enabled: true, description: 'Sprint capacity planning and allocation optimization' },
    ],
  },
  {
    name: 'DevOps Intelligence Catalyst',
    domain: 'tech-devops',
    description: 'CI/CD pipeline monitoring, deployment risk scoring, infrastructure cost optimization',
    autonomy_tier: 'transactional',
    tags: [
      'function:it',
      'vertical:technology-saas',
      'criticality:operational',
      'maturity:advanced',
      // Legacy aliases
      'technology',
    ],
    sub_catalysts: [
      { name: 'Pipeline Monitoring', enabled: true, description: 'CI/CD pipeline health, build times, and failure rate tracking' },
      { name: 'Deployment Risk Scoring', enabled: true, description: 'ML-based deployment risk assessment before production releases' },
      { name: 'Infrastructure Cost', enabled: true, description: 'Cloud resource utilization and right-sizing recommendations' },
      { name: 'Incident Response', enabled: true, description: 'Automated incident detection, escalation, and runbook execution' },
      // Renamed from "SLA Monitoring"
      { name: 'Service Level Compliance', enabled: true, description: 'Service uptime, latency, and error rate tracking against SLAs' },
      // Renamed from "Capacity Planning"
      { name: 'Resource Demand Planning', enabled: false, description: 'Predictive scaling based on usage trends and seasonal patterns' },
    ],
  },
  {
    name: 'Security Operations Catalyst',
    domain: 'tech-security',
    description: 'Vulnerability management, access control auditing, compliance monitoring',
    autonomy_tier: 'read-only',
    tags: [
      'function:it',
      'vertical:technology-saas',
      'criticality:compliance-critical',
      'maturity:core',
      // Legacy aliases
      'technology',
    ],
    sub_catalysts: [
      { name: 'Vulnerability Scanning', enabled: true, description: 'Automated dependency and infrastructure vulnerability detection' },
      { name: 'Access Audit', enabled: true, description: 'Permission review, orphaned account detection, and least-privilege enforcement' },
      { name: 'SOC 2 Compliance', enabled: true, description: 'Continuous SOC 2 Type II control monitoring and evidence collection' },
      { name: 'Threat Detection', enabled: false, description: 'Anomalous access pattern detection and threat intelligence correlation' },
      { name: 'Secret Rotation', enabled: true, description: 'API key and credential rotation scheduling and compliance' },
      { name: 'Penetration Testing', enabled: false, description: 'Automated security testing coordination and finding tracking' },
    ],
  },
  {
    name: 'Product Analytics Catalyst',
    domain: 'tech-product',
    description: 'Feature adoption tracking, user journey analysis, A/B testing',
    autonomy_tier: 'assisted',
    tags: [
      'function:it',
      'vertical:technology-saas',
      'criticality:revenue-impacting',
      'maturity:advanced',
      // Legacy aliases
      'technology',
    ],
    sub_catalysts: [
      { name: 'Feature Adoption', enabled: true, description: 'Feature usage tracking and adoption funnel analysis' },
      { name: 'User Journey Mapping', enabled: true, description: 'Session flow analysis and drop-off point identification' },
      { name: 'A/B Test Management', enabled: true, description: 'Experiment lifecycle management and statistical significance tracking' },
      { name: 'Product-Led Growth', enabled: true, description: 'PQL scoring, activation rate, and time-to-value optimization' },
      { name: 'Feedback Loop', enabled: false, description: 'Customer feedback aggregation and feature request prioritization' },
    ],
  },
  {
    name: 'Customer Success Catalyst',
    domain: 'tech-customer-success',
    description: 'Customer health scoring, onboarding automation, support intelligence',
    autonomy_tier: 'assisted',
    tags: [
      'function:customer',
      'vertical:technology-saas',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'technology',
    ],
    sub_catalysts: [
      { name: 'Health Scoring', enabled: true, description: 'Multi-signal customer health score combining usage, support, and payment data' },
      { name: 'Onboarding Automation', enabled: true, description: 'Guided onboarding workflow with milestone tracking and intervention triggers' },
      { name: 'Support Intelligence', enabled: true, description: 'Ticket classification, routing, and resolution time prediction' },
      { name: 'Expansion Detection', enabled: true, description: 'Usage-based expansion opportunity identification and timing' },
      { name: 'QBR Preparation', enabled: false, description: 'Automated quarterly business review deck generation with usage insights' },
      { name: 'Advocacy Program', enabled: false, description: 'NPS-based referral and case study candidate identification' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // Manufacturing
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'Production Line Catalyst',
    domain: 'mfg-production',
    description: 'Production scheduling, throughput optimization, and OEE monitoring',
    autonomy_tier: 'assisted',
    tags: [
      'function:operations',
      'vertical:manufacturing',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'manufacturing',
    ],
    sub_catalysts: [
      { name: 'Production Scheduling', enabled: true, description: 'Automated production order sequencing and machine allocation' },
      { name: 'OEE Monitoring', enabled: true, description: 'Overall Equipment Effectiveness tracking and loss categorization' },
      { name: 'Throughput Optimization', enabled: true, description: 'Bottleneck identification and line balancing recommendations' },
      { name: 'Changeover Reduction', enabled: false, description: 'SMED-based changeover time analysis and optimization' },
      { name: 'Batch Tracking', enabled: true, description: 'Full batch genealogy and material traceability' },
    ],
  },
  {
    name: 'Quality Control Catalyst',
    domain: 'mfg-quality',
    description: 'SPC monitoring, defect prediction, and non-conformance management',
    autonomy_tier: 'read-only',
    tags: [
      'function:compliance',
      'vertical:manufacturing',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'manufacturing',
    ],
    sub_catalysts: [
      { name: 'SPC Monitoring', enabled: true, description: 'Statistical process control charts and out-of-control detection' },
      { name: 'Defect Prediction', enabled: true, description: 'ML model predicting defect probability from process parameters' },
      { name: 'NCR Management', enabled: true, description: 'Non-conformance report workflow automation' },
      { name: 'Incoming Inspection', enabled: false, description: 'Raw material quality verification and supplier feedback' },
      { name: 'Customer Complaint Analysis', enabled: true, description: 'Root cause analysis and corrective action tracking' },
    ],
  },
  {
    name: 'Maintenance Catalyst',
    domain: 'mfg-maintenance',
    description: 'Preventive maintenance scheduling, spare parts management, and CMMS integration',
    autonomy_tier: 'assisted',
    tags: [
      'function:operations',
      'vertical:manufacturing',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'manufacturing',
    ],
    sub_catalysts: [
      { name: 'Preventive Scheduling', enabled: true, description: 'Time and usage-based maintenance schedule generation' },
      { name: 'Predictive Maintenance', enabled: true, description: 'Condition monitoring-based failure prediction' },
      { name: 'Spare Parts Management', enabled: true, description: 'Critical spare inventory optimization and reorder automation' },
      { name: 'Work Order Management', enabled: true, description: 'Maintenance work order lifecycle automation' },
      { name: 'MTBF/MTTR Analytics', enabled: false, description: 'Mean time between failures and repair time trend analysis' },
    ],
  },
  {
    name: 'Energy Management Catalyst',
    domain: 'mfg-energy',
    description: 'Energy consumption monitoring, load management, and sustainability reporting',
    autonomy_tier: 'read-only',
    tags: [
      'function:operations',
      'vertical:manufacturing',
      'criticality:cost-impacting',
      'maturity:core',
      // Legacy aliases
      'manufacturing',
    ],
    sub_catalysts: [
      { name: 'Consumption Monitoring', enabled: true, description: 'Real-time energy usage tracking by machine and production line' },
      { name: 'Load Management', enabled: true, description: 'Peak demand management and load shedding scheduling' },
      { name: 'Cost Allocation', enabled: true, description: 'Energy cost allocation per product and batch' },
      { name: 'Solar Integration', enabled: false, description: 'Renewable energy generation tracking and grid feedback optimization' },
      { name: 'Carbon Reporting', enabled: false, description: 'Scope 1 & 2 emissions calculation and reporting' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // Financial services
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'Risk Management Catalyst',
    domain: 'finance',
    description: 'Credit risk scoring, market risk monitoring, and regulatory capital calculation',
    autonomy_tier: 'read-only',
    tags: [
      'function:finance',
      'vertical:financial-services',
      'criticality:compliance-critical',
      'maturity:starter',
      // Legacy aliases
      'financial_services', 'finance',
    ],
    sub_catalysts: [
      { name: 'Credit Risk Scoring', enabled: true, description: 'ML-based credit scoring and probability of default modeling' },
      { name: 'Market Risk', enabled: true, description: 'VaR calculation and market exposure monitoring' },
      { name: 'Regulatory Capital', enabled: true, description: 'Basel III/IV capital adequacy calculation' },
      { name: 'Stress Testing', enabled: false, description: 'Scenario-based portfolio stress testing automation' },
      { name: 'Concentration Risk', enabled: true, description: 'Portfolio concentration monitoring and limit management' },
    ],
  },
  {
    name: 'Compliance & Regulatory Catalyst',
    domain: 'finance',
    description: 'AML screening, KYC verification, and regulatory reporting automation',
    autonomy_tier: 'read-only',
    tags: [
      'function:compliance',
      'vertical:financial-services', 'vertical:general',
      'criticality:compliance-critical',
      'maturity:starter',
      // Legacy aliases
      'financial_services', 'finance', 'general',
    ],
    sub_catalysts: [
      { name: 'AML Screening', enabled: true, description: 'Automated anti-money laundering transaction screening' },
      { name: 'KYC Verification', enabled: true, description: 'Customer due diligence and identity verification' },
      { name: 'Regulatory Reporting', enabled: true, description: 'Automated SARB and FSB regulatory submissions' },
      { name: 'Sanctions Screening', enabled: true, description: 'Real-time sanctions list screening and alert management' },
      { name: 'FICA Compliance', enabled: false, description: 'Financial Intelligence Centre Act compliance monitoring' },
    ],
  },
  // Renamed from "Customer Intelligence Catalyst" — and absorbed the
  // unique sub-catalysts from the retired "Customer Experience Catalyst"
  // (Loyalty Analytics, Personalized Promotions, NPS & Sentiment,
  // Omnichannel Tracking). The two clusters overlapped on Customer
  // Segmentation per the post-PR catalog review, so they are merged here.
  {
    name: 'Customer Intelligence & Retention Catalyst',
    domain: 'sales',
    description: 'Customer segmentation, product recommendation, retention management, loyalty analytics, and omnichannel engagement',
    autonomy_tier: 'assisted',
    tags: [
      'function:customer',
      'vertical:financial-services', 'vertical:retail', 'vertical:general',
      'criticality:revenue-impacting',
      'maturity:starter',
      // Legacy aliases
      'financial_services', 'retail', 'general',
    ],
    sub_catalysts: [
      { name: 'Customer Segmentation', enabled: true, description: 'Behavioral, RFM, and value-based customer segmentation with lifecycle stage tracking' },
      { name: 'Product Recommendation', enabled: true, description: 'Next-best-product recommendation engine' },
      { name: 'Retention Management', enabled: true, description: 'Early warning churn detection and retention actions' },
      { name: 'Lifetime Value', enabled: false, description: 'Customer lifetime value prediction and optimization' },
      { name: 'Cross-Sell Analytics', enabled: true, description: 'Product affinity analysis and cross-sell opportunity scoring' },
      // Merged from Customer Experience Catalyst
      { name: 'Loyalty Analytics', enabled: true, description: 'Loyalty program performance, redemption patterns, and churn prediction' },
      { name: 'Personalized Promotions', enabled: true, description: 'AI-driven personalized offer generation based on purchase history' },
      { name: 'NPS & Sentiment', enabled: false, description: 'Customer sentiment analysis from reviews, surveys, and social media' },
      { name: 'Omnichannel Tracking', enabled: true, description: 'Unified customer journey tracking across online, in-store, and mobile' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // FMCG
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'Trade Promotion Catalyst',
    domain: 'fmcg-trade',
    description: 'Trade spend optimization, promotion ROI tracking, and retail execution',
    autonomy_tier: 'assisted',
    tags: [
      'function:sales',
      'vertical:fmcg',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'fmcg',
    ],
    sub_catalysts: [
      { name: 'Promotion Planning', enabled: true, description: 'Trade promotion calendar management and budget allocation' },
      { name: 'ROI Analysis', enabled: true, description: 'Post-promotion effectiveness and lift measurement' },
      { name: 'Retail Execution', enabled: true, description: 'In-store compliance monitoring and planogram adherence' },
      { name: 'Deduction Management', enabled: false, description: 'Retailer deduction dispute and recovery automation' },
      { name: 'Price Waterfall', enabled: true, description: 'Full price waterfall analysis from list to pocket price' },
    ],
  },
  {
    name: 'Distributor Management Catalyst',
    domain: 'fmcg-distributor',
    description: 'Distributor performance tracking, inventory visibility, and route-to-market',
    autonomy_tier: 'assisted',
    tags: [
      'function:supply-chain',
      'vertical:fmcg',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'fmcg',
    ],
    sub_catalysts: [
      { name: 'Distributor Scorecarding', enabled: true, description: 'Multi-dimensional distributor performance rating' },
      { name: 'Inventory Visibility', enabled: true, description: 'Real-time distributor stock levels and days-of-stock tracking' },
      { name: 'Route-to-Market', enabled: true, description: 'Distribution channel optimization and cost-to-serve analysis' },
      { name: 'Secondary Sales Tracking', enabled: false, description: 'Distributor-to-retailer sales data capture and analytics' },
    ],
  },
  {
    name: 'Product Launch Catalyst',
    domain: 'fmcg-launch',
    description: 'New product introduction, market testing, and launch tracking',
    autonomy_tier: 'read-only',
    tags: [
      'function:operations',
      'vertical:fmcg',
      'criticality:revenue-impacting',
      'maturity:advanced',
      // Legacy aliases
      'fmcg',
    ],
    sub_catalysts: [
      { name: 'Stage-Gate Tracking', enabled: true, description: 'NPD stage-gate process management and milestone tracking' },
      { name: 'Test Market Analysis', enabled: true, description: 'Regional test market performance monitoring' },
      { name: 'Launch Execution', enabled: true, description: 'Cross-functional launch readiness checklist and coordination' },
      { name: 'Cannibalization Analysis', enabled: false, description: 'Portfolio impact assessment of new product launches' },
    ],
  },
  {
    name: 'Shelf Intelligence Catalyst',
    domain: 'fmcg-shelf',
    description: 'Share of shelf tracking, planogram compliance, and competitive intelligence',
    autonomy_tier: 'read-only',
    tags: [
      'function:sales',
      'vertical:fmcg',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'fmcg',
    ],
    sub_catalysts: [
      { name: 'Share of Shelf', enabled: true, description: 'Shelf space measurement and share tracking by retailer' },
      { name: 'Planogram Compliance', enabled: true, description: 'In-store planogram adherence monitoring using image recognition' },
      { name: 'Competitive Intelligence', enabled: false, description: 'Competitor pricing, promotion, and product launch tracking' },
      { name: 'Out-of-Stock Detection', enabled: true, description: 'Real-time OOS detection and root cause analysis' },
    ],
  },
  {
    name: 'Sales & Key Accounts Catalyst',
    domain: 'sales',
    description: 'Retailer relationship management, key account planning, and order management',
    autonomy_tier: 'assisted',
    tags: [
      'function:sales',
      'vertical:fmcg',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'fmcg',
    ],
    sub_catalysts: [
      { name: 'Key Account Management', enabled: true, description: 'Major retailer relationship tracking and joint business planning' },
      { name: 'Order Management', enabled: true, description: 'Customer order processing, allocation, and delivery coordination' },
      { name: 'Pricing Management', enabled: true, description: 'Price list management, RSP compliance, and margin protection' },
      { name: 'Category Management', enabled: true, description: 'Category captain analytics and retailer category recommendations' },
      { name: 'Tender Response', enabled: false, description: 'Retailer tender and listing application automation' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // Retail
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'Point of Sale Intelligence Catalyst',
    domain: 'retail-pos',
    description: 'POS analytics, basket analysis, transaction monitoring, and shrinkage detection',
    autonomy_tier: 'assisted',
    tags: [
      'function:sales',
      'vertical:retail',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'retail',
    ],
    sub_catalysts: [
      { name: 'Transaction Analytics', enabled: true, description: 'Real-time POS transaction monitoring and trend analysis' },
      { name: 'Basket Analysis', enabled: true, description: 'Market basket analysis for cross-sell and upsell opportunities' },
      { name: 'Shrinkage Detection', enabled: true, description: 'Inventory shrinkage pattern detection and loss prevention alerts' },
      { name: 'Cashier Performance', enabled: false, description: 'Cashier speed, accuracy, and void rate monitoring' },
      { name: 'Peak Hour Forecasting', enabled: true, description: 'Customer traffic prediction for staffing and register allocation' },
    ],
  },
  {
    name: 'Inventory & Merchandise Catalyst',
    domain: 'retail-inventory',
    description: 'Stock optimization, replenishment automation, and merchandise planning',
    autonomy_tier: 'assisted',
    tags: [
      'function:supply-chain',
      'vertical:retail',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'retail',
    ],
    sub_catalysts: [
      { name: 'Automated Replenishment', enabled: true, description: 'ML-driven reorder point calculation and purchase order generation' },
      { name: 'Stock Allocation', enabled: true, description: 'Multi-store stock allocation based on demand patterns and store profiles' },
      { name: 'Dead Stock Detection', enabled: true, description: 'Slow-moving inventory identification and markdown recommendations' },
      { name: 'Seasonal Planning', enabled: true, description: 'Seasonal demand forecasting and pre-season buy planning' },
      { name: 'Planogram Compliance', enabled: false, description: 'In-store planogram adherence monitoring via image recognition' },
    ],
  },
  // NOTE: "Customer Experience Catalyst" (previously a standalone retail
  // cluster) was merged into "Customer Intelligence & Retention Catalyst"
  // above — the two clusters overlapped on Customer Segmentation and the
  // unique sub-catalysts (Loyalty Analytics, Personalized Promotions,
  // NPS & Sentiment, Omnichannel Tracking) now live on the merged cluster.
  {
    name: 'Retail Finance Catalyst',
    domain: 'finance',
    description: 'Daily reconciliation, margin analysis, rent and lease management',
    autonomy_tier: 'transactional',
    tags: [
      'function:finance',
      'vertical:retail',
      'criticality:cost-impacting',
      'maturity:core',
      // Legacy aliases
      'retail', 'finance',
    ],
    sub_catalysts: [
      { name: 'Daily Reconciliation', enabled: true, description: 'POS-to-bank daily cash reconciliation and variance detection' },
      { name: 'Margin Analysis', enabled: true, description: 'Product and category-level margin tracking and erosion alerts' },
      { name: 'Accounts Payable', enabled: true, description: 'Supplier invoice processing and payment scheduling' },
      { name: 'Rent & Lease Management', enabled: true, description: 'Store lease tracking, renewal alerts, and turnover rent calculation' },
      { name: 'Franchise Royalty', enabled: false, description: 'Automated franchise fee calculation and royalty billing' },
    ],
  },
  {
    name: 'Supply Chain & Logistics Catalyst',
    domain: 'retail-supply-chain',
    description: 'Supplier management, distribution center operations, and last-mile delivery',
    autonomy_tier: 'assisted',
    tags: [
      'function:supply-chain',
      'vertical:retail',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'retail',
    ],
    sub_catalysts: [
      { name: 'Supplier Performance', enabled: true, description: 'Supplier fill rate, lead time, and quality scorecarding' },
      { name: 'DC Operations', enabled: true, description: 'Distribution center throughput monitoring and bottleneck detection' },
      { name: 'Demand Forecasting', enabled: true, description: 'Store-level demand prediction using weather, events, and trends' },
      { name: 'Last-Mile Tracking', enabled: false, description: 'Delivery tracking and estimated arrival time optimization' },
      { name: 'Returns Management', enabled: true, description: 'Return rate analysis, reason coding, and refurbishment routing' },
    ],
  },
  {
    name: 'Pricing & Promotions Catalyst',
    domain: 'retail-pricing',
    description: 'Dynamic pricing, promotion effectiveness, and competitor price monitoring',
    autonomy_tier: 'assisted',
    tags: [
      'function:sales',
      'vertical:retail',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'retail',
    ],
    sub_catalysts: [
      { name: 'Dynamic Pricing', enabled: true, description: 'AI-driven price optimization based on demand elasticity and competition' },
      { name: 'Promotion ROI', enabled: true, description: 'Promotion effectiveness measurement and cannibalization analysis' },
      { name: 'Competitor Monitoring', enabled: true, description: 'Competitor price scraping and price index benchmarking' },
      { name: 'Markdown Optimization', enabled: false, description: 'End-of-season and clearance markdown timing and depth optimization' },
      { name: 'Price Compliance', enabled: true, description: 'Shelf price vs system price compliance checking' },
    ],
  },
  {
    name: 'Store Operations Catalyst',
    domain: 'retail-ops',
    description: 'Store performance benchmarking, task management, and compliance',
    autonomy_tier: 'read-only',
    tags: [
      'function:operations',
      'vertical:retail',
      'criticality:operational',
      'maturity:core',
      // Legacy aliases
      'retail',
    ],
    sub_catalysts: [
      { name: 'Store Scorecarding', enabled: true, description: 'Multi-KPI store performance ranking and benchmarking' },
      { name: 'Task Management', enabled: true, description: 'Store task assignment, completion tracking, and escalation' },
      { name: 'Health & Safety', enabled: true, description: 'Store safety compliance, incident tracking, and audit scheduling' },
      { name: 'Energy Management', enabled: false, description: 'Store-level energy consumption monitoring and optimization' },
      { name: 'Customer Traffic', enabled: true, description: 'Footfall counting, conversion rate tracking, and heatmap analysis' },
    ],
  },
  {
    name: 'E-Commerce Intelligence Catalyst',
    domain: 'retail-ecommerce',
    description: 'Online store analytics, conversion optimization, and marketplace integration',
    autonomy_tier: 'assisted',
    tags: [
      'function:sales',
      'vertical:retail',
      'criticality:revenue-impacting',
      'maturity:advanced',
      // Legacy aliases
      'retail',
    ],
    sub_catalysts: [
      { name: 'Conversion Funnel', enabled: true, description: 'Cart abandonment analysis and checkout optimization' },
      { name: 'Product Recommendations', enabled: true, description: 'Collaborative and content-based product recommendation engine' },
      { name: 'Search Analytics', enabled: true, description: 'Site search performance, zero-result tracking, and synonym management' },
      { name: 'Marketplace Sync', enabled: false, description: 'Inventory and pricing sync across Takealot, Amazon, and other marketplaces' },
      { name: 'Fulfillment Optimization', enabled: true, description: 'Ship-from-store vs DC routing optimization for online orders' },
    ],
  },
  {
    name: 'Procurement & Buying Catalyst',
    domain: 'procurement',
    description: 'Merchandise buying, supplier negotiations, and import management',
    autonomy_tier: 'assisted',
    tags: [
      'function:procurement',
      'vertical:retail',
      'criticality:cost-impacting',
      'maturity:core',
      // Legacy aliases
      'retail',
    ],
    sub_catalysts: [
      { name: 'Buying Planning', enabled: true, description: 'Open-to-buy budget management and category buying plans' },
      { name: 'Supplier Negotiations', enabled: true, description: 'Supplier cost negotiation tracking and rebate management' },
      { name: 'Import Management', enabled: true, description: 'International sourcing, shipping, and customs clearance tracking' },
      { name: 'Private Label Sourcing', enabled: false, description: 'Own-brand product development and supplier qualification' },
      { name: 'Vendor Onboarding', enabled: true, description: 'New supplier registration, compliance checks, and setup automation' },
    ],
  },
  {
    name: 'Sales & Revenue Catalyst',
    domain: 'sales',
    description: 'Revenue tracking, channel management, and customer acquisition',
    autonomy_tier: 'assisted',
    tags: [
      'function:sales',
      'vertical:retail',
      'criticality:revenue-impacting',
      'maturity:core',
      // Legacy aliases
      'retail',
    ],
    sub_catalysts: [
      { name: 'Revenue Analytics', enabled: true, description: 'Store, channel, and category revenue tracking and forecasting' },
      { name: 'Channel Management', enabled: true, description: 'Omnichannel revenue attribution and channel mix optimization' },
      { name: 'Franchise Sales', enabled: true, description: 'Franchise recruitment pipeline and new store performance tracking' },
      { name: 'B2B Sales', enabled: false, description: 'Corporate and wholesale customer account management' },
      { name: 'Gift Card & Voucher', enabled: true, description: 'Gift card program management, liability tracking, and redemption analytics' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// CATALOG LOOKUPS
// ═══════════════════════════════════════════════════════════════════════════

/** Lookup a cluster by exact name. */
export function getClusterByName(name: string): CatalystTemplate | undefined {
  return CATALYST_CATALOG.find(c => c.name === name);
}

/**
 * Filter by tag (e.g. 'mining', 'finance', 'function:finance',
 * 'vertical:retail', 'maturity:starter'). Replaces the previous
 * industry filter — a cluster is returned as long as the tag appears
 * anywhere in its `tags` array.
 *
 * For backwards compatibility, calling with an un-prefixed legacy tag
 * (e.g. `'finance'`) matches both the raw alias and the prefixed form
 * across every dimension. Calling with a fully-qualified tag (e.g.
 * `'function:finance'`) matches only that exact tag.
 */
export function getClustersByTag(tag: string): CatalystTemplate[] {
  // Fast path: exact match (covers both prefixed tags and raw aliases
  // stored directly on the cluster).
  const direct = CATALYST_CATALOG.filter(c => c.tags.includes(tag));
  if (direct.length > 0 || tag.includes(':')) return direct;

  // Fallback: treat `tag` as an un-prefixed alias and match any
  // prefixed form ending in `:${tag}`. Keeps callers using the old raw
  // tag names working even if a cluster only stored the prefixed form.
  const suffix = `:${tag}`;
  return CATALYST_CATALOG.filter(c => c.tags.some(t => t.endsWith(suffix)));
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKWARDS-COMPATIBLE INDUSTRY TEMPLATES (DEPRECATED)
// ═══════════════════════════════════════════════════════════════════════════
// Derived from CATALYST_CATALOG by grouping on the first (primary) tag.
// Kept so existing consumers — the `/templates` endpoint, any cached
// frontend industry pickers, tests — continue to function while we roll
// out tag-based discovery.

interface IndustryMeta {
  industry: string;
  label: string;
  description: string;
}

const INDUSTRY_METADATA: IndustryMeta[] = [
  { industry: 'mining',             label: 'Mining & Steel',       description: 'Equipment maintenance, safety compliance, ore processing, and environmental monitoring' },
  { industry: 'agriculture',        label: 'Agriculture',          description: 'Crop intelligence, irrigation, quality assurance, and market access' },
  { industry: 'healthcare',         label: 'Healthcare',           description: 'Patient flow, clinical compliance, medical billing, and staffing' },
  { industry: 'logistics',          label: 'Logistics & Transport', description: 'Route optimization, fleet maintenance, driver management, and compliance' },
  { industry: 'technology',         label: 'Technology & SaaS',    description: 'DevOps, security, product analytics, customer success, and revenue ops' },
  { industry: 'manufacturing',      label: 'Manufacturing',        description: 'Production optimization, quality control, maintenance, and energy management' },
  { industry: 'financial_services', label: 'Financial Services',   description: 'Risk management, regulatory compliance, customer intelligence, and operations' },
  { industry: 'fmcg',               label: 'FMCG',                 description: 'Trade promotion, distributor management, shelf intelligence, and product launch' },
  { industry: 'retail',             label: 'Retail',               description: 'POS intelligence, inventory optimization, customer experience, pricing, and e-commerce' },
  { industry: 'general',            label: 'General',              description: 'Cross-industry baseline catalysts for finance, procurement, supply chain, HR, and sales' },
];

/**
 * @deprecated Use {@link CATALYST_CATALOG} with tag filtering.
 * Derived at module load from the flat catalog. A cluster appears in an
 * industry's bucket if it carries that industry's tag (raw alias or the
 * prefixed `vertical:*` form), preserving the previous vertical menus
 * for the Tenants page.
 */
export const INDUSTRY_TEMPLATES: IndustryTemplate[] = INDUSTRY_METADATA.map(meta => ({
  industry: meta.industry,
  label: meta.label,
  description: meta.description,
  clusters: getClustersByTag(meta.industry),
}));

/**
 * @deprecated Use {@link getClustersByTag} instead.
 */
export function getTemplateForIndustry(industry: string): IndustryTemplate | undefined {
  return INDUSTRY_TEMPLATES.find(t => t.industry === industry);
}

// ═══════════════════════════════════════════════════════════════════════════
// STARTER BUNDLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A curated "starter" bundle deployed to a tenant when neither an
 * `industry` nor a custom `clusters` payload is provided to
 * `/deploy-template`. Pick the ~10 most universally useful clusters —
 * finance, procurement, supply chain, HR, sales plus a few risk/
 * operational ones — so the tenant gets a working baseline without
 * having to know which tags to pick.
 *
 * TODO(PR #19): the starter bundle currently maps two placeholder
 * clusters — "Compliance & Regulatory Catalyst" (currently the
 * financial-services compliance cluster; will be generalised in PR #19)
 * and "Data Quality & Master Data Governance" (which does not yet exist
 * in CATALYST_CATALOG; falls back to the general operations excellence
 * cluster until PR #19 introduces it). Once PR #19 lands, replace those
 * placeholders with the real cross-industry clusters.
 */
export const STARTER_CLUSTER_NAMES: readonly string[] = [
  'Finance Catalyst',
  'Procurement Catalyst',
  'Supply Chain Catalyst',
  'HR & Workforce Catalyst',
  'Sales Catalyst',
  // Renamed from "Operations Catalyst"
  'General Operations Excellence Catalyst',
  // Merged cluster — replaces the old "Customer Intelligence Catalyst"
  // AND "Customer Experience Catalyst" (both were in the original
  // starter bundle and overlapped on Customer Segmentation per review)
  'Customer Intelligence & Retention Catalyst',
  'Risk Management Catalyst',
  // Placeholder — closest existing cluster, pending PR #19
  'Compliance & Regulatory Catalyst',
  // Placeholder — "Data Quality & Master Data Governance" does not yet
  // exist; fall back to General Operations Excellence until PR #19
  'General Operations Excellence Catalyst',
] as const;

/** Resolve the starter bundle from the flat catalog. */
export function getStarterClusters(): CatalystTemplate[] {
  const seen = new Set<string>();
  const resolved: CatalystTemplate[] = [];
  for (const name of STARTER_CLUSTER_NAMES) {
    if (seen.has(name)) continue; // de-dupe placeholder overlaps
    const cluster = getClusterByName(name);
    if (cluster) {
      seen.add(name);
      resolved.push(cluster);
    }
  }
  return resolved;
}
