import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('StreamPay Frontend Simulation Mode Smoke Test', () => {
  test.beforeAll(() => {
    const screenshotDir = path.resolve(__dirname, '../screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('loads StreamPay dashboard and captures simulation mode UI', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');

    // Wait for the main heading / title
    await expect(page.locator('text=StreamPay').first()).toBeVisible({ timeout: 10000 });

    // Verify stream selection / player canvas exists
    const streamTitle = page.locator('text=monad-keynote-hd').or(page.locator('text=Monad Keynote')).or(page.locator('text=StreamPay'));
    await expect(streamTitle.first()).toBeVisible();

    // Verify network selector or session status is displayed
    const sessionCard = page.locator('select').first();
    await expect(sessionCard.first()).toBeVisible();

    // Capture initial dashboard screenshot
    const screenshotPath = path.resolve(__dirname, '../screenshots/simulation-smoke-initial.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    expect(fs.existsSync(screenshotPath)).toBe(true);

    // Click "Open Session (Simulation)" or "Connect Wallet" if present
    const openBtn = page.locator('button:has-text("Open Session")').or(page.locator('button:has-text("Simulation")')).first();
    if (await openBtn.isVisible()) {
      await openBtn.click();
      await page.waitForTimeout(1000);
      const actionScreenshotPath = path.resolve(__dirname, '../screenshots/simulation-smoke-action.png');
      await page.screenshot({ path: actionScreenshotPath, fullPage: true });
      expect(fs.existsSync(actionScreenshotPath)).toBe(true);
    }

    console.log('📸 Simulation mode screenshots captured successfully in frontend/screenshots/');
  });
});
