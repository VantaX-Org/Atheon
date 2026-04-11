// TASK-027: Afrikaans translations (flat key-value format matching en.ts)
export const afMessages: Record<string, string> = {
  // Navigation
  'nav.dashboard': 'Kontroleskerm',
  'nav.catalysts': 'Katalisators',
  'nav.pulse': 'Pols',
  'nav.apex': 'Apex',
  'nav.mind': 'Verstand',
  'nav.memory': 'Geheue',
  'nav.chat': 'Klets',
  'nav.audit': 'Oudit',
  'nav.settings': 'Instellings',
  'nav.integrations': 'Integrasies',

  // Common actions
  'action.save': 'Stoor',
  'action.cancel': 'Kanselleer',
  'action.delete': 'Verwyder',
  'action.edit': 'Wysig',
  'action.search': 'Soek',
  'action.filter': 'Filter',
  'action.export': 'Uitvoer',
  'action.refresh': 'Herlaai',
  'action.loading': 'Laai...',

  // Dashboard
  'dashboard.greeting.morning': 'Goeie môre',
  'dashboard.greeting.afternoon': 'Goeie middag',
  'dashboard.greeting.evening': 'Goeie naand',
  'dashboard.health_score': 'Besigheidsgesondheidstelling',
  'dashboard.time_range': 'Tydperk',

  // Status
  'status.active': 'Aktief',
  'status.inactive': 'Onaktief',
  'status.error': 'Fout',
  'status.connected': 'Gekoppel',
  'status.disconnected': 'Ontkoppel',

  // Errors
  'error.generic': "'n Fout het voorgekom. Probeer asseblief weer.",
  'error.network': 'Kan nie koppel nie. Kontroleer asseblief jou internetverbinding.',
  'error.unauthorized': 'Jou sessie het verval. Teken asseblief weer in.',
  'error.not_found': 'Die aangevraagde hulpbron is nie gevind nie.',
  'error.forbidden': 'Jy het nie toestemming om hierdie aksie uit te voer nie.',
};

export default afMessages;
