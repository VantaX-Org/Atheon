# Traceability Architecture: Catalyst → Pulse → Apex

## Overview

This document describes the traceability chain that allows users to drill down from high-level insights (Apex layer) back to the detailed execution data (Cataulyst/Sub-Catalyst layer). This enables root cause analysis when issues are detected.

## Layer Architecture

### 1. **Cataulyst/Sub-Cataulyst Layer** (Execution)
- **Tables**: `catalyst_actions`, `sub_cataulyst_runs`, `sub_cataulyst_run_items`, `sub_cataulyst_kpi_definitions`, `sub_cataulyst_kpi_values`
- **Purpose**: Executes business logic, reconciles data, calculates KPIs
- **Key Data**: Run results, item-level discrepancies, exceptions, KPI values

### 2. **Pulse Layer** (Monitoring)
- **Tables**: `process_metrics`, `anomalies`, `correlation_events`, `process_flows`
- **Purpose**: Monitors process performance, detects anomalies
- **Key Data**: Metrics with trends, anomaly alerts, correlations

### 3. **Apex Layer** (Executive Insights)
- **Tables**: `health_scores`, `health_score_history`, `executive_briefings`, `risk_alerts`, `scenarios`
- **Purpose**: Provides business health scores, executive briefings, risk alerts
- **Key Data**: Overall health score, dimension scores, risk alerts, briefings

## Traceability Chain

```
Apex (Health Score: 75/100)
  ↓
Dimension Drill-down (e.g., "Operational Efficiency: 70/100")
  ↓
Contributing Clusters (e.g., "Finance", "Procurement")
  ↓
Sub-Cataulysts (e.g., "Invoice Reconciliation", "PO Matching")
  ↓
KPIs (e.g., "Match Rate: 85%", "Exception Rate: 12%")
  ↓
Runs (e.g., Run #45, Run #44)
  ↓
Items (e.g., Invoice INV-2024-001 with discrepancy)
```

## New Traceability Endpoints

### Apex Layer Endpoints

#### 1. `GET /api/apex/health/dimensions/:dimension`
Drill down into a specific health dimension to see what's driving the score.

**Path Parameters:**
- `dimension`: One of `financial`, `operational`, `compliance`, `strategic`, `technology`, `risk`, `catalyst`, `process`

**Response:**
```json
{
  "dimension": "operational",
  "score": 70,
  "trend": "declining",
  "delta": -5.2,
  "contributors": ["invoice-reconciliation", "finance"],
  "sourceRunId": "run-abc123",
  "catalystName": "finance",
  "kpiContributors": [
    {"name": "Match Rate", "value": 85, "status": "amber"},
    {"name": "Exception Rate", "value": 12, "status": "red"}
  ],
  "traceability": {
    "contributingClusters": [...],
    "recentRuns": [...],
    "relevantKpis": [...]
  },
  "drillDownPath": {
    "dimension": "operational",
    "clusters": ["cluster-xyz"],
    "subCataulysts": ["invoice-reconciliation"],
    "runs": ["run-abc123"],
    "items": "Use GET /api/cataulysts/runs/:runId/items"
  }
}
```

#### 2. `GET /api/apex/risks/:riskId/trace`
Trace a risk alert back to its source run and items.

**Path Parameters:**
- `riskId`: The risk alert ID

**Response:**
```json
{
  "riskAlert": {...},
  "sourceAttribution": {
    "sourceRunId": "run-abc123",
    "clusterId": "cluster-xyz",
    "subCataulystName": "invoice-reconciliation"
  },
  "sourceRun": {...},
  "cluster": {...},
  "contributingKpis": [...],
  "flaggedItems": [
    {
      "itemNumber": 42,
      "status": "discrepancy",
      "severity": "high",
      "sourceRef": "INV-2024-001",
      "field": "total",
      "sourceValue": 1000,
      "targetValue": 950,
      "difference": "50"
    }
  ],
  "drillDownPath": {
    "risk": "ra-123",
    "run": "run-abc123",
    "items": "GET /api/cataulysts/runs/run-abc123/items?status=discrepancy",
    "cluster": "cluster-xyz"
  }
}
```

### Pulse Layer Endpoints

#### 3. `GET /api/pulse/metrics/:metricId/trace`
Trace a process metric back to its source sub-cataulyst run.

**Path Parameters:**
- `metricId`: The process metric ID

