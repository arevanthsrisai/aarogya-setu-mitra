const { test, expect } = require('@playwright/test');

test.describe('Smoke Test — Screen Loading', () => {
  const screens = [
    { role: 'ASHA Worker', route: 'Patient Records', selector: '#topbar' },
    { role: 'ASHA Worker', route: 'Health Symptom Check', selector: '#topbar' },
    { role: 'ASHA Worker', route: 'Doctor Referral', selector: '#topbar' },
    { role: 'ASHA Worker', route: 'Mother & Baby Care', selector: '#topbar' },
    { role: 'ASHA Worker', route: 'Child Vaccine Chart', selector: '#topbar' },
    { role: 'ASHA Worker', route: 'BP & Sugar Check', selector: '#topbar' },
    { role: 'ASHA Worker', route: 'Scan Paper Report', selector: '#topbar' },
    { role: 'ASHA Worker', route: 'Hospitals & Stock', selector: '#topbar' },
    { role: 'ASHA Worker', route: 'ABDM Digital Card', selector: '#topbar' },
    { role: 'THO Officer', route: 'Health Reports', selector: '#topbar' },
    { role: 'THO Officer', route: 'Activity Log', selector: '#topbar' }
  ];

  for (const s of screens) {
    test(`Screen loads without crashing: ${s.role} -> ${s.route}`, async ({ page }) => {
      await page.goto('/');
      await page.click(`text=${s.role}`);
      await page.click(`text=${s.route}`);
      await expect(page.locator(s.selector)).toBeVisible();
    });
  }
});
