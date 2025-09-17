import { test, expect } from '@playwright/test';

test('home page loads and has title', async ({ page }) => {
  await page.goto('http://localhost:4173/index.html');
  await expect(page).toHaveTitle(/.+/);
  await expect(page.locator('body')).toBeVisible();
});
