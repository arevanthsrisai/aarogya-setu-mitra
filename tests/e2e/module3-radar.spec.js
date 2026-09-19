const { test, expect } = require('@playwright/test');

test.describe('Module 3: RADAR Directory', () => {
  test('Query real-time doctor availability and medicine stock', async ({ page }) => {
    await page.goto('/');
    await page.click('text=ASHA Worker');
    await page.click('text=Hospitals & Stock');
    await page.click('button:has-text("Query Directory")');

    await expect(page.locator('#radar-results')).toContainText('Facilities');
    await expect(page.locator('#radar-results')).toContainText('Medicine Stock');
  });
});
