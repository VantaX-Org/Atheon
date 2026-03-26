# Tenant Management & Cleanup Guide

## Overview

This guide covers tenant administration, soft-delete, data export, and cleanup procedures for the Atheon platform.

**Access Level:** Superadmin only  
**UI Path:** `/admin/tenants` (when logged in as superadmin)  
**API Base:** `/api/v1/admin/tenants`

---

## Table of Contents

1. [Tenant Management UI](#1-tenant-management-ui)
2. [API Endpoints](#2-api-endpoints)
3. [Soft-Delete Process](#3-soft-delete-process)
4. [Data Export](#4-data-export)
5. [Hard-Delete Process](#5-hard-delete-process)
6. [Cleanup Scripts](#6-cleanup-scripts-sql)
7. [Best Practices](#7-best-practices)

---

## 1. Tenant Management UI

### Access

1. Login as superadmin (`reshigan@gonxt.tech` or equivalent)
2. Navigate to `https://atheon.vantax.co.za/admin/tenants`
3. View all tenants with statistics

### Features

**Dashboard View:**
- Total tenants count
- Active vs deleted tenants
- Total runs across all tenants
- Total users across all tenants

**Tenant List:**
- Search by name or slug
- Filter: All / Active / Deleted
- View: Name, slug, plan, status, runs, users, created date
- Actions: View details, Export data

**Tenant Details:**
- Full tenant information
- Data statistics (users, clusters, runs, metrics, risks, etc.)
- Administrative actions (soft-delete, reactivate, export, hard-delete)

---

## 2. API Endpoints

### List All Tenants

```bash
GET /api/v1/admin/tenants
Authorization: Bearer <superadmin_token>
```

**Response:**
```json
{
  "success": true,
  "tenants": [
    {
      "id": "uuid",
      "name": "VantaX (Pty) Ltd",
      "slug": "vantax",
      "is_deleted": false,
      "data": {
        "runs": 10,
        "metrics": 6,
        "risks": 4,
        "users": 5
      }
    }
  ],
  "total": 3,
  "active": 2,
  "deleted": 1
}
```

### Get Tenant Details

```bash
GET /api/v1/admin/tenants/:id
Authorization: Bearer <superadmin_token>
```

### Soft-Delete Tenant

```bash
POST /api/v1/admin/tenants/:id/soft-delete
Authorization: Bearer <superadmin_token>
```

**Effects:**
- Sets `deleted_at` timestamp
- Sets `deleted_by` user ID
- Changes status to `suspended`
- Suspends all tenant users
- **Data remains intact**

**Response:**
```json
{
  "success": true,
  "message": "Tenant \"Test Corp\" has been soft-deleted",
  "tenant": {
    "id": "uuid",
    "name": "Test Corp",
    "slug": "test-corp",
    "deletedAt": "2025-01-27T10:30:00Z",
    "deletedBy": "user-uuid"
  }
}
```

### Reactivate Tenant

```bash
POST /api/v1/admin/tenants/:id/reactivate
Authorization: Bearer <superadmin_token>
```

**Effects:**
- Clears `deleted_at` and `deleted_by`
- Sets status to `active`
- Reactivates all tenant users

### Export Tenant Data

```bash
GET /api/v1/admin/tenants/:id/export
Authorization: Bearer <superadmin_token>
```

**Downloads:** JSON file with all tenant data

**Contents:**
- Tenant metadata
- All users
- All clusters and sub-catalysts
- All runs and run items
- All metrics, risks, health scores
- All executive briefings

### Hard-Delete Tenant (Permanent)

```bash
DELETE /api/v1/admin/tenants/:id/hard-delete
Authorization: Bearer <superadmin_token>
```

**Requirements:**
- Tenant must be soft-deleted first
- Must wait 24 hours after soft-delete
- Superadmin confirmation required

**Effects:**
- Permanently deletes ALL tenant data
- Removes tenant record
- Cannot be undone

---

## 3. Soft-Delete Process

### When to Use

- Tenant subscription expired
- Tenant requested account suspension
- Testing cleanup
- Temporary deactivation

### Process (UI)

1. Navigate to `/admin/tenants`
2. Find tenant in list
3. Click "View Details" (eye icon)
4. Click "Soft-Delete Tenant"
5. Confirm the action
6. Tenant marked as deleted, data preserved

### Process (API)

```bash
curl -X POST https://atheon.vantax.co.za/api/v1/admin/tenants/UUID/soft-delete \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### After Soft-Delete

- Tenant cannot login
- All API calls return 403 for that tenant
- Data remains in database
- Can be reactivated within 24 hours (or indefinitely)
- Shows in "Deleted" filter in admin UI

---

## 4. Data Export

### When to Export

**Before Deletion:**
- Always export before hard-delete
- Compliance/legal requirements
- Backup before major changes

**Regular Backups:**
- Monthly tenant backups
- Before system upgrades
- Audit requirements

### Process (UI)

1. Navigate to `/admin/tenants`
2. Click "Export" (download icon) for tenant
3. File downloads: `tenant-export-{slug}-{date}.json`
4. Store securely

### Process (API)

```bash
curl -o tenant-export.json \
  https://atheon.vantax.co.za/api/v1/admin/tenants/UUID/export \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Export Format

```json
{
  "exportDate": "2025-01-27T10:30:00Z",
  "tenant": {
    "id": "uuid",
    "name": "Test Corp",
    "slug": "test-corp",
    "industry": "technology",
    "plan": "enterprise"
  },
  "data": {
    "users": [...],
    "clusters": [...],
    "runs": [...],
    "runItems": [...],
    "metrics": [...],
    "risks": [...],
    "healthScores": [...],
    "briefings": [...]
  },
  "summary": {
    "users": 5,
    "clusters": 3,
    "runs": 10,
    "totalRecords": 2500
  }
}
```

---

## 5. Hard-Delete Process

### ⚠️ WARNING: PERMANENT DELETION

This action **IRREVERSIBLY** deletes:
- All tenant data
- All users
- All runs, metrics, risks, health scores
- All audit logs and history
- All configurations

**Cannot be undone.**

### Requirements

1. Tenant must be soft-deleted first
2. Wait 24 hours after soft-delete (safety window)
3. Export data before deletion (recommended)
4. Superadmin confirmation required
5. Double confirmation prompt

### Process (UI)

1. Navigate to `/admin/tenants`
2. Filter by "Deleted"
3. Find tenant
4. Click "View Details"
5. Click "Permanently Delete (After 24h)"
6. Confirm warning dialog
7. Type "DELETE" when prompted
8. Deletion executes

### Process (API)

```bash
# Attempt deletion
curl -X DELETE https://atheon.vantax.co.za/api/v1/admin/tenants/UUID/hard-delete \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**If < 24 hours:**
```json
{
  "error": "Hard-delete not allowed yet",
  "message": "Please wait 18 more hours before permanent deletion",
  "deletedAt": "2025-01-26T16:30:00Z",
  "allowedAfter": "2025-01-27T16:30:00Z"
}
```

**If successful:**
```json
{
  "success": true,
  "message": "Tenant \"Test Corp\" and all associated data permanently deleted",
  "audit": {
    "deletedBy": "user-uuid",
    "deletedAt": "2025-01-27T10:30:00Z",
    "totalRecordsDeleted": 2547,
    "tablesAffected": 20
  }
}
```

---

## 6. Cleanup Scripts (SQL)

### ⚠️ Manual SQL Cleanup

For advanced scenarios or bulk operations, use these SQL scripts directly in Cloudflare D1.

**WARNING:** These bypass all safety checks. Use with extreme caution.

### List All Tenants

```sql
SELECT 
  id, name, slug, status, 
  deleted_at, created_at,
  CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END as is_deleted
FROM tenants
ORDER BY created_at DESC;
```

### Count Data Per Tenant

```sql
SELECT 
  t.id, t.name, t.slug,
  (SELECT COUNT(*) FROM sub_catalyst_runs WHERE tenant_id = t.id) as runs,
  (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as users,
  (SELECT COUNT(*) FROM process_metrics WHERE tenant_id = t.id) as metrics,
  (SELECT COUNT(*) FROM risk_alerts WHERE tenant_id = t.id) as risks
FROM tenants t
ORDER BY t.created_at DESC;
```

### Soft-Delete Specific Tenant

```sql
-- Replace UUID with actual tenant ID
UPDATE tenants 
SET deleted_at = datetime('now'), 
    deleted_by = 'superadmin-manual', 
    status = 'suspended',
    updated_at = datetime('now')
WHERE id = 'UUID' AND deleted_at IS NULL;

-- Suspend all users
UPDATE users 
SET status = 'suspended', updated_at = datetime('now')
WHERE tenant_id = 'UUID';
```

### Reactivate Tenant

```sql
-- Replace UUID with actual tenant ID
UPDATE tenants 
SET deleted_at = NULL, 
    deleted_by = NULL, 
    status = 'active',
    updated_at = datetime('now')
WHERE id = 'UUID' AND deleted_at IS NOT NULL;

-- Reactivate all users
UPDATE users 
SET status = 'active', updated_at = datetime('now')
WHERE tenant_id = 'UUID';
```

### Export Tenant Data (Manual)

```sql
-- Run these queries and save results as JSON

-- Tenant info
SELECT * FROM tenants WHERE id = 'UUID';

-- Users
SELECT * FROM users WHERE tenant_id = 'UUID';

-- Clusters
SELECT * FROM catalyst_clusters WHERE tenant_id = 'UUID';

-- Runs
SELECT * FROM sub_catalyst_runs WHERE tenant_id = 'UUID';

-- Run items
SELECT * FROM sub_catalyst_run_items WHERE tenant_id = 'UUID';

-- Metrics
SELECT * FROM process_metrics WHERE tenant_id = 'UUID';

-- Risks
SELECT * FROM risk_alerts WHERE tenant_id = 'UUID';

-- Health scores
SELECT * FROM health_scores WHERE tenant_id = 'UUID';

-- Briefings
SELECT * FROM executive_briefings WHERE tenant_id = 'UUID';
```

### Hard-Delete Tenant (Manual SQL)

```sql
-- ⚠️ PERMANENT DELETION - CANNOT BE UNDONE ⚠️
-- Replace UUID with actual tenant ID
-- Export data first!

-- Delete in order (respecting foreign keys)
DELETE FROM sub_catalyst_run_items WHERE tenant_id = 'UUID';
DELETE FROM run_comments WHERE tenant_id = 'UUID';
DELETE FROM sub_catalyst_kpi_values WHERE tenant_id = 'UUID';
DELETE FROM sub_catalyst_runs WHERE tenant_id = 'UUID';
DELETE FROM catalyst_run_analytics WHERE tenant_id = 'UUID';
DELETE FROM health_score_history WHERE tenant_id = 'UUID';
DELETE FROM health_scores WHERE tenant_id = 'UUID';
DELETE FROM risk_alerts WHERE tenant_id = 'UUID';
DELETE FROM anomalies WHERE tenant_id = 'UUID';
DELETE FROM process_metrics WHERE tenant_id = 'UUID';
DELETE FROM process_flows WHERE tenant_id = 'UUID';
DELETE FROM correlation_events WHERE tenant_id = 'UUID';
DELETE FROM catalyst_actions WHERE tenant_id = 'UUID';
DELETE FROM executive_briefings WHERE tenant_id = 'UUID';
DELETE FROM scenarios WHERE tenant_id = 'UUID';
DELETE FROM run_insights WHERE tenant_id = 'UUID';
DELETE FROM sub_catalyst_kpis WHERE tenant_id = 'UUID';
DELETE FROM sub_catalyst_kpi_definitions WHERE tenant_id = 'UUID';
DELETE FROM catalyst_clusters WHERE tenant_id = 'UUID';
DELETE FROM users WHERE tenant_id = 'UUID';
DELETE FROM tenants WHERE id = 'UUID';

-- Verify deletion
SELECT COUNT(*) as remaining FROM tenants WHERE id = 'UUID';
-- Should return 0
```

### Bulk Cleanup: Delete All Test Tenants

```sql
-- ⚠️ DANGER: Deletes multiple tenants at once ⚠️
-- Only run on development/demo environments
-- NEVER run on production with customer data

-- List tenants to be deleted
SELECT id, name, slug, created_at 
FROM tenants 
WHERE slug LIKE 'test-%' OR slug LIKE 'demo-%' OR name LIKE 'Test%';

-- If confirmed, soft-delete first
UPDATE tenants 
SET deleted_at = datetime('now'), 
    deleted_by = 'bulk-cleanup-script', 
    status = 'suspended'
WHERE slug LIKE 'test-%' OR slug LIKE 'demo-%';

-- Wait 24 hours, then hard-delete (run individual DELETE statements above)
```

---

## 7. Best Practices

### Safety First

1. **Always export before delete** - Backup tenant data before any deletion
2. **Soft-delete first** - Use soft-delete as a safety buffer
3. **Wait 24 hours** - Allows recovery if deletion was accidental
4. **Double confirmation** - Require multiple confirmations for hard-delete
5. **Audit logging** - All deletions are logged with user ID and timestamp

### Production vs Development

**Production:**
- Never delete without customer confirmation
- Export data before any operation
- Follow legal/compliance requirements
- Document all deletions

**Development/Demo:**
- Safe to clean up test tenants
- Use bulk scripts for efficiency
- Still export important test data

### VantaX Demo Tenant

The VantaX tenant (`slug: 'vantax'`) is **protected** from deletion:

- Cannot be soft-deleted via UI
- Seeder endpoint resets data instead
- Use `/api/v1/seed-vantax` to refresh demo data

### Monitoring

**Regular Checks:**
```bash
# Weekly: Check tenant counts
curl https://atheon.vantax.co.za/api/v1/admin/tenants \
  -H "Authorization: Bearer TOKEN"

# Monitor deleted tenants
# Filter by is_deleted: true in UI
```

**Alerts to Set Up:**
- Sudden increase in deleted tenants
- Large tenants being deleted (>1000 runs)
- Failed deletion attempts

### Compliance

**GDPR/POPIA:**
- Export data before deletion (right to portability)
- Hard-delete removes all personal data (right to erasure)
- Audit logs track who deleted what and when

**Data Retention:**
- Keep exports for X years (per legal requirements)
- Document deletion reasons
- Maintain audit trail

---

## Quick Reference

### UI Path
```
https://atheon.vantax.co.za/admin/tenants
```

### API Endpoints
```
GET    /api/v1/admin/tenants              # List all
GET    /api/v1/admin/tenants/:id          # Get details
POST   /api/v1/admin/tenants/:id/soft-delete    # Soft-delete
POST   /api/v1/admin/tenants/:id/reactivate     # Reactivate
GET    /api/v1/admin/tenants/:id/export   # Export data
DELETE /api/v1/admin/tenants/:id/hard-delete    # Permanent delete
```

### Common Workflows

**Cleanup Test Tenant:**
1. Export data (optional but recommended)
2. Soft-delete tenant
3. Wait 24 hours
4. Hard-delete tenant

**Suspend Problem Tenant:**
1. Soft-delete tenant
2. Investigate issue
3. Reactivate if resolved, or hard-delete after 24h

**Refresh VantaX Demo:**
1. Use seeder: `POST /api/v1/seed-vantax`
2. Do NOT delete VantaX tenant

---

## Troubleshooting

### "Access denied: Superadmin only"
- Ensure logged in as superadmin role
- Check token hasn't expired

### "Tenant must be soft-deleted first"
- Soft-delete the tenant, wait for confirmation
- Then attempt hard-delete after 24 hours

### "Cannot delete VantaX demo tenant"
- This is intentional protection
- Use seeder endpoint to reset instead

### Export file is empty or corrupted
- Check tenant has data
- Try API export instead of UI
- Verify network connection

---

**Last Updated:** 2025-01-27  
**Version:** 1.0  
**Author:** Atheon Platform Team
