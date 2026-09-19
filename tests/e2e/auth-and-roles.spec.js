const { test, expect } = require('@playwright/test');

test.describe('Auth & RBAC Role Restrictions', () => {
  test('Verify Caregiver cannot see Health Reports in navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#login-screen, #sidebar');
    if (await page.locator('text=Sign Out').isVisible()) {
      await page.click('text=Sign Out');
      await page.waitForSelector('#login-screen');
    }
    await page.click('text=Caregiver');
    await page.waitForSelector('#sidebar');
    await expect(page.locator('#sidebar')).not.toContainText('Health Reports');
  });

  test('Verify THO Officer sees Health Reports and Activity Log', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#login-screen, #sidebar');
    if (await page.locator('text=Sign Out').isVisible()) {
      await page.click('text=Sign Out');
      await page.waitForSelector('#login-screen');
    }
    await page.click('text=THO Officer');
    await page.waitForSelector('#sidebar');
    await expect(page.locator('#sidebar')).toContainText(/health reports/i);
    await expect(page.locator('#sidebar')).toContainText(/activity log/i);
  });
});
