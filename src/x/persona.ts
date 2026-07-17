// Persona lenses for the Vantax demo tenant: same screen, different emphasis.
// Real tenants get no switcher (activePersona → null) — their role comes from
// auth, not a query param. Personas only re-order and grey; they never hide
// figures or grant rights the API wouldn't enforce.
import type { ChainStage, SectionKey } from './reactor-graph';
export type { ChainStage } from './reactor-graph';

export type PersonaKey = 'board' | 'ceo' | 'cfo' | 'coo' | 'cpo' | 'controller' | 'fm' | 'ap' | 'tax' | 'ops';

export interface Persona {
  key: PersonaKey;
  label: string;
  kicker: string;
  lens: string;
  sections: SectionKey[];
  canApprove: boolean;
  opsFirst?: string[];
  chain?: ChainStage[];
}

// Real tenants: the authenticated role decides whether Approve/Reject render
// enabled. The API is the enforcement point (step-up MFA, 403) — this only
// greys the buttons honestly. Unknown/legacy role → leave enabled, API decides.
const APPROVER_ROLES = new Set(['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'operator']);
export function roleCanApprove(role: string | undefined | null): boolean {
  return role ? APPROVER_ROLES.has(role) : true;
}

const ALL: SectionKey[] = ['brief', 'decisions', 'ledger', 'catalysts'];

// C-suite chains. Bucket names are the canonical assessment categories; the
// graph expands each bucket to its finding-type keys (reactor-graph CAT_KEYS).
const CFO_CHAIN: ChainStage[] = [
  { id: 'spend', label: 'Spend committed', buckets: ['procurement'] },
  { id: 'stock', label: 'Stock & stores', buckets: ['supply_chain'] },
  { id: 'cost', label: 'Cost of operations', buckets: ['service_delivery', 'workforce', 'cross_cutting'] },
  { id: 'revenue', label: 'Revenue & invoicing', buckets: ['sales'] },
  { id: 'cash', label: 'Cash & ledger', buckets: ['finance'] },
  { id: 'tax', label: 'Tax & filings', buckets: ['compliance'] },
];
const COO_CHAIN: ChainStage[] = [
  { id: 'source', label: 'Source & plan', buckets: ['procurement'] },
  { id: 'inbound', label: 'Inbound & stores', buckets: ['supply_chain'] },
  { id: 'production', label: 'Production & delivery', buckets: ['service_delivery', 'cross_cutting'] },
  { id: 'people', label: 'People & shifts', buckets: ['workforce'] },
  { id: 'ship', label: 'Ship & bill', buckets: ['sales'] },
  { id: 'account', label: 'Account & comply', buckets: ['finance', 'compliance'] },
];
// CPO: contracts → purchases → manufacturing → supply chain → sales, macro at
// the head (the macro node is shared; the chain is the internal spine).
const CPO_CHAIN: ChainStage[] = [
  { id: 'contracts', label: 'Contracts & suppliers', buckets: ['procurement'] },
  { id: 'purchases', label: 'Purchases & payments', buckets: ['finance'] },
  { id: 'manufacturing', label: 'Manufacturing', buckets: ['service_delivery', 'workforce', 'cross_cutting'] },
  { id: 'supply', label: 'Supply chain', buckets: ['supply_chain'] },
  { id: 'sales', label: 'Sales & invoicing', buckets: ['sales'] },
  { id: 'compliance', label: 'Compliance', buckets: ['compliance'] },
];
const CONTROLLER_CHAIN: ChainStage[] = [
  { id: 'commitments', label: 'Commitments', buckets: ['procurement'] },
  { id: 'inventory', label: 'Inventory', buckets: ['supply_chain'] },
  { id: 'operations', label: 'Operations', buckets: ['service_delivery', 'workforce', 'cross_cutting'] },
  { id: 'billing', label: 'Billing', buckets: ['sales'] },
  { id: 'ledger', label: 'Ledger & reconciliation', buckets: ['finance'] },
  { id: 'filings', label: 'Filings & controls', buckets: ['compliance'] },
];

export const PERSONAS: Record<PersonaKey, Persona> = {
  board: {
    key: 'board', label: 'Board member', kicker: 'Independent oversight',
    lens: 'Health vs benchmark, recovered to date, and what is stuck at the gate.',
    sections: ['brief', 'ledger'], canApprove: false,
  },
  ceo: {
    key: 'ceo', label: 'Chief Executive', kicker: 'The whole business, one screen',
    lens: 'External pressure, internal health, and what the recovery engine returned.',
    sections: ALL, canApprove: false,
  },
  cfo: {
    key: 'cfo', label: 'Chief Financial Officer', kicker: 'Cash recovered to the P&L',
    lens: 'Confirmed leakage, decisions awaiting sign-off, and the recovery ledger.',
    sections: ALL, canApprove: true, chain: CFO_CHAIN,
  },
  coo: {
    key: 'coo', label: 'Chief Operating Officer', kicker: 'Operations, end to end',
    lens: 'Where operations leak value and which catalysts are running on it.',
    sections: ['brief', 'decisions', 'catalysts'], canApprove: false,
    opsFirst: ['supply_chain', 'service_delivery', 'procurement'],
    chain: COO_CHAIN,
  },
  cpo: {
    key: 'cpo', label: 'Chief Procurement Officer', kicker: 'Recovered from your suppliers',
    lens: 'Supplier-side leakage: procurement and supply-chain findings first.',
    sections: ALL, canApprove: false,
    // CPO remit = suppliers + what you pay them: contracts (procurement),
    // purchases & payments (finance), and supply chain stay lit; the rest greys.
    opsFirst: ['procurement', 'finance', 'supply_chain'],
    chain: CPO_CHAIN,
  },
  controller: {
    key: 'controller', label: 'Financial Controller', kicker: 'Every entry reconciled',
    lens: 'Findings by category, evidence per action, receipts for every recovery.',
    sections: ALL, canApprove: true,
    opsFirst: ['finance', 'compliance'],
    chain: CONTROLLER_CHAIN,
  },
  fm: {
    key: 'fm', label: 'Finance Manager', kicker: 'Decisions on your desk',
    lens: 'The approval queue, with evidence — approve or send back.',
    sections: ['brief', 'decisions', 'catalysts'], canApprove: true,
  },
  ap: {
    key: 'ap', label: 'Accounts Payable', kicker: 'Supplier payments, checked',
    lens: 'Duplicate and mispriced payments caught before and after they leave.',
    sections: ['brief', 'decisions', 'catalysts'], canApprove: false,
    opsFirst: ['finance', 'procurement'],
  },
  tax: {
    key: 'tax', label: 'Tax & Compliance', kicker: 'VAT recovered, deadlines met',
    lens: 'Compliance findings, regulatory deadlines, and VAT recovery runs.',
    sections: ['brief', 'decisions', 'catalysts'], canApprove: false,
    opsFirst: ['compliance', 'finance'],
  },
  ops: {
    key: 'ops', label: 'Operations Manager', kicker: 'Day-to-day running',
    lens: 'Service and supply findings, and the catalysts working through them.',
    sections: ['brief', 'catalysts'], canApprove: false,
    opsFirst: ['service_delivery', 'supply_chain'],
  },
};

export function activePersona(search: string, tenantName: string | null): Persona | null {
  // live tenant is named "Vanta X" — strip spaces before matching
  if (!tenantName?.toLowerCase().replace(/\s+/g, '').includes('vantax')) return null;
  const key = new URLSearchParams(search).get('as') as PersonaKey | null;
  return (key && PERSONAS[key]) || PERSONAS.cfo;
}
