const { test, expect } = require('@playwright/test');

test.describe('Module 1: Triage & Record', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('text=ASHA Worker');
    await expect(page.locator('#topbar')).toContainText('Patient Directory');
  });

  test('Register new patient and verify persistence', async ({ page }) => {
    await page.click('text=+ Register Patient');
    await page.fill('#reg-fname', 'TestPatient');
    await page.fill('#reg-lname', 'E2E');
    await page.fill('#reg-age', '4');
    await page.selectOption('#reg-gender', 'M');
    await page.click('button:has-text("Complete Registration")');

    await expect(page.locator('#content')).toContainText('TestPatient E2E');
    await expect(page.locator('#content')).toContainText('ID:');
  });

  test('Execute severe anemia triage and verify HIGH risk alert', async ({ page }) => {
    await page.click('text=Health Symptom Check');
    await page.fill('#tr-hb', '6.2');
    await page.click('button:has-text("Execute Clinical Rule Evaluation")');

    await expect(page.locator('#triage-result-container')).toContainText('HIGH RISK');
    await expect(page.locator('#triage-result-container')).toContainText('Route to Teleconsultation');
  });
});
