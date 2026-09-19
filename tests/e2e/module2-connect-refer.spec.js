const { test, expect } = require('@playwright/test');

test.describe('Module 2: Connect & Refer', () => {
  test('Complete referral ticket state progression sequence', async ({ page }) => {
    // 1. Create referral as ASHA
    await page.goto('/');
    await page.click('text=ASHA Worker');
    await page.click('text=Doctor Referral');
    await page.click('text=+ New Referral');
    await page.fill('#ref-reason', 'High fever triage escalation');
    await page.click('button:has-text("Create Ticket")');

    await expect(page.locator('table')).toContainText('BOOKED');

    // 2. Log in as Doctor & advance referral status
    await page.click('text=Sign Out');
    await page.click('text=PHC Doctor');
    await page.click('text=Doctor Referral');
    await page.click('text=Manage');
    await page.click('button:has-text("→ SEEN")');

    await expect(page.locator('table')).toContainText('SEEN');
  });
});
