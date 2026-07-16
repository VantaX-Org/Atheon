// Persona lenses for the Vantax demo tenant: same screen, different emphasis.
// Real tenants get no switcher (activePersona → null) — their role comes from
// auth, not a query param. Personas only re-order and grey; they never hide
// figures or grant rights the API wouldn't enforce.
import type { SectionKey } from './reactor-graph';

export type PersonaKey = 'board' | 'ceo' | 'cfo' | 'coo' | 'cpo' | 'controller' | 'fm' | 'ap' | 'tax' | 'ops';

export interface Persona {
  key: PersonaKey;
  label: string;
  kicker: string;
  lens: string;
  sections: SectionKey[];
  canApprove: boolean;
  opsFirst?: string[];
}

// Real tenants: the authenticated role decides whether Approve/Reject render
// enabled. The API is the enforcement point (step-up MFA, 403) — this only
// greys the buttons honestly. Unknown/legacy role → leave enabled, API decides.
const APPROVER_ROLES = new Set(['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'operator']);
export function roleCanApprove(role: string | undefined | null): boolean {
  return role ? APPROVER_ROLES.has(role) : true;
}

const ALL: SectionKey[] = ['brief', 'decisions', 'ledger', 'catalysts'];

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
    sections: ALL, canApprove: true,
  },
  coo: {
    key: 'coo', label: 'Chief Operating Officer', kicker: 'Operations, end to end',
    lens: 'Where operations leak value and which catalysts are running on it.',
    sections: ['brief', 'decisions', 'catalysts'], canApprove: false,
    opsFirst: ['supply_chain', 'service_delivery', 'procurement'],
  },
  cpo: {
    key: 'cpo', label: 'Chief Procurement Officer', kicker: 'Recovered from your suppliers',
    lens: 'Supplier-side leakage: procurement and supply-chain findings first.',
    sections: ALL, canApprove: false,
    opsFirst: ['procurement', 'supply_chain'],
  },
  controller: {
    key: 'controller', label: 'Financial Controller', kicker: 'Every entry reconciled',
    lens: 'Findings by category, evidence per action, receipts for every recovery.',
    sections: ALL, canApprove: true,
    opsFirst: ['finance', 'compliance'],
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
