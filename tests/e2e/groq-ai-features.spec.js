const { test, expect } = require('@playwright/test');

test.describe('Groq AI Layer Features (Module F / A6 / A7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('text=ASHA Worker');
  });

  test('1. AI Health-Record Summarization (Module F)', async ({ page }) => {
    await page.click('text=Patient Records');
    await page.click('text=View Record');

    await expect(page.locator('.ai-summary-box')).toBeVisible();
    await expect(page.locator('.ai-summary-box')).toContainText('AI Clinical Trend Summary & Insights');
    await expect(page.locator('.ai-disclaimer')).toContainText('This is a pattern noticed in your health records');
  });

  test('2. AI Report Comparison & Health Alert Creation (Module F)', async ({ page }) => {
    await page.click('text=Patient Records');
    await page.click('text=View Record');
    await page.click('text=+ Record Vitals');
    await page.selectOption('#obs-type', 'hemoglobin');
    await page.fill('#obs-value', '7.2');
    await page.click('button:has-text("Save Observation")');
    await page.waitForTimeout(500);

    await page.click('text=Patient Records');
    await page.click('text=View Record');
    await expect(page.locator('#content')).toContainText(/hemoglobin/i);
  });

  test('3. Multilingual AI Translation UI Layer (Module A6)', async ({ page }) => {
    await page.click('button[onclick*="toggleLanguage"]');
    await page.waitForTimeout(500);
    await expect(page.locator('#sidebar')).toContainText('मुख्य स्वास्थ्य सेवाएँ');
  });

  test('4. Speech-to-Text Voice STT Trigger (Module A7)', async ({ page }) => {
    await page.click('text=Health Symptom Check');
    await page.click('button:has-text("Speak Symptoms")');
    await page.waitForTimeout(500);
    await expect(page.locator('#tr-stt-text')).not.toHaveValue('');
  });

  test('5. Conversational AI Chatbot Widget (English, Hindi, Marathi)', async ({ page }) => {
    await page.click('button:has-text("Aarogya Mitra AI Chat")');
    await expect(page.locator('#ai-chat-window')).toBeVisible();

    await expect(page.locator('#chat-messages-list')).toContainText('Aarogya Mitra AI');

    await page.selectOption('#chat-lang-select', 'hi');
    await page.waitForTimeout(300);
    await expect(page.locator('#chat-messages-list')).toContainText('आरोग्य सेतु मित्र');

    await page.click('text=बच्चों में बुखार');
    await page.waitForTimeout(800);
    await expect(page.locator('#chat-messages-list')).toContainText('बुखार');
  });
});

await page.click('text=बुखार और खतरे के लक्षण');
await page.waitForTimeout(2000);
await expect(page.locator('#chat-messages-list')).toContainText('बुखार');
  });
});