**Response:**
```json
{
  "metric": {
    "id": "pm-tenant-finance-success",
    "name": "Finance Success Rate",
    "value": 85,
    "status": "amber",
    "trend": [80, 82, 85, 83, 85]
  },
  "sourceAttribution": {
    "subCataulystName": "invoice-reconciliation",
    "sourceRunId": "run-abc123",
    "clusterId": "cluster-xyz"
  },
  "sourceRun": {...},
  "cluster": {...},
  "contributingKpis": [...],
  "relatedAnomalies": [...],
  "drillDownPath": {
    "metric": "pm-tenant-finance-success",
    "run": "run-abc123",
    "items": "GET /api/cataulysts/runs/run-abc123/items",
    "kpis": "GET /api/cataulysts/clusters/cluster-xyz/sub-cataulysts/invoice-reconciliation/kpi-definitions"
  }
}
```

## Enhanced Dimension Tracking

When `generateInsightsForTenant` runs, it now stores detailed contributor information in the `dimensions` object:

```typescript
{
  "operational": {
    "score": 70,
    "trend": "declining",
    "delta": -5.2,
    "contributors": ["invoice-reconciliation"],
    "sourceRunId": "run-abc123",
    "catalystName": "finance",
    "kpiContributors": [
      {"name": "Match Rate", "value": 85, "status": "amber"},
      {"name": "Exception Rate", "value": 12, "status": "red"}
    ],
    "lastUpdated": "2024-01-15T10:30:00Z"
  }
}
```

## Domain-to-Dimension Mapping

The system uses a mapping table to determine which health dimensions are affected by each catalyst domain:

| Domain | Dimensions |
|--------|-----------|
| `finance` | `financial` |
| `procurement` | `operational`, `financial` |
| `hr` | `operational`, `strategic` |
| `mining-safety` | `compliance` |
| `tech-devops` | `technology` |
| `mfg-production` | `operational` |

This mapping is defined in `catalysts.ts` as `domainToDimensions()` and is used to:
1. Determine which dimensions to update when a catalyst runs
2. Filter clusters/KPIs in drill-down endpoints

## Usage Example: Root Cause Analysis

**Scenario**: A user sees a declining "Operational Efficiency" health score.

**Step 1**: Call `GET /api/apex/health/dimensions/operational`
- Returns dimension score: 70/100 (declining)
- Shows contributing sub-cataulysts: "invoice-reconciliation"
- Shows KPI contributors: Match Rate 85% (amber), Exception Rate 12% (red)

**Step 2**: Call `GET /api/pulse/metrics/pm-tenant-invoice-success/trace`
- Shows the metric is sourced from run "run-abc123"
- Lists contributing KPIs and related anomalies

**Step 3**: Call `GET /api/cataulysts/runs/run-abc123/items?status=exception`
- Shows the 15 items that raised exceptions
- Identifies the root cause: supplier master data mismatch

**Step 4**: Call `GET /api/apex/risks/ra-123/trace`
- Shows the risk alert raised from this run
- Links to the specific items causing the issue

## Database Schema Enhancements

The following tables have been enhanced with source attribution fields:

### `process_metrics`
- `sub_cataulyst_name`: The sub-cataulyst that generated this metric
- `source_run_id`: The specific run ID
- `cluster_id`: The cluster ID

### `risk_alerts`
- `sub_cataulyst_name`: The sub-cataulyst that triggered the risk
- `source_run_id`: The run that identified the risk
- `cluster_id`: The cluster ID

### `health_score_history`
- `source_run_id`: The run that triggered the health score update
- `catalyst_name`: The catalyst domain

## Implementation Notes

1. **Backward Compatibility**: All new fields are optional and default to `null` for backward compatibility
2. **Performance**: Traceability queries use indexed lookups on `tenant_id`, `cluster_id`, `source_run_id`
3. **Data Retention**: Source attribution data follows the same retention policy as the parent records

## Future Enhancements

1. **Correlation Graph**: Visualize relationships between metrics, KPIs, and health dimensions
2. **Automated Root Cause Suggestions**: Use LLM to suggest likely causes based on trace patterns
3. **Cross-Tenant Benchmarking**: Compare trace patterns across tenants for anomaly detection
4. **Real-time Trace Streaming**: WebSocket endpoint for live trace updates during catalyst execution
