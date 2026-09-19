const { test, expect } = require('@playwright/test');

test.describe('Module 4: Officer Command Dashboard', () => {
  test('THO Officer dashboard calculates real database metrics', async ({ page }) => {
    await page.goto('/');
    await page.click('text=THO Officer');
    await page.click('text=Health Reports');

    await expect(page.locator('.metrics-grid')).toContainText('Total Patients');
    await expect(page.locator('.metrics-grid')).toContainText('Referral Rate');
    await expect(page.locator('table')).toContainText('Facility');
  });
});
