import { test, expect } from '@playwright/test';

test.describe('Traceability Chain', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'admin@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL(/\/dashboard/);
  });

  test('should display Apex health dashboard with dimensions', async ({ page }) => {
    await page.goto('/apex');
    
    // Wait for health score to load
    await expect(page.locator('[data-testid="health-score"]')).toBeVisible({ timeout: 10000 });
    
    // Check that dimensions are displayed
    const dimensions = ['Financial', 'Operational', 'Compliance', 'Strategic', 'Technology'];
    for (const dimension of dimensions) {
      await expect(page.locator(`text=${dimension}`)).toBeVisible();
    }
  });

  test('should drill down from Apex dimension to traceability modal', async ({ page }) => {
    await page.goto('/apex');
    
    // Wait for health score to load
    await expect(page.locator('[data-testid="health-score"]')).toBeVisible({ timeout: 10000 });
    
    // Click on a dimension to open traceability modal
    const dimensionBtn = page.locator('[data-testid="dimension-operational"]');
    if (await dimensionBtn.isVisible()) {
      await dimensionBtn.click();
      
      // Wait for traceability modal to open
      await expect(page.locator('[data-testid="traceability-modal"]')).toBeVisible();
      
      // Check modal content
      await expect(page.locator('text=Source Attribution')).toBeVisible();
      await expect(page.locator('text=Drill-down Path')).toBeVisible();
      
      // Close modal
      await page.click('[data-testid="close-modal"]');
      await expect(page.locator('[data-testid="traceability-modal"]')).not.toBeVisible();
    }
  });

  test('should trace risk alerts to source runs', async ({ page }) => {
    await page.goto('/apex');
    await page.click('[data-testid="tab-risks"]');
    
    // Wait for risks list to load
    await expect(page.locator('[data-testid="risks-list"]')).toBeVisible({ timeout: 10000 });
    
    // Find first risk and click trace button
    const traceBtn = page.locator('[data-testid="trace-risk"]').first();
    if (await traceBtn.isVisible()) {
      await traceBtn.click();
      
      // Wait for traceability modal
      await expect(page.locator('[data-testid="traceability-modal"]')).toBeVisible();
      
      // Check risk trace content
      await expect(page.locator('text=Source Run')).toBeVisible();
      await expect(page.locator('text=Flagged Items')).toBeVisible();
      
      // Check drill-down path
      await expect(page.locator('text=View Run')).toBeVisible();
    }
  });

  test('should display Pulse metrics dashboard', async ({ page }) => {
    await page.goto('/pulse');
    
    // Wait for metrics to load
    await expect(page.locator('[data-testid="metrics-list"]')).toBeVisible({ timeout: 10000 });
    
    // Check metrics are displayed with status
    const metrics = page.locator('[data-testid="metric-item"]');
    const count = await metrics.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should trace metric to source sub-catalyst run', async ({ page }) => {
    await page.goto('/pulse');
    
    // Wait for metrics to load
    await expect(page.locator('[data-testid="metrics-list"]')).toBeVisible({ timeout: 10000 });
    
    // Find first metric and click trace button
    const traceBtn = page.locator('[data-testid="trace-metric"]').first();
    if (await traceBtn.isVisible()) {
      await traceBtn.click();
      
      // Wait for traceability modal
      await expect(page.locator('[data-testid="traceability-modal"]')).toBeVisible();
      
      // Check metric trace content
      await expect(page.locator('text=Source Attribution')).toBeVisible();
      await expect(page.locator('text=Contributing KPIs')).toBeVisible();
      await expect(page.locator('text=Related Anomalies')).toBeVisible();
    }
  });

  test('should navigate from traceability modal to run detail', async ({ page }) => {
    await page.goto('/pulse');
    
    // Wait for metrics to load
    await expect(page.locator('[data-testid="metrics-list"]')).toBeVisible({ timeout: 10000 });
    
    // Open metric trace
    const traceBtn = page.locator('[data-testid="trace-metric"]').first();
    if (await traceBtn.isVisible()) {
      await traceBtn.click();
      await expect(page.locator('[data-testid="traceability-modal"]')).toBeVisible();
      
      // Click View Run button
      const viewRunBtn = page.locator('[data-testid="view-run"]');
      if (await viewRunBtn.isVisible()) {
        await viewRunBtn.click();
        
        // Should navigate to catalyst run detail page
        await page.waitForURL(/\/catalysts\/runs\/.+/);
        await expect(page.locator('[data-testid="run-detail"]')).toBeVisible();
      }
    }
  });

  test('should display Catalyst runs with traceability navigation', async ({ page }) => {
    await page.goto('/catalysts');
    
    // Wait for runs list to load
    await expect(page.locator('[data-testid="runs-list"]')).toBeVisible({ timeout: 10000 });
    
    // Check runs are displayed with status
    const runs = page.locator('[data-testid="run-item"]');
    const count = await runs.count();
    
    if (count > 0) {
      // Click on first run to view detail
      await runs.first().click();
      await page.waitForURL(/\/catalysts\/runs\/.+/);
      
      // Check run detail page
      await expect(page.locator('[data-testid="run-detail"]')).toBeVisible();
      await expect(page.locator('text=KPIs')).toBeVisible();
      await expect(page.locator('text=Items')).toBeVisible();
    }
  });

  test('should display complete drill-down path in traceability modal', async ({ page }) => {
    await page.goto('/apex');
    
    // Wait for health score to load
    await expect(page.locator('[data-testid="health-score"]')).toBeVisible({ timeout: 10000 });
    
    // Open dimension trace
    const dimensionBtn = page.locator('[data-testid="dimension-operational"]');
    if (await dimensionBtn.isVisible()) {
      await dimensionBtn.click();
      await expect(page.locator('[data-testid="traceability-modal"]')).toBeVisible();
      
      // Check drill-down path badges
      await expect(page.locator('[data-testid="drill-path-dimension"]')).toBeVisible();
      await expect(page.locator('[data-testid="drill-path-clusters"]')).toBeVisible();
      await expect(page.locator('[data-testid="drill-path-runs"]')).toBeVisible();
      await expect(page.locator('[data-testid="drill-path-items"]')).toBeVisible();
    }
  });

  test('should handle missing traceability data gracefully', async ({ page }) => {
    // This test verifies error handling when no data exists
    await page.goto('/apex');
    
    // Wait for page to load
    await expect(page.locator('[data-testid="health-score"]')).toBeVisible({ timeout: 10000 });
    
    // Try to open trace for a dimension with no data
    // Should show user-friendly message instead of crashing
    const dimensionBtn = page.locator('[data-testid="dimension-compliance"]');
    if (await dimensionBtn.isVisible()) {
      await dimensionBtn.click();
      
      // Should either show modal with "no data" message or alert
      const hasModal = await page.locator('[data-testid="traceability-modal"]').isVisible({ timeout: 3000 });
      const hasAlert = await page.locator('.alert').isVisible({ timeout: 1000 });
      
      expect(hasModal || hasAlert).toBeTruthy();
    }
  });
});
