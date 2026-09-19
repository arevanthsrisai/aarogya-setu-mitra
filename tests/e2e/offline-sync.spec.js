const { test, expect } = require('@playwright/test');

test.describe('Offline & Sync Indicator', () => {
  test('Verify sync indicator displays Online status', async ({ page }) => {
    await page.goto('/');
    await page.click('text=ASHA Worker');
    await expect(page.locator('#sync-status')).toContainText('Online');
  });
});
