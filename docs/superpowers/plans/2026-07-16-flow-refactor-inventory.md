# Flow Refactor — Capability Inventory (Parity Contract)

**Date:** 2026-07-16 · **Spec:** `docs/superpowers/specs/2026-07-16-flow-refactor-design.md` · **Plan:** `docs/superpowers/plans/2026-07-16-flow-refactor.md`

Every capability a user can perform today, mapped to its home in the new one-screen console (`/x`). **No old page is deleted until every `open` row is checked off (or explicitly retired with user sign-off at the Task 10 parity gate).** `unchanged` rows are out of /x scope (public pages, kept utility routes, and the `/console` admin quarantine, which stays as-is). `gate` rows need an explicit user decision.

**557 capabilities across 58 pages** — 248 open (parity-gated), 298 unchanged (out of scope), 11 parity-gate decisions.

| # | Old page | Capability | API | New home | Status |
|---|---|---|---|---|---|
| 1 | AccessStatePage | Route `*` catch-all 404 / ProtectedRoute 403; no data surface, not admin _[figure]_ | — | reused as-is (403/404 states) | unchanged |
| 2 | AccessStatePage | Required-roles chip list (403) _[figure]_ | requiredRoles prop | reused as-is (403/404 states) | unchanged |
| 3 | AccessStatePage | Role-aware "home" CTA (auditor→/assurance, board_member→/board, else /dashboard, logged-out→/) _[nav]_ | — | reused as-is (403/404 states) | unchanged |
| 4 | AccessStatePage | "Request access via support ticket" deep link `/support-tickets?new=1&category=access&subject=…&body=…` _[nav]_ | — | reused as-is (403/404 states) | unchanged |
| 5 | ActionLayerPage | Route `/action-layer`; PLATFORM_ADMIN_ROLES, admin/operator surface _[figure]_ | — | /console?section=operator-queue (admin) · approve/reject also /x#decisions | open |
| 6 | ActionLayerPage | 5 dispatch tiles + total (pending/approved/rejected/executed/exception counts) _[figure]_ | api.erp.actionsSummary | /console?section=operator-queue (admin) · approve/reject also /x#decisions | open |
| 7 | ActionLayerPage | Operator queue action table _[figure]_ | api.erp.listAllActions | /console?section=operator-queue (admin) · approve/reject also /x#decisions | open |
| 8 | ActionLayerPage | Approve single _[action]_ | api.erp.approveAction | /console?section=operator-queue (admin) · approve/reject also /x#decisions | open |
| 9 | ActionLayerPage | Reject single _[action]_ | api.erp.rejectAction | /console?section=operator-queue (admin) · approve/reject also /x#decisions | open |
| 10 | ActionLayerPage | Bulk approve (concurrency 4) _[action]_ | api.erp.approveAction (batched) | /console?section=operator-queue (admin) · approve/reject also /x#decisions | open |
| 11 | ActionLayerPage | Bulk reject (concurrency 4) _[action]_ | api.erp.rejectAction (batched) | /console?section=operator-queue (admin) · approve/reject also /x#decisions | open |
| 12 | ActionLayerPage | Saved views / status filter deep link `/action-layer?status=<key>` _[nav]_ | — | /console?section=operator-queue (admin) · approve/reject also /x#decisions | open |
| 13 | ActionLayerPage | Evidence drawer per action _[figure]_ | api.erp.listAllActions row data | /console?section=operator-queue (admin) · approve/reject also /x#decisions | open |
| 14 | ApexPage | Route `/apex`; executive/strategy surface _[figure]_ | — | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 15 | ApexPage | Health tab: overall health + dimension cards _[figure]_ | api.apex.health | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 16 | ApexPage | Health history trend chart _[figure]_ | api.apex.healthHistory | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 17 | ApexPage | Dimension trace drawer _[action]_ | api.apex.healthDimension | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 18 | ApexPage | Dimension comparison grid / toggle compare _[action]_ | api.apex.health (client) | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 19 | ApexPage | Briefing tab summary + healthDelta/redMetricCount/anomalyCount/activeRiskCount tiles _[figure]_ | api.apex.briefing | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 20 | ApexPage | Briefing KPI movements / top risks / opportunities / decisions-required _[figure]_ | api.apex.briefing | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 21 | ApexPage | Risks tab heat map + matrix + expandable risks _[figure]_ | api.apex.risks | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 22 | ApexPage | Risk trace drawer _[action]_ | api.apex.riskTrace | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 23 | ApexPage | Suggest causes _[action]_ | api.apex.riskSuggestCauses | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 24 | ApexPage | Mitigate → navigate(catalystDeployUrl) `/catalysts?cluster=…&sub=…&ops=1` _[nav]_ | — | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 25 | ApexPage | Risk export CSV _[export]_ | api.apex.riskExport | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 26 | ApexPage | Radar signals CSV export _[export]_ | GET /api/radar/signals → apex-radar-signals.csv | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 27 | ApexPage | Board reports CSV export _[export]_ | GET /api/board-report → board-reports.csv | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 28 | ApexPage | OKRs tab _[nav]_ | (OKRsPanel) | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 29 | ApexPage | Portfolio tab _[nav]_ | api.boardReport.list / (PortfolioPanel) | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 30 | ApexPage | Scenarios tab comparison grid _[figure]_ | api.apex.scenarios | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 31 | ApexPage | Create scenario (3-step builder modal) _[action]_ | api.apex.createScenario | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 32 | ApexPage | Ask Apex agentic scenario prompt _[action]_ | api.apex.agenticScenario | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 33 | ApexPage | One-click scenario templates _[action]_ | api.apex.agenticScenario/createScenario | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 34 | ApexPage | Strategic-context tab summary cards _[figure]_ | api.radar.getContext | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 35 | ApexPage | Generate board report _[action]_ | api.boardReport.generate | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 36 | ApexPage | Download board report PDF _[export]_ | api.boardReport.downloadPdf | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 37 | ApexPage | Add radar signal _[action]_ | api.radar.createSignal | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 38 | ApexPage | Peer-benchmarks tab comparison bars _[figure]_ | api.peerBenchmarks.get | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 39 | ApexPage | Health history / actions / billing / assessments context loads _[figure]_ | api.erp.actionsSummary, api.insightsStats.billingSummary, api.assessments.list/get | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 40 | ApexPage | Tab deep links: health/briefing/risks/okrs/portfolio/scenarios/strategic-context/peer-benchmarks _[nav]_ | — | /x#brief world block (signals, risks, scenarios drill) + sealed exports | open |
| 41 | AssessmentsPage | Route `/assessments`; sales/analyst tool _[figure]_ | — | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 42 | AssessmentsPage | Assessment list _[figure]_ | api.assessments.list | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 43 | AssessmentsPage | Assessment detail _[figure]_ | api.assessments.get | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 44 | AssessmentsPage | Default config _[figure]_ | api.assessments.getDefaultConfig | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 45 | AssessmentsPage | Status / findings / data-quality / process-timing / value-summary panels _[figure]_ | api.assessments.status, .findings, .dataQuality, .processTiming, .valueSummary | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 46 | AssessmentsPage | ERP connections picker _[figure]_ | api.erp.connections | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 47 | AssessmentsPage | Create assessment _[action]_ | api.assessments.create | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 48 | AssessmentsPage | Upload dataset _[action]_ | api.assessments.uploadDataset | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 49 | AssessmentsPage | Run assessment _[action]_ | api.assessments.runAssessment | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 50 | AssessmentsPage | Run value assessment _[action]_ | api.assessments.runValueAssessment | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 51 | AssessmentsPage | Delete assessment _[action]_ | api.assessments.delete | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 52 | AssessmentsPage | Download business report (PDF) _[export]_ | api.assessments.downloadBusiness | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 53 | AssessmentsPage | Download Excel _[export]_ | api.assessments.downloadExcel | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 54 | AssessmentsPage | Download value report _[export]_ | api.assessments.downloadValueReport | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 55 | AssessmentsPage | Download technical report _[export]_ | api.assessments.downloadTechnical | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 56 | AssessmentsPage | Download import template _[export]_ | api.assessments.downloadTemplate | /console?section=assessments (admin) · detect figures /x#brief | unchanged |
| 57 | AssurancePage | Route `/assurance`; auditor landing, consolidation shell _[figure]_ | — | kept — auditor landing (out of /x scope) | unchanged |
| 58 | AssurancePage | Evidence & audit-log section _[nav]_ | (embeds CompliancePage) | kept — auditor landing (out of /x scope) | unchanged |
| 59 | AssurancePage | Audit-trail section _[nav]_ | (embeds AuditPage) | kept — auditor landing (out of /x scope) | unchanged |
| 60 | AssurancePage | Data-governance section _[nav]_ | (embeds DataGovernancePage) | kept — auditor landing (out of /x scope) | unchanged |
| 61 | AuditPage | Route `/audit` (also embedded in Compliance/Assurance) _[figure]_ | — | /console?section=compliance (embedded) | unchanged |
| 62 | AuditPage | 4 hero tiles + timeline/table _[figure]_ | api.audit.log | /console?section=compliance (embedded) | unchanged |
| 63 | AuditPage | Filters (action/actor/date) _[action]_ | api.audit.log (params) | /console?section=compliance (embedded) | unchanged |
| 64 | AuditPage | CSV export _[export]_ | api.audit.log → client CSV | /console?section=compliance (embedded) | unchanged |
| 65 | AuditPage | TXT export _[export]_ | api.audit.log → client txt | /console?section=compliance (embedded) | unchanged |
| 66 | AuditSharePage | Public route `/audit-share/:token` (no login) _[figure]_ | — | public route, unchanged | unchanged |
| 67 | AuditSharePage | Evidence pack fetch (404/410 states) _[figure]_ | api.auditShare.fetchPack(token) | public route, unchanged | unchanged |
| 68 | AuditSharePage | Download JSON `atheon-soc2-evidence-<date>.json` _[export]_ | client Blob from fetched pack | public route, unchanged | unchanged |
| 69 | BoardDigestPage | Route `/board-digest`; board_member landing _[figure]_ | — | /x#brief + sealed export (board persona lens) | open |
| 70 | BoardDigestPage | Hero total realised savings _[figure]_ | api.insightsStats.billingSummary | /x#brief + sealed export (board persona lens) | open |
| 71 | BoardDigestPage | Ledger tiles: Atheon billed + ROI multiple _[figure]_ | api.insightsStats.billingSummary | /x#brief + sealed export (board persona lens) | open |
| 72 | BoardDigestPage | At-a-Glance KPI strip: Atheon Score _[figure]_ | api.apex.health | /x#brief + sealed export (board persona lens) | open |
| 73 | BoardDigestPage | At-a-Glance: Open Risks _[figure]_ | api.apex.risksCount | /x#brief + sealed export (board persona lens) | open |
| 74 | BoardDigestPage | At-a-Glance: Active Anomalies _[figure]_ | api.pulse.anomaliesCount | /x#brief + sealed export (board persona lens) | open |
| 75 | BoardDigestPage | Forecast accuracy (within_band_rate) _[figure]_ | api.insightsStats.forecastAccuracy | /x#brief + sealed export (board persona lens) | open |
| 76 | BoardDigestPage | Download digest PDF (gated superadmin/support_admin/admin/executive) _[export]_ | api.boardDigest.generate → api.boardDigest.downloadPdf | /x#brief + sealed export (board persona lens) | open |
| 77 | BoardDigestPage | Download full pack PDF (gated superadmin/support_admin/admin) _[export]_ | api.boardReport.generate → api.boardReport.downloadPdf | /x#brief + sealed export (board persona lens) | open |
| 78 | BriefPage | Route `/brief`; EXECUTIVE_ROLES landing _[figure]_ | — | /x#brief | open |
| 79 | BriefPage | Recovered-to-date figure _[figure]_ | api.executiveSummary.get (roi.recovered) | /x#brief | open |
| 80 | BriefPage | Atheon fee line _[figure]_ | api.executiveSummary.get (roi.cost) | /x#brief | open |
| 81 | BriefPage | Health improvement delta _[figure]_ | api.executiveSummary.get (journey.improvement) | /x#brief | open |
| 82 | BriefPage | New signals this week _[figure]_ | api.executiveSummary.get (signals.newThisWeek) | /x#brief | open |
| 83 | BriefPage | Top risk exposure _[figure]_ | api.executiveSummary.get (topRisks[0]) | /x#brief | open |
| 84 | BriefPage | Source freshness line _[figure]_ | api.freshness.get | /x#brief | open |
| 85 | BriefPage | Up to 3 pending decision cards _[figure]_ | api.catalysts.pendingApprovals | /x#brief | open |
| 86 | BriefPage | Decision "Review" / "see all" → /decisions _[nav]_ | — | /x#brief | open |
| 87 | BriefPage | First-run → /onboarding _[nav]_ | — | /x#brief | open |
| 88 | BriefPage | ProgressRule "view full journey" → /dashboard _[nav]_ | — | /x#brief | open |
| 89 | BriefPage | ValueChainFlow strip _[figure]_ | — | /x#brief | open |
| 90 | BulkUserManagementPage | Route `/bulk-users`; admin/support_admin/superadmin admin surface _[figure]_ | — | /console?section=bulk-users | unchanged |
| 91 | BulkUserManagementPage | User counts (total/active/suspended) _[figure]_ | api.iam.users | /console?section=bulk-users | unchanged |
| 92 | BulkUserManagementPage | Import history count/list _[figure]_ | api.bulkUsers.history | /console?section=bulk-users | unchanged |
| 93 | BulkUserManagementPage | Tabs: import / bulk-actions / history _[nav]_ | — | /console?section=bulk-users | unchanged |
| 94 | BulkUserManagementPage | Run CSV import (dry-run + apply) _[action]_ | api.bulkUsers.import | /console?section=bulk-users | unchanged |
| 95 | BulkUserManagementPage | Apply bulk action (suspend/activate/change_role, window.confirm) _[action]_ | api.bulkUsers.action | /console?section=bulk-users | unchanged |
| 96 | BulkUserManagementPage | Download import template CSV _[export]_ | client Blob `user-import-template.csv` | /console?section=bulk-users | unchanged |
| 97 | CatalystRunDetailPage | Route `/catalysts/runs/:runId`; operator/admin (ADMIN_ROLES for comment delete) _[figure]_ | — | /x#catalysts run drill (route kept for deep links) | open |
| 98 | CatalystRunDetailPage | Run header: name/status/total value + execution steps _[figure]_ | api.catalysts.runDetail | /x#catalysts run drill (route kept for deep links) | open |
| 99 | CatalystRunDetailPage | Run meta + steps + source/target record counts _[figure]_ | api.catalysts.getSubCatalystRunDetail | /x#catalysts run drill (route kept for deep links) | open |
| 100 | CatalystRunDetailPage | Run lineage chain (parent_run_id walk, click ancestor → /catalysts/runs/:id) _[nav]_ | api.catalysts.getSubCatalystRunDetail (recursive) | /x#catalysts run drill (route kept for deep links) | open |
| 101 | CatalystRunDetailPage | 4 KPI tiles (matched/discrepancies/exceptions/total value) w/ drill `?status=` _[figure]_ | api.catalysts.runDetail | /x#catalysts run drill (route kept for deep links) | open |
| 102 | CatalystRunDetailPage | Run items table (server-paginated, client-filtered, review progress, value totals) _[figure]_ | api.catalysts.getRunItems | /x#catalysts run drill (route kept for deep links) | open |
| 103 | CatalystRunDetailPage | Review single item (approve/reject, confirm dialog) _[action]_ | api.catalysts.reviewRunItem | /x#catalysts run drill (route kept for deep links) | open |
| 104 | CatalystRunDetailPage | Bulk review items _[action]_ | api.catalysts.bulkReviewRunItems | /x#catalysts run drill (route kept for deep links) | open |
| 105 | CatalystRunDetailPage | Retry run _[action]_ | api.catalysts.retryRun | /x#catalysts run drill (route kept for deep links) | open |
| 106 | CatalystRunDetailPage | Compare to previous (resolve prior run) _[action]_ | api.catalysts.getSubCatalystRuns + api.catalysts.compareRuns | /x#catalysts run drill (route kept for deep links) | open |
| 107 | CatalystRunDetailPage | Export items CSV `catalyst-run-<id>-items.csv` (pages full dataset) _[export]_ | api.catalysts.getRunItems → client CSV | /x#catalysts run drill (route kept for deep links) | open |
| 108 | CatalystRunDetailPage | Export JSON `catalyst-run-<id>.json` _[export]_ | api.catalysts.getRunItems → client JSON | /x#catalysts run drill (route kept for deep links) | open |
| 109 | CatalystRunDetailPage | Comments thread (list) _[figure]_ | api.catalysts.getRunComments | /x#catalysts run drill (route kept for deep links) | open |
| 110 | CatalystRunDetailPage | Add comment _[action]_ | api.catalysts.addRunComment | /x#catalysts run drill (route kept for deep links) | open |
| 111 | CatalystRunDetailPage | Delete comment _[action]_ | api.catalysts.deleteRunComment | /x#catalysts run drill (route kept for deep links) | open |
| 112 | CatalystRunDetailPage | Insights panel _[figure]_ | api.catalysts.runAnalyticsDetail | /x#catalysts run drill (route kept for deep links) | open |
| 113 | CatalystRunDetailPage | Catalyst simulator card _[figure]_ | (CatalystSimulatorCard, cluster/sub) | /x#catalysts run drill (route kept for deep links) | open |
| 114 | CatalystRunDetailPage | KPIs generated / Pulse metrics ("View in Pulse" → /pulse?metric=…) / source data / timeline _[figure]_ | api.catalysts.runDetail | /x#catalysts run drill (route kept for deep links) | open |
| 115 | CatalystsPage | Route `/catalysts`; operator/admin; power-user tabs gated _[figure]_ | — | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 116 | CatalystsPage | Pending-approval hero Rand value + SharedSavingsStrip / ValueChainFlow _[figure]_ | api.erp.actionsSummary | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 117 | CatalystsPage | Clusters + sub-catalysts (deploy-sorted) _[figure]_ | api.catalysts.clusters | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 118 | CatalystsPage | Actions/activity list _[figure]_ | api.catalysts.actions | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 119 | CatalystsPage | Governance data _[figure]_ | api.catalysts.governance | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 120 | CatalystsPage | Tabs: approvals/value-ledger/clusters/intelligence/success-stories/actions/execution-logs/exceptions/run-analytics + admin: hitl-permissions/confidence/governance _[nav]_ | — | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 121 | CatalystsPage | Approve action _[action]_ | api.catalysts.approveAction | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 122 | CatalystsPage | Reject action _[action]_ | api.catalysts.rejectAction | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 123 | CatalystsPage | Manual execute (form + file) _[action]_ | api.catalysts.manualExecute | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 124 | CatalystsPage | Quick run (per sub-catalyst modal) _[action]_ | api.catalysts.manualExecute | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 125 | CatalystsPage | Execute sub-catalyst _[action]_ | api.catalysts.executeSubCatalyst | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 126 | CatalystsPage | Toggle sub-catalyst on/off _[action]_ | api.catalysts.toggleSubCatalyst | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 127 | CatalystsPage | Data-source config: set (plural) _[action]_ | api.catalysts.setDataSources | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 128 | CatalystsPage | Data-source config: set (singular fallback) _[action]_ | api.catalysts.setDataSource | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 129 | CatalystsPage | Data-source config: remove all _[action]_ | api.catalysts.removeDataSource | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 130 | CatalystsPage | Data-source config: ERP connections picker _[figure]_ | api.erp.connections | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 131 | CatalystsPage | Field-mapping: suggest _[action]_ | api.catalysts.suggestFieldMappings | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 132 | CatalystsPage | Field-mapping: save _[action]_ | api.catalysts.setFieldMappings | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 133 | CatalystsPage | Schedule: save _[action]_ | api.catalysts.setSchedule | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 134 | CatalystsPage | Schedule: remove _[action]_ | api.catalysts.removeSchedule | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 135 | CatalystsPage | Execution config: save (mode) _[action]_ | api.catalysts.setExecutionConfig | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 136 | CatalystsPage | Execution logs (all / per-action) _[figure]_ | api.catalysts.executionLogs / .executionLogsForAction | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 137 | CatalystsPage | Resolve exception (notes) _[action]_ | api.catalysts.resolveException | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 138 | CatalystsPage | Escalate exception _[action]_ | api.catalysts.escalateException | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 139 | CatalystsPage | Intelligence overview + prescriptions _[figure]_ | api.catalystIntelligence.getOverview, .getPrescriptions | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 140 | CatalystsPage | ROI tracking figures (recovered/prevented/hours/cost/breakdown) _[figure]_ | api.roi.get | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 141 | CatalystsPage | Discover patterns _[action]_ | api.catalystIntelligence.analyse | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 142 | CatalystsPage | Discover dependencies _[action]_ | api.catalystIntelligence.discoverDependencies | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 143 | CatalystsPage | Success stories / peer insights _[figure]_ | api.successStories.get | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 144 | CatalystsPage | HITL reviewers: list configs + users _[figure]_ | api.catalysts.hitlConfig, api.iam.users | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 145 | CatalystsPage | HITL: save config _[action]_ | api.catalysts.saveHitlConfig | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 146 | CatalystsPage | HITL: delete config (window.confirm) _[action]_ | api.catalysts.deleteHitlConfig | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 147 | CatalystsPage | Run analytics list + aggregate (ProcessMiningPanel) _[figure]_ | api.catalysts.runAnalytics | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 148 | CatalystsPage | Confidence thresholds panel _[figure]_ | (ConfidenceThresholdsPanel) | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 149 | CatalystsPage | Approval queue / value ledger / sub-catalyst ops panels _[figure]_ | (ApprovalQueuePanel / ValueLedgerPanel / SubCatalystOpsPanel) | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 150 | CatalystsPage | Export patterns CSV (power user) _[export]_ | GET /api/catalyst-intelligence/patterns → catalyst-patterns.csv | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 151 | CatalystsPage | Export ROI CSV (power user) _[export]_ | GET /api/roi → roi-tracking.csv | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 152 | CatalystsPage | Deep links: `?cluster=&sub=&ops=1` open ops panel; `?tab=` tab select; "see savings proof" → /roi-dashboard _[nav]_ | — | /x#catalysts (+ approvals in /x#decisions; admin config tabs /console) | open |
| 153 | CompanyHealthPage | Route `/company-health`; admin/support_admin/superadmin admin surface _[figure]_ | — | /console (inside PlatformHealth) | unchanged |
| 154 | CompanyHealthPage | Hero active-user % + supporting trio (actions30d/tokens30d/connections) _[figure]_ | api.adminTooling.companyHealthDetail(tenantId) | /console (inside PlatformHealth) | unchanged |
| 155 | CompanyHealthPage | Tabs: adoption / catalysts / ai-usage / entitlements _[nav]_ | api.adminTooling.companyHealthDetail | /console (inside PlatformHealth) | unchanged |
| 156 | CompanyHealthPage | Adoption: user status, users-by-role, seat utilisation vs entitlements.maxUsers _[figure]_ | api.adminTooling.companyHealthDetail | /console (inside PlatformHealth) | unchanged |
| 157 | CompanyHealthPage | Catalysts: clusters + actionsLast30d _[figure]_ | api.adminTooling.companyHealthDetail | /console (inside PlatformHealth) | unchanged |
| 158 | CompanyHealthPage | AI usage: tokens30d, estCostUsd, costIsEstimate _[figure]_ | api.adminTooling.companyHealthDetail | /console (inside PlatformHealth) | unchanged |
| 159 | CompanyHealthPage | Entitlements: limits/flags/layers/tiers/features _[figure]_ | api.adminTooling.companyHealthDetail | /console (inside PlatformHealth) | unchanged |
| 160 | CompanyHealthPage | Refresh _[action]_ | api.adminTooling.companyHealthDetail (reload) | /console (inside PlatformHealth) | unchanged |
| 161 | CompliancePage | Route `/compliance` (also under /assurance evidence tab); admin+ / auditor read _[figure]_ | — | /console?section=compliance | unchanged |
| 162 | CompliancePage | Tabs: Evidence Pack / Audit Log / Governance (governance hidden for auditor) _[nav]_ | — | /console?section=compliance | unchanged |
| 163 | CompliancePage | Audit Log tab _[nav]_ | (embeds AuditPage → api.audit.log) | /console?section=compliance | unchanged |
| 164 | CompliancePage | Governance tab _[nav]_ | (embeds DataGovernancePage) | /console?section=compliance | unchanged |
| 165 | CompliancePage | Evidence pack load (posture score, frameworks, all control cards) _[figure]_ | api.compliance.evidencePack(tenantId) | /console?section=compliance | unchanged |
| 166 | CompliancePage | Hero posture score + framework rings (MFA/incident/encryption/access) _[figure]_ | api.compliance.evidencePack | /console?section=compliance | unchanged |
| 167 | CompliancePage | Control cards: access reviews, MFA, config changes, incident response, deprovisioning, encryption, audit retention _[figure]_ | api.compliance.evidencePack | /console?section=compliance | unchanged |
| 168 | CompliancePage | Refresh _[action]_ | api.compliance.evidencePack (reload) | /console?section=compliance | unchanged |
| 169 | CompliancePage | Download JSON `atheon-compliance-evidence-<tenant>-<date>.json` _[export]_ | client Blob from pack | /console?section=compliance | unchanged |
| 170 | CompliancePage | Share-with-auditor modal: list links _[figure]_ | api.compliance.listShareLinks | /console?section=compliance | unchanged |
| 171 | CompliancePage | Create 7-day share link _[action]_ | api.compliance.createShareLink | /console?section=compliance | unchanged |
| 172 | CompliancePage | Revoke share link _[action]_ | api.compliance.revokeShareLink | /console?section=compliance | unchanged |
| 173 | CompliancePage | Copy share URL `${origin}/audit-share/<token>` _[action]_ | clipboard (client) | /console?section=compliance | unchanged |
| 174 | ConnectivityPage (internal ops; no explicit route) | Engine hub % Connections Online + Records Synced + Live Status (Optimal/Degraded/Unknown) _[figure]_ | api.erp.connections() | /x#brief connect health strip | open |
| 175 | ConnectivityPage | Multicompany count _[figure]_ | api.companies.list() | /x#brief connect health strip | open |
| 176 | ConnectivityPage | Per-connection node cards (recordsSynced, adapterName, status, lastSync, schedule) _[figure]_ | api.erp.connections() | /x#brief connect health strip | open |
| 177 | ConnectivityPage | Circuit-breaker state badge per connection _[figure]_ | api.erp.circuitState(id) | /x#brief connect health strip | open |
| 178 | ConnectivityPage | Fleet Analytics tiles (Total, Connected, Errors, Circuits Open) _[figure]_ | api.erp.connections() (+ circuitState) | /x#brief connect health strip | open |
| 179 | ConnectivityPage | Test connection (per node) _[action]_ | api.erp.testConnection(id) then api.erp.circuitState(id) | /x#brief connect health strip | open |
| 180 | ConnectivityPage | Empty-state "Open Integrations" _[nav]_ | /integrations | /x#brief connect health strip | open |
| 181 | ConnectorsPage (/legal/connectors; PUBLIC) | Total Connectors / Live Integrations / Attention Needed tiles _[figure]_ | hardcoded CONNECTORS array (no api) | public route, unchanged | unchanged |
| 182 | ConnectorsPage | Connector card grid + conformance legend _[figure]_ | hardcoded CONNECTORS array (no api) | public route, unchanged | unchanged |
| 183 | ConnectorsPage | Home link _[nav]_ | / | public route, unchanged | unchanged |
| 184 | ConnectorsPage | Security link _[nav]_ | /legal/security | public route, unchanged | unchanged |
| 185 | ConnectorsPage | Partnerships contact _[nav]_ | mailto:partnerships@vantax.co.za | public route, unchanged | unchanged |
| 186 | ConnectorsPage | OpenAPI spec (external) _[nav]_ | https://atheon-api.vantax.co.za/api/v1/openapi.json | public route, unchanged | unchanged |
| 187 | ConsolePage (/console; admin quarantine; ?section=<key>) | Grouped section switcher (one mount at a time) _[nav]_ | setParams({section}) (no fetch; lazy-mounts pages) | /console stays as-is (quarantine) | unchanged |
| 188 | ConsolePage | Tenancy · Clients [super] _[nav]_ | lazy TenantsPage (?section=clients) | /console stays as-is (quarantine) | unchanged |
| 189 | ConsolePage | Tenancy · Tenant admin [super] _[nav]_ | lazy TenantManagementPage (?section=tenant-admin) | /console stays as-is (quarantine) | unchanged |
| 190 | ConsolePage | Tenancy · Revenue [super] _[nav]_ | lazy RevenueUsagePage (?section=revenue) | /console stays as-is (quarantine) | unchanged |
| 191 | ConsolePage | Access · IAM [admin] _[nav]_ | lazy IAMPage (?section=iam) | /console stays as-is (quarantine) | unchanged |
| 192 | ConsolePage | Access · Custom roles [admin] _[nav]_ | lazy CustomRoleBuilderPage (?section=custom-roles) | /console stays as-is (quarantine) | unchanged |
| 193 | ConsolePage | Access · Bulk users [admin] _[nav]_ | lazy BulkUserManagementPage (?section=bulk-users) | /console stays as-is (quarantine) | unchanged |
| 194 | ConsolePage | Platform · Control plane [admin] _[nav]_ | lazy ControlPlanePage (?section=control-plane) | /console stays as-is (quarantine) | unchanged |
| 195 | ConsolePage | Platform · Operations health [admin] _[nav]_ | lazy PlatformHealthPage (?section=health) | /console stays as-is (quarantine) | unchanged |
| 196 | ConsolePage | Platform · System alerts [admin] _[nav]_ | lazy SystemAlertsPage (?section=alerts) | /console stays as-is (quarantine) | unchanged |
| 197 | ConsolePage | Platform · Deployments [super] _[nav]_ | lazy DeploymentsPage (?section=deployments) | /console stays as-is (quarantine) | unchanged |
| 198 | ConsolePage | Platform · Assessments [super] _[nav]_ | lazy AssessmentsPage (?section=assessments) | /console stays as-is (quarantine) | unchanged |
| 199 | ConsolePage | Platform · Feature flags [super] _[nav]_ | lazy FeatureFlagsPage (?section=flags) | /console stays as-is (quarantine) | unchanged |
| 200 | ConsolePage | Integrations · Integrations [admin] _[nav]_ | lazy IntegrationsPage (?section=integrations) | /console stays as-is (quarantine) | unchanged |
| 201 | ConsolePage | Integrations · Webhooks [admin] _[nav]_ | lazy WebhooksPage (?section=webhooks) | /console stays as-is (quarantine) | unchanged |
| 202 | ConsolePage | Integrations · Operator queue [admin] _[nav]_ | lazy ActionLayerPage (?section=operator-queue) | /console stays as-is (quarantine) | unchanged |
| 203 | ConsolePage | Support · Support console [support] _[nav]_ | lazy SupportConsolePage (?section=support-console) | /console stays as-is (quarantine) | unchanged |
| 204 | ConsolePage | Support · Support triage [admin] _[nav]_ | lazy SupportTriagePage (?section=support-triage) | /console stays as-is (quarantine) | unchanged |
| 205 | ConsolePage | Support · Impersonate [support] _[nav]_ | lazy ImpersonationPage (?section=impersonate) | /console stays as-is (quarantine) | unchanged |
| 206 | ConsolePage | Support · Incident manager [support] _[nav]_ | lazy StatusIncidentsAdminPage (?section=incidents) | /console stays as-is (quarantine) | unchanged |
| 207 | ConsolePage | Governance · Compliance [admin] _[nav]_ | lazy CompliancePage (?section=compliance) | /console stays as-is (quarantine) | unchanged |
| 208 | ControlPlanePage (admin; polls 30s) | System Metrics Overview (Active Services, RAG health, Total Replicas, Avg Uptime, Overall Health%, Last Checked, deploymentStatus) _[figure]_ | api.controlplane.deployments() + api.controlplane.health() | /console?section=control-plane | unchanged |
| 209 | ControlPlanePage | Deployment cards (uptime, healthScore, replicas, tasksExecuted, version, heartbeat, config, allowed/blocked actions) _[figure]_ | api.controlplane.deployments() | /console?section=control-plane | unchanged |
| 210 | ControlPlanePage | Refresh _[action]_ | api.controlplane.deployments() + api.controlplane.health() | /console?section=control-plane | unchanged |
| 211 | ControlPlanePage | Deploy Agent modal cluster list _[figure]_ | api.catalysts.clusters() | /console?section=control-plane | unchanged |
| 212 | ControlPlanePage | Create deployment _[action]_ | api.controlplane.createDeployment(payload) | /console?section=control-plane | unchanged |
| 213 | ControlPlanePage | Start/Stop _[action]_ | api.controlplane.updateDeployment(id,{status}) | /console?section=control-plane | unchanged |
| 214 | ControlPlanePage | Restart _[action]_ | api.controlplane.updateDeployment(id) x2 (deploying then running) | /console?section=control-plane | unchanged |
| 215 | ControlPlanePage | Scale replicas _[action]_ | api.controlplane.updateDeployment(id,{config:{replicas}}) | /console?section=control-plane | unchanged |
| 216 | ControlPlanePage | Edit Config _[action]_ | api.controlplane.updateDeployment(id,{version,config}) | /console?section=control-plane | unchanged |
| 217 | ControlPlanePage | Delete (confirm) _[action]_ | api.controlplane.deleteDeployment(id) | /console?section=control-plane | unchanged |
| 218 | CustomRoleBuilderPage (/custom-roles; admin/support_admin/superadmin) | Summary tiles Custom Roles, Assigned Users, Permission Surface _[figure]_ | api.iam.customRoles(tenantId) + api.iam.permissions() | /console?section=custom-roles | unchanged |
| 219 | CustomRoleBuilderPage | Roles list (name, inheritsFrom, permissions, userCount) _[figure]_ | api.iam.customRoles(tenantId) | /console?section=custom-roles | unchanged |
| 220 | CustomRoleBuilderPage | Modal permission matrix + Effective Permissions Preview _[figure]_ | api.iam.permissions() | /console?section=custom-roles | unchanged |
| 221 | CustomRoleBuilderPage | New Role _[action]_ | api.iam.createCustomRole(...) | /console?section=custom-roles | unchanged |
| 222 | CustomRoleBuilderPage | Edit Role _[action]_ | api.iam.updateCustomRole(id,...) | /console?section=custom-roles | unchanged |
| 223 | CustomRoleBuilderPage | Delete Role (blocked if userCount>0, confirm) _[action]_ | api.iam.deleteCustomRole(id, tenantId) | /console?section=custom-roles | unchanged |
| 224 | DataGovernancePage (/data-governance; admin/support_admin/superadmin) | Encrypted %, Audit Vol 30d, DSAR Exports 30d, Erasures 30d, Retention days _[figure]_ | api.governance.get(tenantId) | /console (compliance governance tab) | unchanged |
| 225 | DataGovernancePage | Tabs Overview / DSAR & Erasure / Retention / Encryption _[nav]_ | (useTabState; single governance.get payload) | /console (compliance governance tab) | unchanged |
| 226 | DataGovernancePage | Refresh _[action]_ | api.governance.get(tenantId) | /console (compliance governance tab) | unchanged |
| 227 | DataPage (/data; Journey 01 Connect) | KPIs Sources connected, Broken connections, Last successful sync, Records ingested _[figure]_ | api.erp.connections() | /x#brief connect health strip | open |
| 228 | DataPage | Per-connection rows (name, adapterName, recordsSynced, lastSync, status) _[figure]_ | api.erp.connections() | /x#brief connect health strip | open |
| 229 | DataPage | Latest-analysis freshness line _[figure]_ | api.assessments.list() (latestCompleteAssessment) | /x#brief connect health strip | open |
| 230 | DataPage | Re-sync (admin only) _[action]_ | api.erp.sync(id) then api.erp.connections() | /x#brief connect health strip | open |
| 231 | DataPage | Manage integrations / Fix in Integrations / Connect (admin) _[nav]_ | /integrations | /x#brief connect health strip | open |
| 232 | DataPage | Review findings / see what it found _[nav]_ | /findings | /x#brief connect health strip | open |
| 233 | DecisionsPage (/decisions; DoA queue) | Dateline count "waiting on you" + DecisionCards (amount via amountFrom(inputData), confidence, reasoning) _[figure]_ | api.catalysts.pendingApprovals() | /x#decisions | open |
| 234 | DecisionsPage | Approve _[action]_ | api.catalysts.approveAction(id) | /x#decisions | open |
| 235 | DecisionsPage | Reject (window.prompt reason required) _[action]_ | api.catalysts.rejectAction(id, undefined, reason) | /x#decisions | open |
| 236 | DecisionsPage | Retry load _[action]_ | api.catalysts.pendingApprovals() | /x#decisions | open |
| 237 | DecisionsPage | Open Catalysts _[nav]_ | /catalysts | /x#decisions | open |
| 238 | DeploymentsPage (on-prem/hybrid; admin/super; views overview/provision/detail/logs) | Active deployment banner (healthScore) + release ledger rows (name, status, healthScore, agentVersion, cpu/mem, heartbeat, tenantName) _[figure]_ | api.deployments.list() | /console?section=deployments | unchanged |
| 239 | DeploymentsPage | Detail stats (Licence Key/Expiry etc.) _[figure]_ | api.deployments.get(id) | /console?section=deployments | unchanged |
| 240 | DeploymentsPage | Logs list (severity) _[figure]_ | api.deployments.getLogs(id) | /console?section=deployments | unchanged |
| 241 | DeploymentsPage | Provision tenant picker _[figure]_ | api.tenants.list() | /console?section=deployments | unchanged |
| 242 | DeploymentsPage | New Deploy / Provision _[action]_ | api.deployments.create(form) | /console?section=deployments | unchanged |
| 243 | DeploymentsPage | Edit _[action]_ | api.deployments.update(id,...) | /console?section=deployments | unchanged |
| 244 | DeploymentsPage | Push Config _[action]_ | api.deployments.pushConfig(id, parsed) | /console?section=deployments | unchanged |
| 245 | DeploymentsPage | Promote _[action]_ | api.deployments.pushUpdate(id, version) | /console?section=deployments | unchanged |
| 246 | DeploymentsPage | Rollback (confirm) _[action]_ | api.deployments.pushUpdate(id, version) | /console?section=deployments | unchanged |
| 247 | DeploymentsPage | Revoke (type-name confirm) _[action]_ | api.deployments.revoke(id) | /console?section=deployments | unchanged |
| 248 | DeploymentsPage | Install modal (licenceKey/installCommand/envFile display) _[figure]_ | api.deployments.create/get payload | /console?section=deployments | unchanged |
| 249 | ERPOAuthCallbackPage (/erp/oauth/callback?code&state&provider) | Status card (loading/success/error) _[figure]_ | api.erp.createConnection({oauth_code,oauth_state,provider,type:'oauth'}) | kept — OAuth callback route | unchanged |
| 250 | ERPOAuthCallbackPage | Token exchange on mount (single-use guarded) _[action]_ | api.erp.createConnection(...) | kept — OAuth callback route | unchanged |
| 251 | ERPOAuthCallbackPage | View Connections / Try Again _[nav]_ | /integrations | kept — OAuth callback route | unchanged |
| 252 | ERPOAuthCallbackPage | Dashboard _[nav]_ | /dashboard | kept — OAuth callback route | unchanged |
| 253 | ExecutiveSummaryPage (/executive-summary; superadmin/support_admin/admin/executive) | Recovered to Date (roi.recovered, multiple), Atheon Score, Health Score (+orb+Sparkline trend), Journey vs Baseline, diagnostics (activeRcas, pendingPrescriptions), signals.newThisWeek, Top Risks, Health Score Trend, Health Dimensions, Active Targets _[figure]_ | api.executiveSummary.get() | /x#brief + sealed export | open |
| 254 | ExecutiveSummaryPage | Embedded FindingsReviewTable _[figure]_ | (child component fetch) | /x#brief + sealed export | open |
| 255 | ExecutiveSummaryPage | SharedSavingsStrip _[figure]_ | (child component) | /x#brief + sealed export | open |
| 256 | ExecutiveSummaryPage | Download PDF (data-testid exec-summary-download) _[export]_ | api.boardDigest.generate() then api.boardDigest.downloadPdf(id, title) | /x#brief + sealed export | open |
| 257 | ExecutiveSummaryPage | Refresh _[action]_ | api.executiveSummary.get() | /x#brief + sealed export | open |
| 258 | ExecutiveSummaryPage | Top Risks / Dimensions _[nav]_ | /apex | /x#brief + sealed export | open |
| 259 | FeatureFlagsPage (/feature-flags; superadmin only) | Total Flags, Active, Inactive tiles _[figure]_ | api.featureFlags.list() | /console?section=flags | unchanged |
| 260 | FeatureFlagsPage | Flags table (name, description, type, status, rollout%) _[figure]_ | api.featureFlags.list() | /console?section=flags | unchanged |
| 261 | FeatureFlagsPage | Tenant picker (evaluate/allowlist) _[figure]_ | api.tenants.list() | /console?section=flags | unchanged |
| 262 | FeatureFlagsPage | New Flag _[action]_ | api.featureFlags.create(...) | /console?section=flags | unchanged |
| 263 | FeatureFlagsPage | Edit Flag _[action]_ | api.featureFlags.update(id,...) | /console?section=flags | unchanged |
| 264 | FeatureFlagsPage | Toggle _[action]_ | api.featureFlags.toggle(id) | /console?section=flags | unchanged |
| 265 | FeatureFlagsPage | Delete (confirm) _[action]_ | api.featureFlags.delete(id) | /console?section=flags | unchanged |
| 266 | FeatureFlagsPage | Evaluate as Tenant (dev tool) _[action]_ | api.featureFlags.evaluate(tenantId) | /console?section=flags | unchanged |
| 267 | FeatureFlagsPage | Search filter _[action]_ | (client-side) | /console?section=flags | unchanged |
| 268 | FindingsPage (/findings; Journey 02 Detect) | Detected exposure headline (total_value_at_risk_zar, total_count, unverified_count/potential_unverified_zar) _[figure]_ | api.assessments.list() then api.assessments.get(latest.id) (results.findings_summary) | /x#brief detect block + reactor leak nodes | open |
| 269 | FindingsPage | ValueChainFlow focus=detect _[figure]_ | (static component) | /x#brief detect block + reactor leak nodes | open |
| 270 | FindingsPage | AssessmentFindingsPanel (findings list, findings_by_company, company_profile, severity/category/entity filters, sample-record traceback) _[figure]_ | api.assessments.get(id).results | /x#brief detect block + reactor leak nodes | open |
| 271 | FindingsPage | Deploy → Fixes per finding _[nav]_ | navigate(catalystDeployUrl({catalyst, subCatalyst})) | /x#brief detect block + reactor leak nodes | open |
| 272 | FindingsPage | Fix what was found _[nav]_ | /catalysts | /x#brief detect block + reactor leak nodes | open |
| 273 | FindingsPage | connect your data (empty state) _[nav]_ | /operations | /x#brief detect block + reactor leak nodes | open |
| 274 | IAMPage (Access · Identity & Roles; admin surface; honors activeTenantId) | Summary tiles Active Users, User Roles (in-use), Active Policies (+rules), SSO Providers _[figure]_ | Promise.allSettled: api.iam.policies(tenantId) + api.iam.sso(tenantId) + api.iam.roles(tenantId) + api.iam.users(tenantId) | /console?section=iam | unchanged |
| 275 | IAMPage | Users tab list (name, email, role, status, lastLogin, persona) _[figure]_ | api.iam.users(tenantId) | /console?section=iam | unchanged |
| 276 | IAMPage | Roles & Permissions tab (level, userCount, page/action perms, users-with-role) _[figure]_ | api.iam.roles(tenantId) | /console?section=iam | unchanged |
| 277 | IAMPage | Policies tab (type, rules, effect/resource/actions) _[figure]_ | api.iam.policies(tenantId) | /console?section=iam | unchanged |
| 278 | IAMPage | SSO/Identity tab (provider, domainHint, clientId, issuerUrl, autoProvision, defaultRole, enabled) _[figure]_ | api.iam.sso(tenantId) | /console?section=iam | unchanged |
| 279 | IAMPage | Provisioning (SCIM) tab _[figure]_ | ScimTokenManager (issue/list/revoke tokens) | /console?section=iam | unchanged |
| 280 | IAMPage | Invite/Add User/Admin (returns tempPassword) _[action]_ | api.iam.createUser({...}, tenantId) then api.iam.users(tenantId) | /console?section=iam | unchanged |
| 281 | IAMPage | Edit user (role/status/persona) _[action]_ | api.iam.updateUser(id, updates, tenantId) then api.iam.users(tenantId) | /console?section=iam | unchanged |
| 282 | IAMPage | Suspend/Reactivate (confirm) _[action]_ | api.iam.updateUser(id,{status}) | /console?section=iam | unchanged |
| 283 | IAMPage | Delete user (confirm) _[action]_ | api.iam.deleteUser(id, tenantId) | /console?section=iam | unchanged |
| 284 | IAMPage | Resend welcome email (returns tempPassword) _[action]_ | api.iam.resendWelcome(id, tenantId) | /console?section=iam | unchanged |
| 285 | IAMPage | Create Policy _[action]_ | api.iam.createPolicy({...}) then api.iam.policies(tenantId) | /console?section=iam | unchanged |
| 286 | IAMPage | Delete Policy (confirm) _[action]_ | api.iam.deletePolicy(id) | /console?section=iam | unchanged |
| 287 | IAMPage | Save SAML config _[action]_ | SamlConfigPanel onSaved then api.iam.sso(tenantId) | /console?section=iam | unchanged |
| 288 | ImpersonationPage (/impersonate; superadmin/support_admin) | User selection list (name, email, role) w/ cross-tenant search _[figure]_ | api.adminTooling.impersonateSearch(q) | /console?section=impersonate | unchanged |
| 289 | ImpersonationPage | Active session banner + Scope/Duration/Expiry/Audit cards _[figure]_ | (client session state) | /console?section=impersonate | unchanged |
| 290 | ImpersonationPage | Search filter _[action]_ | (client-side over loaded list) | /console?section=impersonate | unchanged |
| 291 | ImpersonationPage | View As / Start Session (confirm dialog; swaps token, 15-min) _[action]_ | api.adminTooling.impersonateStart(target.id) | /console?section=impersonate | unchanged |
| 292 | ImpersonationPage | End Session (restores admin token) _[action]_ | api.adminTooling.impersonateEnd() | /console?section=impersonate | unchanged |
| 293 | IntegrationHealthPage (/integration-health, admin) | Summary tiles (total/healthy/degraded/down connections) _[figure]_ | api.erp.connectionsHealth() | /x#brief connect health strip (figures) · /console for admin drill | open |
| 294 | IntegrationHealthPage | Connections health table _[figure]_ | api.erp.connectionsHealth() | /x#brief connect health strip (figures) · /console for admin drill | open |
| 295 | IntegrationHealthPage | Tabs: connections / errors / freshness _[nav]_ | — | /x#brief connect health strip (figures) · /console for admin drill | open |
| 296 | IntegrationHealthPage | Refresh _[action]_ | api.erp.connectionsHealth() | /x#brief connect health strip (figures) · /console for admin drill | open |
| 297 | IntegrationsPage (/integrations, admin) | Summary tile: Active Connections _[figure]_ | api.erp.connections() | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 298 | IntegrationsPage | Summary tile: Available Adapters _[figure]_ | api.erp.adapters() | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 299 | IntegrationsPage | Summary tile: API Endpoints (canonical) _[figure]_ | api.erp.canonical() | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 300 | IntegrationsPage | Summary tile: Records Synced _[figure]_ | api.erp.connections() | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 301 | IntegrationsPage | Tabs: connections / adapters / schema _[nav]_ | — | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 302 | IntegrationsPage | Connected Systems list _[figure]_ | api.erp.connections() | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 303 | IntegrationsPage | Circuit-breaker state per connection _[figure]_ | api.erp.circuitState(id) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 304 | IntegrationsPage | Configure connection _[action]_ | api.erp.updateConnection(id,updates) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 305 | IntegrationsPage | Test Connection _[action]_ | api.erp.testConnection(id) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 306 | IntegrationsPage | Sync Now _[action]_ | api.erp.sync(id) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 307 | IntegrationsPage | View Schema (discovered) _[figure]_ | api.erp.discoveredSchemas(id) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 308 | IntegrationsPage | Review Mappings list _[figure]_ | api.erp.mappings(id) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 309 | IntegrationsPage | Confirm mapping _[action]_ | api.erp.confirmMapping(...) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 310 | IntegrationsPage | Reject mapping _[action]_ | api.erp.rejectMapping(...) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 311 | IntegrationsPage | Refresh mappings _[action]_ | api.erp.refreshMappings(id) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 312 | IntegrationsPage | Process Profile view _[figure]_ | api.erp.processProfile(id) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 313 | IntegrationsPage | Re-infer process profile _[action]_ | api.erp.refreshProcessProfile(id) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 314 | IntegrationsPage | Override process profile _[action]_ | api.erp.updateProcessProfile(id,overrides) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 315 | IntegrationsPage | Vendor Baseline comparison _[figure]_ | api.erp.baselineComparison(id) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 316 | IntegrationsPage | Delete connection _[action]_ | api.erp.deleteConnection(id) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 317 | IntegrationsPage | Available Adapters card grid _[figure]_ | api.erp.adapters() | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 318 | IntegrationsPage | Add/Connect adapter _[action]_ | api.erp.createConnection(...) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 319 | IntegrationsPage | Canonical Data Schema model _[figure]_ | api.erp.canonical() (static model) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 320 | IntegrationsPage | API Endpoints list "Try it" (GET) _[action]_ | api.get(url + ?tenant_id=) | /console?section=integrations (admin config) · status figures /x#brief | unchanged |
| 321 | JourneyHome (/, user home) | Locator sentence (connections/exposure/savings) _[figure]_ | useJourneyInput (journey input feed) | /x itself (the one screen) | open |
| 322 | JourneyHome | Board-lens selector _[nav]_ | — | /x itself (the one screen) | open |
| 323 | JourneyHome | Set as default (persona) _[action]_ | api.auth.setPersona(lens) | /x itself (the one screen) | open |
| 324 | JourneyHome | MFA enforcement banner _[figure]_ | useAppStore.mfaEnforcementWarning | /x itself (the one screen) | open |
| 325 | JourneyHome | Enable MFA now _[nav (/settings/mfa)]_ | — | /x itself (the one screen) | open |
| 326 | JourneyHome | First-run "Get started" card _[nav (/onboarding)]_ | useJourneyInput | /x itself (the one screen) | open |
| 327 | JourneyHome | ValueChainFlow spine _[figure]_ | (component feed) | /x itself (the one screen) | open |
| 328 | JourneyHome | Pending fixes awaiting approval card _[nav (/catalysts)]_ | useJourneyInput.fixes | /x itself (the one screen) | open |
| 329 | JourneyHome | ActionQueuePanel (executive, limit 6) _[figure]_ | (component feed) | /x itself (the one screen) | open |
| 330 | JourneyHome | PersonaRail _[figure]_ | (component feed) | /x itself (the one screen) | open |
| 331 | LoginPage (/login, /reset-password, public) | SSO callback handling _[action]_ | api.auth.ssoCallback | public route, unchanged | unchanged |
| 332 | LoginPage | Session check _[figure]_ | api.auth.me | public route, unchanged | unchanged |
| 333 | LoginPage | Email/password login _[action]_ | api.auth.login | public route, unchanged | unchanged |
| 334 | LoginPage | Register _[action]_ | api.auth.register | public route, unchanged | unchanged |
| 335 | LoginPage | MFA validate on login _[action]_ | api.auth.mfaValidate | public route, unchanged | unchanged |
| 336 | LoginPage | SSO authorize (OAuth) _[action]_ | api.auth.ssoAuthorize | public route, unchanged | unchanged |
| 337 | LoginPage | SAML start _[action]_ | api.auth.samlStart | public route, unchanged | unchanged |
| 338 | LoginPage | Forgot password _[action]_ | api.auth.forgotPassword | public route, unchanged | unchanged |
| 339 | LoginPage | Reset password _[action]_ | api.auth.resetPassword | public route, unchanged | unchanged |
| 340 | LoginPage | Footer links (status/security/connectors/performance) _[nav]_ | — | public route, unchanged | unchanged |
| 341 | MFASetupPage (/settings/mfa) | MFA status figure (backup codes remaining of 8) _[figure]_ | api.auth.mfaStatus | identity menu → MFA (route kept) | open |
| 342 | MFASetupPage | Enroll wizard (Verify & Enable) _[action]_ | MFAEnrollmentWizard (api.auth mfa enroll) | identity menu → MFA (route kept) | open |
| 343 | MFASetupPage | Regenerate recovery codes _[action]_ | api.auth.mfaRegenerateBackupCodes(code) | identity menu → MFA (route kept) | open |
| 344 | MFASetupPage | Disable MFA _[action]_ | api.auth.mfaDisable(code) | identity menu → MFA (route kept) | open |
| 345 | MarketingPage (/, public landing) | Marketing sections (architecture/roles/coverage/features/security/compare/proof) _[figure]_ | — (static) | public route, unchanged | unchanged |
| 346 | MarketingPage | Section anchor nav (in-page) _[nav]_ | — | public route, unchanged | unchanged |
| 347 | MarketingPage | Contact form submit _[action]_ | fetch POST /api/contact | public route, unchanged | unchanged |
| 348 | MarketingPage | CTAs Start Trial / Customer Login / Sign in _[nav (/trial,/login)]_ | — | public route, unchanged | unchanged |
| 349 | MarketingPage | Footer links (status/security/connectors/performance/login) _[nav]_ | — | public route, unchanged | unchanged |
| 350 | MemoryPage (knowledge graph) | Entities list/graph _[figure]_ | api.memory.entities(undefined, typeFilter?) | RETIRE or fold into /console — parity-gate decision | gate |
| 351 | MemoryPage | Relationships list _[figure]_ | api.memory.relationships() | RETIRE or fold into /console — parity-gate decision | gate |
| 352 | MemoryPage | Tabs: graph / entities / relationships / search _[nav]_ | — | RETIRE or fold into /console — parity-gate decision | gate |
| 353 | MemoryPage | Create entity _[action]_ | api.memory.createEntity | RETIRE or fold into /console — parity-gate decision | gate |
| 354 | MemoryPage | Create relationship _[action]_ | api.memory.createRelationship | RETIRE or fold into /console — parity-gate decision | gate |
| 355 | MemoryPage | Build graph _[action]_ | api.memory.build() | RETIRE or fold into /console — parity-gate decision | gate |
| 356 | MemoryPage | Search _[action]_ | api.memory.query(searchQuery) | RETIRE or fold into /console — parity-gate decision | gate |
| 357 | MindPage (tabs models/playground/stats) | Model tiers grid _[figure]_ | api.mind.models() | Jeff in shell (query) · models/stats to /console — parity-gate decision | gate |
| 358 | MindPage | Industry adapters _[figure]_ | api.mind.models() | Jeff in shell (query) · models/stats to /console — parity-gate decision | gate |
| 359 | MindPage | Test Prompt (response: model/latency/tokens/citations) _[action]_ | api.mind.query(prompt, selectedTier) [429→budget] | Jeff in shell (query) · models/stats to /console — parity-gate decision | gate |
| 360 | MindPage | Stats tiles (Total Queries/Avg Latency/Total Tokens, Usage by Tier) _[figure]_ | api.mind.stats() | Jeff in shell (query) · models/stats to /console — parity-gate decision | gate |
| 361 | OnboardingWizardPage (/onboarding, all roles) | Progress ring + step ladder _[figure]_ | api.onboarding.progress() | kept — linked from /x#brief first-run | open |
| 362 | OnboardingWizardPage | "I've done this" complete step _[action]_ | api.onboarding.completeStep(stepId) | kept — linked from /x#brief first-run | open |
| 363 | OnboardingWizardPage | Per-step CTA deep links _[nav (/operations,/catalysts,/findings,/brief,/iam)]_ | — | kept — linked from /x#brief first-run | open |
| 364 | OnboardingWizardPage | Go to Dashboard _[nav (/)]_ | — | kept — linked from /x#brief first-run | open |
| 365 | OnboardingWizardPage | Support ticket footer link _[nav (/support-tickets)]_ | — | kept — linked from /x#brief first-run | open |
| 366 | OperationsPage (/operations, standard roles) | Sub-view: Overview (DataPage) _[nav]_ | — | /x#brief connect health strip | open |
| 367 | OperationsPage | Sub-view: Integration health (manager+) _[nav]_ | (mounts IntegrationHealthPage) | /x#brief connect health strip | open |
| 368 | OperationsPage | Sub-view: Connections (admin, ConnectivityPage) _[nav]_ | — | /x#brief connect health strip | open |
| 369 | OperationsPage | ValueChainFlow focus="connect" _[figure]_ | (component feed) | /x#brief connect health strip | open |
| 370 | OutlookPage (/outlook, C-suite) | External signals + modelled impacts load _[figure]_ | api.radar.getContext() | /x#brief world block + reactor WORLD field | open |
| 371 | OutlookPage | ImpactHorizon SVG (impact by dimension) _[figure]_ | api.radar.getContext() | /x#brief world block + reactor WORLD field | open |
| 372 | OutlookPage | What-if intensity slider (client-only sim) _[action]_ | — (no API) | /x#brief world block + reactor WORLD field | open |
| 373 | OutlookPage | Top signals list w/ external source links _[figure]_ | api.radar.getContext() | /x#brief world block + reactor WORLD field | open |
| 374 | OutlookPage | Retry _[action]_ | api.radar.getContext() | /x#brief world block + reactor WORLD field | open |
| 375 | OutlookPage | Run full what-if in Apex _[nav (/apex)]_ | — | /x#brief world block + reactor WORLD field | open |
| 376 | PerformancePage (/legal/performance, public) | Runs / Regressions / SLO figures _[figure]_ | — (hardcoded) | public route, unchanged | unchanged |
| 377 | PerformancePage | Nav links (/, security, connectors, status, mailto) _[nav]_ | — | public route, unchanged | unchanged |
| 378 | PlatformHealthPage (/platform-health, superadmin) | Tiles: DB Status/Platform Users/API Calls(1h)/Active Alerts _[figure]_ | api.adminTooling.platformHealth() | /console?section=health | unchanged |
| 379 | PlatformHealthPage | Subsystem health grid + incident counter _[figure]_ | api.adminTooling.platformHealth() | /console?section=health | unchanged |
| 380 | PlatformHealthPage | Tenant roster _[figure]_ | api.adminTooling.tenantsRead() | /console?section=health | unchanged |
| 381 | PlatformHealthPage | Alerts list _[figure]_ | api.adminTooling.systemAlerts() | /console?section=health | unchanged |
| 382 | PlatformHealthPage | APM panel _[figure]_ | ApmPanel (component feed) | /console?section=health | unchanged |
| 383 | PlatformHealthPage | Tabs: infrastructure / apm / tenants / alerts _[nav]_ | — | /console?section=health | unchanged |
| 384 | PlatformHealthPage | Refresh _[action]_ | api.adminTooling.platformHealth/tenantsRead/systemAlerts | /console?section=health | unchanged |
| 385 | PulsePage (/pulse) | Action Queue drawer (pending badge) _[figure]_ | api.erp.actionsSummary() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 386 | PulsePage | AI Insights panel _[action]_ | api.pulse.insights(domain,...) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 387 | PulsePage | Refresh Mining _[action]_ | api.pulse.refresh() + metrics/summary/anomalies/processes/correlations | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 388 | PulsePage | Function filter chips _[action]_ | api.pulse.metrics/anomalies/correlations | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 389 | PulsePage | Tabs: dashboard/monitoring/diagnostics/anomalies/processes/catalyst-runs/sla/correlations/cost-of-inaction _[nav]_ | — | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 390 | PulsePage (dashboard) | Operational Health hero (score/status breakdown) _[figure]_ | api.pulse.summary() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 391 | PulsePage (dashboard) | Operational Dimensions bars _[figure]_ | api.apex.healthDimension (via summary) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 392 | PulsePage (dashboard) | Dimension trace _[action]_ | api.pulse.metricTrace / apex.healthDimension | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 393 | PulsePage (dashboard) | Status Breakdown tiles (Total/Healthy/Warning/Critical) _[figure]_ | api.pulse.summary() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 394 | PulsePage (dashboard) | Operational Summary narrative + Insights _[figure]_ | api.pulse.insights() / summary | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 395 | PulsePage (monitoring) | Metric cards grid + filter bar _[figure]_ | api.pulse.metrics() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 396 | PulsePage (monitoring) | Metric trace to source _[action]_ | api.pulse.metricTrace(metricId) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 397 | PulsePage (monitoring) | Metric subscribe _[action]_ | MetricSubscribeButton (subscribe API) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 398 | PulsePage (monitoring) | Run Catalyst for metric _[action]_ | api.pulse.refresh() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 399 | PulsePage (anomalies) | Detect anomalies (Low/Med/High sensitivity) _[action]_ | api.pulse.detectAnomalies(...) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 400 | PulsePage (anomalies) | Anomaly list + severity filter _[figure]_ | api.pulse.anomalies(...) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 401 | PulsePage (anomalies) | Mark investigating/resolved _[action]_ | api.pulse.updateAnomalyStatus(id,status) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 402 | PulsePage (anomalies) | Re-run detection (high) _[action]_ | api.pulse.detectAnomalies(...,'high') | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 403 | PulsePage (anomalies) | Dispatch remediation catalyst (TOTP step-up) _[action]_ | api.catalysts.dispatchFromPulse(payload, mfaCode) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 404 | PulsePage (processes) | Process conformance hero map + summary tiles _[figure]_ | api.pulse.processes() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 405 | PulsePage (processes) | Per-process flow / steps / bottlenecks _[figure]_ | api.pulse.processes() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 406 | PulsePage (sla) | SLA Adherence panel _[figure]_ | SLAAdherencePanel (component feed) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 407 | PulsePage (correlations) | Correlation summary tiles + matrix _[figure]_ | api.pulse.correlations() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 408 | PulsePage (correlations) | Per-correlation detail _[figure]_ | api.pulse.correlations() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 409 | PulsePage (catalyst-runs) | Summary cards + performance table _[figure]_ | api.pulse.catalystRuns() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 410 | PulsePage (catalyst-runs) | Catalyst filter chips _[action]_ | api.pulse.catalystRuns(filter) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 411 | PulsePage (catalyst-runs) | Run list w/ input/output/reasoning _[figure]_ | api.pulse.catalystRuns() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 412 | PulsePage (diagnostics) | Load/Refresh diagnostics summary _[action]_ | api.diagnostics.getSummary() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 413 | PulsePage (diagnostics) | Diagnostic summary tiles _[figure]_ | api.diagnostics.getSummary() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 414 | PulsePage (diagnostics) | Analyses list _[figure]_ | api.diagnostics.getAnalyses() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 415 | PulsePage (diagnostics) | Diagnose at-risk metric _[action]_ | api.diagnostics.analyseMetric(metricId) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 416 | PulsePage (diagnostics) | View analysis (causal chain/fixes) _[action]_ | api.diagnostics.getAnalysis(analysisId) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 417 | PulsePage (diagnostics) | Export Diagnostics CSV _[export]_ | CSVExportButton endpoint=/api/diagnostics (pulse-diagnostics.csv) | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 418 | PulsePage (cost-of-inaction) | Calculate/Recalculate cost _[action]_ | api.costOfInaction.get() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 419 | PulsePage (cost-of-inaction) | CostOfInactionTicker _[figure]_ | api.costOfInaction.get() | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 420 | PulsePage (monitoring empty) | Deploy a catalyst link _[nav (/catalysts)]_ | — | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 421 | PulsePage (metric source attribution) | Source → Catalysts ops panel _[nav (/catalysts?cluster=&sub=&ops=1)]_ | — | /x#brief ops block (health/anomalies) · run analytics /x#catalysts · deep diagnostics drill kept | open |
| 422 | ROIDashboardPage (Savings, internal) | Total realised savings hero _[figure]_ | api.insightsStats.billingSummary() | /x#ledger | open |
| 423 | ROIDashboardPage | Total Atheon revenue (fee) _[figure]_ | api.insightsStats.billingSummary() | /x#ledger | open |
| 424 | ROIDashboardPage | Net benefit (derived) _[figure]_ | api.insightsStats.billingSummary() | /x#ledger | open |
| 425 | ROIDashboardPage | ROI multiple (derived) _[figure]_ | api.insightsStats.billingSummary() | /x#ledger | open |
| 426 | ROIDashboardPage | Periods count _[figure]_ | api.insightsStats.billingSummary() | /x#ledger | open |
| 427 | ROIDashboardPage | Forecast accuracy: total_graded, within_band_rate, median_abs_error_pct, by_horizon table _[figure]_ | api.insightsStats.forecastAccuracy() | /x#ledger | open |
| 428 | ROIDashboardPage | Savings pipeline funnel / return multiple / savings-by-domain _[figure]_ | api.roi.get() (SavingsPipeline) | /x#ledger | open |
| 429 | ROIDashboardPage | Export proof (CSV) _[export]_ | api.roi.exportCsv() | /x#ledger | open |
| 430 | ROIDashboardPage | Deep link to completed actions _[nav]_ | /action-layer?status=completed | /x#ledger | open |
| 431 | ROIDashboardPage | Deep link to value ledger _[nav]_ | /catalysts?tab=value-ledger | /x#ledger | open |
| 432 | ROIDashboardPage | Deep link to brief _[nav]_ | /brief | /x#ledger | open |
| 433 | ROIDashboardPage | Deep link to catalysts _[nav]_ | /catalysts | /x#ledger | open |
| 434 | RevenueUsagePage (/revenue, superadmin) | MRR (estMrrUsd) _[figure]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 435 | RevenueUsagePage | ARR (estArrUsd) _[figure]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 436 | RevenueUsagePage | Total tenants _[figure]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 437 | RevenueUsagePage | Total users _[figure]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 438 | RevenueUsagePage | Pricing note _[figure]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 439 | RevenueUsagePage | By-plan distribution _[figure]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 440 | RevenueUsagePage | Growth: newTenantsByMonth bars _[figure]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 441 | RevenueUsagePage | LLM totalTokens30d _[figure]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 442 | RevenueUsagePage | LLM callCount30d _[figure]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 443 | RevenueUsagePage | LLM topTenants _[figure]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 444 | RevenueUsagePage | Refresh button _[action]_ | api.adminAggregation.revenueUsage() | /console?section=revenue | unchanged |
| 445 | RevenueUsagePage | Tabs: overview / plans / growth / usage _[nav]_ | (client state) | /console?section=revenue | unchanged |
| 446 | SecurityPage (/legal/security, public) | Subprocessors / posture / frameworks _[figure]_ | none (static constants) | public route, unchanged | unchanged |
| 447 | SecurityPage | Links: /status, /legal/connectors, /legal/performance, / _[nav]_ | react-router | public route, unchanged | unchanged |
| 448 | SecurityPage | mailto security@/dpa@/enterprise@vantax.co.za + external DPA URLs _[nav]_ | none | public route, unchanged | unchanged |
| 449 | SettingsPage (/settings) | Hydrate notification prefs / profile _[figure]_ | api.auth.me() | identity menu → Settings (route kept) | open |
| 450 | SettingsPage | Update profile (name/email/notificationPrefs) _[action]_ | api.auth.updateMe() | identity menu → Settings (route kept) | open |
| 451 | SettingsPage | Set persona _[action]_ | api.auth.setPersona() | identity menu → Settings (route kept) | open |
| 452 | SettingsPage | Change password _[action]_ | api.auth.changePassword() | identity menu → Settings (route kept) | open |
| 453 | SettingsPage | MFA status _[figure]_ | api.auth.mfaStatus() | identity menu → Settings (route kept) | open |
| 454 | SettingsPage | List API keys _[figure]_ | api.auth.listApiKeys() | identity menu → Settings (route kept) | open |
| 455 | SettingsPage | Generate API key _[action]_ | api.auth.generateApiKey() | identity menu → Settings (route kept) | open |
| 456 | SettingsPage | Revoke API key _[action]_ | api.auth.revokeApiKey() | identity menu → Settings (route kept) | open |
| 457 | SettingsPage | Export Organisation Data (JSON, admin) _[export]_ | api.tenants.dataExport() | identity menu → Settings (route kept) | open |
| 458 | SettingsPage | Erase Organisation Data (admin) _[action]_ | api.tenants.dataErasure() | identity menu → Settings (route kept) | open |
| 459 | SettingsPage | Get AI Engine config (superadmin) _[figure]_ | api.admin.getLlmConfig() | identity menu → Settings (route kept) | open |
| 460 | SettingsPage | Save AI Engine config (superadmin) _[action]_ | api.admin.saveLlmConfig() | identity menu → Settings (route kept) | open |
| 461 | SettingsPage | Section anchors: profile/notifications/security/api/privacy/platform; deep link /settings/mfa _[nav]_ | react-router | identity menu → Settings (route kept) | open |
| 462 | StatusPage (/status, public) | Overall status banner _[figure]_ | api.status.get() (30s poll) | public route, unchanged | unchanged |
| 463 | StatusPage | 4 component tiles (API/database/cache/storage) _[figure]_ | api.status.get() | public route, unchanged | unchanged |
| 464 | StatusPage | Active incident _[figure]_ | api.status.get() | public route, unchanged | unchanged |
| 465 | StatusPage | Incidents 90-day history _[figure]_ | api.status.get() | public route, unchanged | unchanged |
| 466 | StatusPage | RTO/RPO/residency block _[figure]_ | api.status.get() | public route, unchanged | unchanged |
| 467 | StatusPage | Manual Refresh _[action]_ | api.status.get() | public route, unchanged | unchanged |
| 468 | StatusPage | Link to / _[nav]_ | react-router | public route, unchanged | unchanged |
| 469 | SupportConsolePage (/support, superadmin/support_admin) | Tenant search + summary counts _[figure]_ | api.tenants.list() | /console?section=support-console | unchanged |
| 470 | SupportConsolePage | Tenant activity feed _[figure]_ | api.audit.log(tenantId) | /console?section=support-console | unchanged |
| 471 | SupportConsolePage | Tickets list _[figure]_ | api.support.list({limit,status}) | /console?section=support-console | unchanged |
| 472 | SupportConsolePage | Ticket detail _[figure]_ | api.support.get(id) | /console?section=support-console | unchanged |
| 473 | SupportConsolePage | Create ticket _[action]_ | api.support.create() | /console?section=support-console | unchanged |
| 474 | SupportConsolePage | Add reply _[action]_ | api.support.addReply() | /console?section=support-console | unchanged |
| 475 | SupportConsolePage | Update ticket status _[action]_ | api.support.update({status}) | /console?section=support-console | unchanged |
| 476 | SupportConsolePage | Update ticket priority _[action]_ | api.support.update({priority}) | /console?section=support-console | unchanged |
| 477 | SupportConsolePage | Tenant detail (userCount) _[figure]_ | api.adminTooling.supportTenantDetail(id) | /console?section=support-console | unchanged |
| 478 | SupportConsolePage | Tabs: search/tickets/activity/quick-actions _[nav]_ | (client state) | /console?section=support-console | unchanged |
| 479 | SupportConsolePage | Quick-action navs: /impersonate, /bulk-users, /audit, /system-alerts, /data-governance, /feature-flags _[nav]_ | react-router | /console?section=support-console | unchanged |
| 480 | SupportPage (/support-tickets) | Tickets list _[figure]_ | api.support.list({limit:50}) | identity menu → Support (route kept) | open |
| 481 | SupportPage | Total tickets / open count _[figure]_ | api.support.list() (derived) | identity menu → Support (route kept) | open |
| 482 | SupportPage | Create ticket _[action]_ | api.support.create() | identity menu → Support (route kept) | open |
| 483 | SupportPage | Deep-link prefill ?new=1&category=&subject=&body= _[nav]_ | useSearchParams | identity menu → Support (route kept) | open |
| 484 | SupportPage | Open ticket detail _[nav]_ | /support-tickets/:id | identity menu → Support (route kept) | open |
| 485 | SupportTicketDetailPage (/support-tickets/:id) | Ticket thread + metadata + replies _[figure]_ | api.support.get(id) | kept — ticket detail route | unchanged |
| 486 | SupportTicketDetailPage | Send reply _[action]_ | api.support.addReply(id, body) | kept — ticket detail route | unchanged |
| 487 | SupportTicketDetailPage | Retry load on failure _[action]_ | api.support.get(id) | kept — ticket detail route | unchanged |
| 488 | SupportTicketDetailPage | Back to /support-tickets _[nav]_ | react-router | kept — ticket detail route | unchanged |
| 489 | SystemAlertsPage (/system-alerts, admin/support_admin/superadmin) | Total/Enabled/Silenced/Triggered counts _[figure]_ | api.systemAlertRules.list() (derived) | /console?section=alerts | unchanged |
| 490 | SystemAlertsPage | Alert rules list _[figure]_ | api.systemAlertRules.list() | /console?section=alerts | unchanged |
| 491 | SystemAlertsPage | Recently-triggered rules _[figure]_ | api.systemAlertRules.list() (derived) | /console?section=alerts | unchanged |
| 492 | SystemAlertsPage | Create rule _[action]_ | api.systemAlertRules.create() | /console?section=alerts | unchanged |
| 493 | SystemAlertsPage | Edit/update rule _[action]_ | api.systemAlertRules.update(id, payload) | /console?section=alerts | unchanged |
| 494 | SystemAlertsPage | Toggle rule enabled _[action]_ | api.systemAlertRules.update(id,{enabled}) | /console?section=alerts | unchanged |
| 495 | SystemAlertsPage | Delete rule _[action]_ | api.systemAlertRules.remove(id) | /console?section=alerts | unchanged |
| 496 | SystemAlertsPage | Silence rule (preset/custom) _[action]_ | api.systemAlertRules.silence(id, until) | /console?section=alerts | unchanged |
| 497 | SystemAlertsPage | Clear silence _[action]_ | api.systemAlertRules.silence(id, null) | /console?section=alerts | unchanged |
| 498 | SystemAlertsPage | Run synthetic test _[action]_ | api.systemAlertRules.test(id, payload) | /console?section=alerts | unchanged |
| 499 | SystemAlertsPage | Tabs: rules / active _[nav]_ | (client state) | /console?section=alerts | unchanged |
| 500 | TenantManagementPage (/admin/tenants, superadmin) | Tenant list _[figure]_ | api.get('/api/v1/admin/tenants') [raw] | /console?section=tenant-admin | unchanged |
| 501 | TenantManagementPage | Stats: total/active/deleted/totalRuns/totalUsers _[figure]_ | derived from list | /console?section=tenant-admin | unchanged |
| 502 | TenantManagementPage | Tenant detail (users/runs/metrics/risks/clusters/runItems/healthScores/briefings) _[figure]_ | api.get('/api/v1/admin/tenants/:id') [raw] | /console?section=tenant-admin | unchanged |
| 503 | TenantManagementPage | Soft-delete tenant _[action]_ | api.post('/api/v1/admin/tenants/:id/soft-delete') [raw] | /console?section=tenant-admin | unchanged |
| 504 | TenantManagementPage | Reactivate tenant _[action]_ | api.post('/api/v1/admin/tenants/:id/reactivate') [raw] | /console?section=tenant-admin | unchanged |
| 505 | TenantManagementPage | Hard-delete tenant (permanent) _[action]_ | api.delete('/api/v1/admin/tenants/:id/hard-delete') [raw] | /console?section=tenant-admin | unchanged |
| 506 | TenantManagementPage | Export tenant data (JSON) _[export]_ | api.get('/api/v1/admin/tenants/:id/export') [raw] | /console?section=tenant-admin | unchanged |
| 507 | TenantManagementPage | Search + filter (all/active/deleted) _[action]_ | (client state) | /console?section=tenant-admin | unchanged |
| 508 | TenantManagementPage | LLM Budget & Redaction _[nav]_ | /admin/tenants/:id/llm | /console?section=tenant-admin | unchanged |
| 509 | TenantsPage (/tenants) | Hero: total/active, SaaS/On-Premise/Hybrid counts _[figure]_ | api.tenants.list() (derived) | /console?section=clients | unchanged |
| 510 | TenantsPage | Tenant table (name/deployment/plan/industry/region/status) _[figure]_ | api.tenants.list() | /console?section=clients | unchanged |
| 511 | TenantsPage | Expanded detail: layers/catalysts/agents/users/entitlements/infra _[figure]_ | api.tenants.list() | /console?section=clients | unchanged |
| 512 | TenantsPage | Onboard/create tenant _[action]_ | api.tenants.create() | /console?section=clients | unchanged |
| 513 | TenantsPage | Manage users: list _[figure]_ | api.iam.users(tenantId) | /console?section=clients | unchanged |
| 514 | TenantsPage | Add user _[action]_ | api.iam.createUser() | /console?section=clients | unchanged |
| 515 | TenantsPage | Update user role _[action]_ | api.iam.updateUser() | /console?section=clients | unchanged |
| 516 | TenantsPage | Resend welcome / reset password _[action]_ | api.iam.resendWelcome() | /console?section=clients | unchanged |
| 517 | TenantsPage | Deploy single catalyst cluster _[action]_ | api.catalysts.createCluster() | /console?section=clients | unchanged |
| 518 | TenantsPage | Load industry templates _[figure]_ | api.catalysts.templates() | /console?section=clients | unchanged |
| 519 | TenantsPage | Deploy template clusters _[action]_ | api.catalysts.deployTemplate() | /console?section=clients | unchanged |
| 520 | TenantsPage | Load tenant clusters (manage) _[figure]_ | api.catalysts.clusters(tenantId) | /console?section=clients | unchanged |
| 521 | TenantsPage | Toggle sub-catalyst _[action]_ | api.catalysts.toggleSubCatalyst() | /console?section=clients | unchanged |
| 522 | TenantsPage | Set data source _[action]_ | api.catalysts.setDataSource() | /console?section=clients | unchanged |
| 523 | TenantsPage | Remove data source _[action]_ | api.catalysts.removeDataSource() | /console?section=clients | unchanged |
| 524 | TenantsPage | Delete cluster _[action]_ | api.catalysts.deleteCluster() | /console?section=clients | unchanged |
| 525 | TenantsPage | Reset company _[action]_ | api.tenants.reset() | /console?section=clients | unchanged |
| 526 | TenantsPage | Delete company _[action]_ | api.tenants.delete() | /console?section=clients | unchanged |
| 527 | TenantsPage | Archive company _[action]_ | api.tenants.archive() | /console?section=clients | unchanged |
| 528 | TenantsPage | Unarchive company _[action]_ | api.tenants.unarchive() | /console?section=clients | unchanged |
| 529 | TenantsPage | Re-seed VantaX demo _[action]_ | api.tenants.seedVantax() | /console?section=clients | unchanged |
| 530 | TenantsPage | Edit entitlements _[action]_ | api.tenants.updateEntitlements() | /console?section=clients | unchanged |
| 531 | TenantsPage | Tabs: overview / entitlements (plan comparison) / infrastructure _[nav]_ | (client state) | /console?section=clients | unchanged |
| 532 | TrialPage (/trial, public) | Start trial (company info) _[action]_ | api.trial.start() | public route, unchanged | unchanged |
| 533 | TrialPage | Upload CSV data _[action]_ | api.trial.upload(id, {domains}) | public route, unchanged | unchanged |
| 534 | TrialPage | Run assessment _[action]_ | api.trial.run(id) | public route, unchanged | unchanged |
| 535 | TrialPage | Poll status (progress/currentStep) _[figure]_ | api.trial.status(id) | public route, unchanged | unchanged |
| 536 | TrialPage | Results: detected exposure, findings, exposure-by-area, health score _[figure]_ | api.trial.results(id) | public route, unchanged | unchanged |
| 537 | TrialPage | Download Full Report (txt) _[export]_ | api.trial.report(id) | public route, unchanged | unchanged |
| 538 | TrialPage | Download column template _[export]_ | downloadTemplate(domain) (client) | public route, unchanged | unchanged |
| 539 | TrialPage | Book a call CTA _[nav]_ | /#cta-s | public route, unchanged | unchanged |
| 540 | TrialPage | Back to Home _[nav]_ | / | public route, unchanged | unchanged |
| 541 | TrustPerformancePage (/trust) | Calibration accuracy hero + predictions/outcomes/calibrated subs/predicted value _[figure]_ | api.catalysts.getCalibrationSummary() | /x#ledger trust/proof block (calibration, provenance) | open |
| 542 | TrustPerformancePage | Provenance root / sequence / last appended _[figure]_ | api.provenance.root() | /x#ledger trust/proof block (calibration, provenance) | open |
| 543 | TrustPerformancePage | Peer benchmark active patterns + list _[figure]_ | api.peerPatterns.list('general') | /x#ledger trust/proof block (calibration, provenance) | open |
| 544 | TrustPerformancePage | Verify chain _[action]_ | api.provenance.verify() | /x#ledger trust/proof block (calibration, provenance) | open |
| 545 | TrustPerformancePage | Refresh all _[action]_ | getCalibrationSummary + provenance.root + peerPatterns.list | /x#ledger trust/proof block (calibration, provenance) | open |
| 546 | VerifyEmailPage (/verify-email, public) | Verify email token _[action]_ | fetch POST /api/auth/verify-email [raw] | public route, unchanged | unchanged |
| 547 | VerifyEmailPage | Resend verification email _[action]_ | fetch POST /api/auth/resend-verification [raw] | public route, unchanged | unchanged |
| 548 | VerifyEmailPage | Go to login / back to login _[nav]_ | /login | public route, unchanged | unchanged |
| 549 | WebhooksPage (/webhooks, /webhooks/:id) | Webhook list (url/events/status/success rate/last delivery) _[figure]_ | api.webhooks.list() | /console?section=webhooks | unchanged |
| 550 | WebhooksPage | Log rail (focused webhook state + subscription preview) _[figure]_ | api.webhooks.list() (fields) | /console?section=webhooks | unchanged |
| 551 | WebhooksPage | Webhook detail (overview/events/secret masked) _[figure]_ | api.webhooks.get(id) | /console?section=webhooks | unchanged |
| 552 | WebhooksPage | Deliveries table _[figure]_ | WebhookDeliveriesTable → api.webhooks deliveries | /console?section=webhooks | unchanged |
| 553 | WebhooksPage | Create webhook (wizard) _[action]_ | api.webhooks.create() (WebhookCreateWizard) | /console?section=webhooks | unchanged |
| 554 | WebhooksPage | Revoke/delete webhook _[action]_ | api.webhooks.delete(id) | /console?section=webhooks | unchanged |
| 555 | WebhooksPage | Send test payload _[action]_ | api.webhooks.test(id) | /console?section=webhooks | unchanged |
| 556 | WebhooksPage | Receiver docs + copy Node/Python snippet _[action]_ | none (client, navigator.clipboard) | /console?section=webhooks | unchanged |
| 557 | WebhooksPage | Open detail / deep link /webhooks/:id _[nav]_ | react-router | /console?section=webhooks | unchanged |

_[raw] flags in API cells mark direct `api.get/post` calls (off the typed SDK contract) noted during the audit._
