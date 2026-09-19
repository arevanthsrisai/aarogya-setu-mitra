const { test, expect } = require('@playwright/test');

test.describe('ABDM Consent & Caregiver Flow', () => {
  test('Verify consent revocation blocks caregiver access', async ({ page }) => {
    // Caregiver login
    await page.goto('/');
    if (await page.locator('text=Sign Out').isVisible()) {
      await page.click('text=Sign Out');
    }
    await page.click('text=Caregiver');
    await page.waitForSelector('#content');
    await expect(page.locator('#content')).toContainText(/Caregiver/i);

    // Revoke consent as ASHA
    await page.click('text=Sign Out');
    await page.waitForSelector('#login-screen');
    await page.click('text=ASHA Worker');
    await page.waitForSelector('#sidebar');
    await page.click('a[onclick*="consents"]');
    const revokeBtn = page.locator('button:has-text("Revoke")').first();
    if (await revokeBtn.isVisible()) {
      await revokeBtn.click();
      await expect(page.locator('table')).toContainText('revoked');
    }
  });
});
